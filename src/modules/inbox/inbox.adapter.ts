import { useState, useEffect, useCallback } from 'react'
import type { CommandCenterStore } from '../../domain/types'
import { formatRelativeTime } from '../../shared/formatters'
import { fetchInboxModel } from '../../lib/data/inboxData'
import { isDev, shouldUseSupabase, useSupabaseData } from '../../lib/data/shared'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import { hasSupabaseEnv, supabaseAnonKeyPresent, supabaseUrlPresent } from '../../lib/supabaseClient'
import { getSupabaseClient } from '../../lib/supabaseClient'

const LIVE_INBOX_TIMEOUT_MS = 30000
let liveInboxRequest: Promise<InboxModel> | null = null

const withTimeout = async <T,>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    return await run(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const emptyLiveErrorModel = (liveFetchError: string): InboxModel => ({
  threads: [],
  unreadCount: 0,
  urgentCount: 0,
  totalCount: 0,
  aiDraftCount: 0,
  dataMode: 'live_supabase',
  liveFetchStatus: 'error',
  liveFetchError,
  messageEventsCount: null,
  messageEventsRawCount: null,
  groupedThreadCount: null,
  sendQueueCount: null,
  lastLiveFetchAt: new Date().toISOString(),
})

export interface InboxThread {
  id: string
  leadId: string
  marketId: string
  ownerName: string
  subject: string
  preview: string
  status: 'unread' | 'read' | 'replied' | 'archived'
  priority: 'urgent' | 'high' | 'normal' | 'low'
  sentiment: 'hot' | 'warm' | 'neutral' | 'cold'
  messageCount: number
  lastMessageLabel: string
  lastMessageIso: string
  unreadCount: number
  aiDraft: string | null
  labels: string[]
  threadKey?: string
  groupingMethod?: string
  groupingConfidence?: 'high' | 'medium' | 'low'
  ownerId?: string
  prospectId?: string
  propertyId?: string
  phoneNumber?: string
  canonicalE164?: string
  sellerPhoneSourceField?: string
  ourNumber?: string
  directionUsed?: string
  messageEventKey?: string
  providerMessageSid?: string
  queueId?: string
  phoneNumberId?: string
  textgridNumberId?: string
  isOptOut?: boolean
  deliveryStatus?: string
  providerDeliveryStatus?: string
  failureReason?: string
  propertyAddress?: string
  market?: string
  lastInboundAt?: string | null
  lastOutboundAt?: string | null
  needsResponse?: boolean
  unread?: boolean
  stateRowFound?: boolean
  threadWorkflowStage?: string
  threadWorkflowStatus?: string
  threadIsRead?: boolean
  threadIsArchived?: boolean
  threadIsPinned?: boolean
  threadLastReadAt?: string | null
  threadArchivedAt?: string | null
  ownerDisplayName?: string
  propertyAddressFull?: string
  latestMessageBody?: string
  latestMessageAt?: string
  uiIntent?: string
  priorityBucket?: string
  workflowStatus?: string
  workflowStage?: string
  showInPriorityInbox?: boolean
  cashOffer?: unknown
  estimatedValue?: unknown
  finalAcquisitionScore?: unknown
  streetviewImage?: string | null
  zillowUrl?: string | null
  realtorUrl?: string | null
  sellerPhone?: string
  thread_key?: string
  seller_phone?: string
  our_number?: string
  master_owner_id?: string
  prospect_id?: string
  property_id?: string
  // Seller details
  sellerFirstName?: string
  sellerLastName?: string
  ownerType?: string
  contactLanguage?: string
  bestPhone?: string
  phoneConfidence?: number
  // Property details
  beds?: string | number
  baths?: string | number
  sqft?: string | number
  yearBuilt?: string | number
  effectiveYear?: string | number
  equityAmount?: number
  equityPercent?: number
  estimatedRepairCost?: number
  motivationScore?: number
  podioTags?: string[]
  isOwnerOccupied?: boolean
  isAbsentee?: boolean
  isVacant?: boolean
  hasLien?: boolean
  isProbate?: boolean
  isTaxDelinquent?: boolean
  // Deal
  dealNextStep?: string
  motivationSummary?: string
}

export interface InboxModel {
  threads: InboxThread[]
  unreadCount: number
  urgentCount: number
  totalCount: number
  aiDraftCount: number
  dataMode: 'live_supabase' | 'mock_preview'
  liveFetchStatus: 'success' | 'error' | 'disabled'
  liveFetchError: string | null
  messageEventsCount: number | null
  messageEventsRawCount: number | null
  groupedThreadCount: number | null
  sendQueueCount: number | null
  lastLiveFetchAt: string | null
}

export const adaptInboxModel = (store: CommandCenterStore): InboxModel => {
  const threads: InboxThread[] = store.inboxThreadIds.map((id) => {
    const raw = store.inboxThreadsById[id]!
    return {
      ...raw,
      lastMessageLabel: formatRelativeTime(raw.lastMessageIso),
    }
  })

  // Sort: unread first, then by timestamp desc
  threads.sort((a, b) => {
    if (a.status === 'unread' && b.status !== 'unread') return -1
    if (b.status === 'unread' && a.status !== 'unread') return 1
    return new Date(b.lastMessageIso).getTime() - new Date(a.lastMessageIso).getTime()
  })

  return {
    threads,
    unreadCount: threads.filter((t) => t.unreadCount > 0).length,
    urgentCount: threads.filter((t) => t.priority === 'urgent').length,
    totalCount: threads.length,
    aiDraftCount: threads.filter((t) => t.aiDraft !== null).length,
    dataMode: 'mock_preview',
    liveFetchStatus: 'disabled',
    liveFetchError: null,
    messageEventsCount: null,
    messageEventsRawCount: null,
    groupedThreadCount: null,
    sendQueueCount: null,
    lastLiveFetchAt: null,
  }
}

export const loadInbox = async (): Promise<InboxModel> => {
  if (isDev) {
    console.log('[Inbox Live Data Gate]', {
      hasSupabaseEnv,
      useSupabaseData,
      shouldUseSupabase: shouldUseSupabase(),
      supabaseUrlPresent,
      anonKeyPresent: supabaseAnonKeyPresent,
    })
  }

  if (useSupabaseData && !hasSupabaseEnv) {
    const liveFetchError = 'Live mode enabled but Supabase env vars are missing.'
    if (isDev) {
      console.error('[NEXUS] Inbox live mode misconfigured.', liveFetchError)
    }
    return emptyLiveErrorModel(liveFetchError)
  }

  if (shouldUseSupabase()) {
    if (isDev) console.log('[loadInbox] Attempting Supabase fetch')
    try {
      if (!liveInboxRequest) {
        liveInboxRequest = withTimeout(
          (signal) => fetchInboxModel({ signal }),
          LIVE_INBOX_TIMEOUT_MS,
          `Live Inbox request timed out after ${LIVE_INBOX_TIMEOUT_MS}ms`,
        ).finally(() => {
          liveInboxRequest = null
        })
      }

      const result = await liveInboxRequest
      if (isDev) console.log('[loadInbox] Supabase fetch succeeded', { threadCount: result.threads.length })
      return result
    } catch (error) {
      const liveFetchError = error instanceof Error ? error.message : String(error)
      if (isDev) {
        console.error('[NEXUS] Inbox Supabase live load failed.', error)
      }
      return emptyLiveErrorModel(liveFetchError)
    }
  }

  const { loadCommandCenterStore } = await import('../../domain/normalize-command-center')
  const store = await loadCommandCenterStore()
  return adaptInboxModel(store)
}

export const toWorkflowThread = (t: InboxThread): InboxWorkflowThread => {
  const lastAt = t.lastMessageIso || new Date().toISOString()
  return {
    ...t,
    threadKey: t.threadKey || t.id,
    inboxStatus: (t.threadWorkflowStatus || (t.status === 'unread' ? 'unread' : 'open')) as InboxWorkflowThread['inboxStatus'],
    inboxStage: (t.threadWorkflowStage || 'needs_response') as InboxWorkflowThread['inboxStage'],
    isArchived: t.threadIsArchived ?? (t.status === 'archived'),
    isRead: t.threadIsRead ?? (t.status === 'read' || t.unreadCount === 0),
    isPinned: t.threadIsPinned ?? false,
    priority: t.priority as InboxWorkflowThread['priority'],
    lastInboundAt: t.lastInboundAt ?? null,
    lastOutboundAt: t.lastOutboundAt ?? null,
    lastMessageAt: lastAt,
    lastMessageBody: t.latestMessageBody || t.preview,
    lastDirection: (t.directionUsed === 'inbound' || t.directionUsed === 'outbound' ? t.directionUsed : 'unknown'),
    updatedAt: lastAt,
    queueStatus: t.queueId ? 'queued' : null,
  }
}

const EMPTY_MODEL: InboxModel = {
  threads: [],
  unreadCount: 0,
  urgentCount: 0,
  totalCount: 0,
  aiDraftCount: 0,
  dataMode: 'mock_preview',
  liveFetchStatus: 'disabled',
  liveFetchError: null,
  messageEventsCount: null,
  messageEventsRawCount: null,
  groupedThreadCount: null,
  sendQueueCount: null,
  lastLiveFetchAt: null,
}

export const useInboxData = () => {
  const [data, setData] = useState<InboxModel>(EMPTY_MODEL)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    try {
      const model = await loadInbox()
      setData(model ?? EMPTY_MODEL)
      setError(null)
      return model
    } catch (err) {
      setError(err)
      if (isDev) {
        console.error('[NEXUS] useInboxData refresh failed', err)
      }
      return EMPTY_MODEL
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (isDev) console.log('[useInboxData] Hook mounted, calling loadInbox()')
    loadInbox()
      .then((model) => {
        if (isDev) console.log('[useInboxData] loadInbox returned', {
          threadCount: model?.threads?.length,
          dataMode: model?.dataMode,
          liveFetchStatus: model?.liveFetchStatus,
          liveFetchError: model?.liveFetchError,
        })
        if (!cancelled) {
          setData(model ?? EMPTY_MODEL)
          if (isDev) console.log('[useInboxData] Data state updated')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[NEXUS] useInboxData — loadInbox threw error', err)
          setError(err)
          setData(EMPTY_MODEL)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          if (isDev) console.log('[useInboxData] Loading complete')
        }
      })

    if (shouldUseSupabase()) {
      const supabase = getSupabaseClient()
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null
      const triggerRefresh = () => {
        if (refreshTimeout) clearTimeout(refreshTimeout)
        refreshTimeout = setTimeout(() => {
          if (!cancelled) void refresh()
        }, 250)
      }

      const channel = supabase
        .channel('nexus-inbox-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_thread_state' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_events' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'send_queue' }, triggerRefresh)
        .subscribe()

      return () => {
        cancelled = true
        if (refreshTimeout) clearTimeout(refreshTimeout)
        void supabase.removeChannel(channel)
      }
    }

    return () => { cancelled = true }
  }, [refresh])

  return { data, loading, error, refresh }
}
