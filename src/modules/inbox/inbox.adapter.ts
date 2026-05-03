import { useState, useEffect, useCallback, useRef } from 'react'
import type { CommandCenterStore } from '../../domain/types'
import { formatRelativeTime } from '../../shared/formatters'
import { fetchInboxModel, type InboxFetchOptions } from '../../lib/data/inboxData'
import { isDev, shouldUseSupabase, useSupabaseData } from '../../lib/data/shared'
import type { InboxWorkflowThread, InboxStatus, SellerStage, AutomationState } from '../../lib/data/inboxWorkflowData'
import { hasSupabaseEnv, supabaseAnonKeyPresent, supabaseUrlPresent } from '../../lib/supabaseClient'
import { getSupabaseClient } from '../../lib/supabaseClient'

const LIVE_INBOX_TIMEOUT_MS = 30000

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

const emptyLiveErrorModel = (liveFetchError: string): InboxModel => {
  if (isDev) {
    console.log('[NexusInbox] Data source: fallback_error')
  }
  return {
    threads: [],
    unreadCount: 0,
    urgentCount: 0,
    totalCount: 0,
    aiDraftCount: 0,
    dataMode: 'mock_preview',
    liveFetchStatus: 'fallback_error',
    liveFetchError,
    messageEventsCount: null,
    messageEventsRawCount: null,
    groupedThreadCount: null,
    priorityInboxCount: null,
    activeInboxCount: null,
    waitingInboxCount: null,
    allInboxCount: null,
    unreadThreadsCount: null,
    sendQueueCount: null,
    archivedThreadsCount: null,
    hiddenThreadsCount: null,
    suppressedThreadsCount: null,
    lastLiveFetchAt: new Date().toISOString(),
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
  threadIsStarred?: boolean
  threadIsHidden?: boolean
  threadIsSuppressed?: boolean
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
  lat?: number
  lng?: number
}

export interface InboxModel {
  threads: InboxThread[]
  /** Non-archived threads where `is_read` is false (notification bell). */
  unreadCount: number
  urgentCount: number
  totalCount: number
  aiDraftCount: number
  dataMode: 'live' | 'mock_preview'
  liveFetchStatus: 'active' | 'error' | 'disabled' | 'fallback_error'
  liveFetchError: string | null
  messageEventsCount: number | null
  messageEventsRawCount: number | null
  groupedThreadCount: number | null
  priorityInboxCount: number | null
  activeInboxCount: number | null
  waitingInboxCount: number | null
  allInboxCount: number | null
  unreadThreadsCount: number | null
  sendQueueCount: number | null
  archivedThreadsCount: number | null
  hiddenThreadsCount: number | null
  suppressedThreadsCount: number | null
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

  const unreadThreads = threads.filter((t) => t.unreadCount > 0).length
  const priorityThreads = threads.filter((t) => Boolean(t.showInPriorityInbox)).length
  const waitingThreads = threads.filter((t) => t.uiIntent === 'outbound_waiting').length
  const activeThreads = threads.filter((t) => (
    t.status !== 'archived' &&
    t.priorityBucket !== 'hidden' &&
    t.priorityBucket !== 'suppressed' &&
    t.uiIntent !== 'outbound_waiting'
  )).length
  const archivedThreads = threads.filter((t) => t.status === 'archived').length
  const hiddenThreads = threads.filter((t) => t.priorityBucket === 'hidden').length
  const suppressedThreads = threads.filter((t) => t.priorityBucket === 'suppressed').length

  return {
    threads,
    unreadCount: unreadThreads,
    urgentCount: threads.filter((t) => t.priority === 'urgent').length,
    totalCount: threads.length,
    aiDraftCount: threads.filter((t) => t.aiDraft !== null).length,
    dataMode: 'mock_preview',
    liveFetchStatus: 'disabled',
    liveFetchError: null,
    messageEventsCount: activeThreads,
    messageEventsRawCount: waitingThreads,
    groupedThreadCount: threads.length,
    priorityInboxCount: priorityThreads,
    activeInboxCount: activeThreads,
    waitingInboxCount: waitingThreads,
    allInboxCount: threads.length,
    unreadThreadsCount: unreadThreads,
    sendQueueCount: null,
    archivedThreadsCount: archivedThreads,
    hiddenThreadsCount: hiddenThreads,
    suppressedThreadsCount: suppressedThreads,
    lastLiveFetchAt: null,
  }
}


export const loadInbox = async (options: InboxFetchOptions = {}): Promise<InboxModel> => {
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
    try {
      const result = await withTimeout(
        (signal) => fetchInboxModel({ ...options, signal }),
        LIVE_INBOX_TIMEOUT_MS,
        `Live Inbox request timed out after ${LIVE_INBOX_TIMEOUT_MS}ms`,
      )
      if (isDev) console.log('[NexusInbox] Data source: live', { threadCount: result.threads.length })
      return result
    } catch (error) {
      const liveFetchError = error instanceof Error ? error.message : String(error)
      if (isDev) {
        console.error('[NEXUS] Inbox Supabase live load failed.', error)
      }
      return emptyLiveErrorModel(liveFetchError)
    }
  }

  if (isDev) {
    console.log('[NexusInbox] Data source: mock_preview')
  }
  const { loadCommandCenterStore } = await import('../../domain/normalize-command-center')
  const store = await loadCommandCenterStore()
  return adaptInboxModel(store)
}

