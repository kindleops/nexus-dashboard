import { useState, useEffect } from 'react'
import type { CommandCenterStore } from '../../domain/types'
import { formatRelativeTime } from '../../shared/formatters'
import { fetchInboxModel } from '../../lib/data/inboxData'
import { isDev, shouldUseSupabase, useSupabaseData } from '../../lib/data/shared'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import { hasSupabaseEnv, supabaseAnonKeyPresent, supabaseUrlPresent } from '../../lib/supabaseClient'

const LIVE_INBOX_TIMEOUT_MS = 120000

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

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
    return {
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
    }
  }

  if (shouldUseSupabase()) {
    if (isDev) console.log('[loadInbox] Attempting Supabase fetch')
    try {
      const result = await withTimeout(
        fetchInboxModel(),
        LIVE_INBOX_TIMEOUT_MS,
        `Live Inbox request timed out after ${LIVE_INBOX_TIMEOUT_MS}ms`,
      )
      if (isDev) console.log('[loadInbox] Supabase fetch succeeded', { threadCount: result.threads.length })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/timed out/i.test(message)) {
        try {
          // Large inboxes can exceed the client timeout; allow one uncapped attempt.
          return await fetchInboxModel()
        } catch (retryError) {
          const liveFetchError = retryError instanceof Error ? retryError.message : String(retryError)
          if (isDev) {
            console.error('[NEXUS] Inbox Supabase live load retry failed.', retryError)
          }
          return {
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
          }
        }
      }

      const liveFetchError = error instanceof Error ? error.message : String(error)
      if (isDev) {
        console.error('[NEXUS] Inbox Supabase live load failed.', error)
      }
      return {
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
      }
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
    inboxStatus: (t.threadWorkflowStatus || (t.status === 'unread' ? 'unread' : 'open')) as any,
    inboxStage: (t.threadWorkflowStage || 'needs_response') as any,
    isArchived: t.threadIsArchived ?? (t.status === 'archived'),
    isRead: t.threadIsRead ?? (t.status === 'read' || t.unreadCount === 0),
    isPinned: t.threadIsPinned ?? false,
    priority: t.priority as any,
    lastInboundAt: t.lastInboundAt ?? null,
    lastOutboundAt: t.lastOutboundAt ?? null,
    lastMessageAt: lastAt,
    lastMessageBody: t.preview,
    lastDirection: 'unknown',
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
  const [error, setError] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    console.log('[useInboxData] Hook mounted, calling loadInbox()')
    loadInbox()
      .then((model) => {
        console.log('[useInboxData] loadInbox returned', {
          threadCount: model?.threads?.length,
          dataMode: model?.dataMode,
          liveFetchStatus: model?.liveFetchStatus,
          liveFetchError: model?.liveFetchError,
        })
        if (!cancelled) {
          setData(model ?? EMPTY_MODEL)
          console.log('[useInboxData] Data state updated')
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
          console.log('[useInboxData] Loading complete')
        }
      })
    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}