export const toWorkflowThread = (t: InboxThread): InboxWorkflowThread => {
  const lastAt = t.lastMessageIso || new Date().toISOString()
  const inboxStatus = (t.threadWorkflowStatus || (t.status === 'unread' ? 'new_reply' : 'waiting')) as InboxStatus
  const conversationStage = (t.threadWorkflowStage || 'ownership_check') as SellerStage

  return {
    ...t,
    threadKey: t.threadKey || t.id,
    inboxStatus,
    conversationStage,
    inboxStage: conversationStage,
    automationState: (t.threadIsArchived || t.threadIsSuppressed ? 'completed' : 'active') as AutomationState,
    nextSystemAction: 'Review thread for system recommended next steps.',
    isArchived: t.threadIsArchived ?? (t.status === 'archived'),
    isRead: t.threadIsRead ?? (t.status === 'read' || t.unreadCount === 0),
    isPinned: t.threadIsPinned ?? false,
    isStarred: t.threadIsStarred ?? false,
    isHidden: t.threadIsHidden ?? false,
    isSuppressed: t.threadIsSuppressed ?? t.isOptOut ?? false,
    priority: t.priority as InboxWorkflowThread['priority'],
    lastInboundAt: t.lastInboundAt ?? null,
    lastOutboundAt: t.lastOutboundAt ?? null,
    lastMessageAt: lastAt,
    lastMessageBody: t.latestMessageBody || t.preview,
    lastDirection: (t.directionUsed === 'inbound' || t.directionUsed === 'outbound' ? t.directionUsed : 'unknown'),
    updatedAt: lastAt,
    queueStatus: t.queueId ? 'queued' : null,
  } as InboxWorkflowThread
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
  priorityInboxCount: null,
  activeInboxCount: null,
  waitingInboxCount: null,
  allInboxCount: null,
  unreadThreadsCount: null,
  sendQueueCount: null,
  archivedThreadsCount: null,
  hiddenThreadsCount: null,
  suppressedThreadsCount: null,
  lastLiveFetchAt: null,
}

export const useInboxData = () => {
  const [data, setData] = useState<InboxModel>(EMPTY_MODEL)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [recentlyUpdatedThreadIds, setRecentlyUpdatedThreadIds] = useState<Set<string>>(new Set())
  const lastFetchRef = useRef<InboxFetchOptions>({})

  const threadsCountRef = useRef(0)
  threadsCountRef.current = data.threads.length

  const refresh = useCallback(async (options: InboxFetchOptions = {}) => {
    if (threadsCountRef.current === 0) {
      setLoading(true)
    }
    try {
      lastFetchRef.current = {
        ...lastFetchRef.current,
        ...options,
        filters: options.filters !== undefined ? options.filters : lastFetchRef.current.filters,
      }
      const model = await loadInbox(lastFetchRef.current)
      setData(model ?? EMPTY_MODEL)
      setError(null)
      return model
    } catch (err) {
      setError(err)
      if (isDev) {
        console.error('[NEXUS] useInboxData refresh failed', err)
      }
      return EMPTY_MODEL
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async (options: InboxFetchOptions = {}) => {
    if (loading) return
    setLoading(true)
    try {
      const model = await loadInbox({ 
        ...lastFetchRef.current,
        ...options,
        filters: lastFetchRef.current.filters,
        offset: data.threads.length, 
        maxRows: 200 
      })
      if (model && model.threads.length > 0) {
        setData((prev) => {
          const existingIds = new Set(prev.threads.map(t => t.id))
          const newThreads = model.threads.filter(t => !existingIds.has(t.id))
          if (newThreads.length === 0) return prev
          return {
            ...prev,
            threads: [...prev.threads, ...newThreads],
          }
        })
      }
    } catch (err) {
      if (isDev) console.error('[NEXUS] useInboxData loadMore failed', err)
    } finally {
      setLoading(false)
    }
  }, [data.threads.length, loading])

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
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err)
          setData(EMPTY_MODEL)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    if (shouldUseSupabase()) {
      const supabase = getSupabaseClient()
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null
      
      const triggerRefresh = (payload: any) => {
        const table = payload.table
        const eventType = payload.eventType
        const threadId = payload.new?.thread_key || payload.new?.threadKey || payload.old?.thread_key || payload.old?.threadKey
        
        if (isDev) {
          console.log('[NexusInboxLiveFeed]', {
            source: 'realtime',
            eventType,
            table,
            thread_id: threadId || 'unknown',
            action: 'refresh_triggered'
          })
        }

        if (threadId) {
          setRecentlyUpdatedThreadIds(prev => new Set([...prev, threadId]))
          setTimeout(() => {
            setRecentlyUpdatedThreadIds(prev => {
              const next = new Set(prev)
              next.delete(threadId)
              return next
            })
          }, 3000)
        }

        if (refreshTimeout) clearTimeout(refreshTimeout)
        refreshTimeout = setTimeout(() => {
          if (!cancelled) {
            void refresh().then((model) => {
               if (isDev) {
                 console.log('[NexusInboxLiveFeed]', {
                    action: 'refresh_complete',
                    refreshedCounts: !!model,
                    refreshedList: !!model?.threads,
                    selectedThreadPreserved: true
                 })
               }
            })
          }
        }, 250)
      }

      const channel = supabase
        .channel('nexus-inbox-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_thread_state' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_events' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'send_queue' }, triggerRefresh)
        .subscribe()

      const pollInterval = setInterval(() => {
        if (isDev) console.log('[NexusInboxLiveFeed] source: polling, action: refresh_triggered')
        void refresh()
      }, 30000)

      return () => {
        cancelled = true
        if (refreshTimeout) clearTimeout(refreshTimeout)
        clearInterval(pollInterval)
        void supabase.removeChannel(channel)
      }
    }

    return () => { cancelled = true }
  }, [refresh])

  return { data, loading, error, refresh, loadMore, recentlyUpdatedThreadIds }
}
