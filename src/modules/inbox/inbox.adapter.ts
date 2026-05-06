import { useState, useEffect, useCallback, useRef } from 'react'
import type { CommandCenterStore } from '../../domain/types'
import { formatRelativeTime } from '../../shared/formatters'
import { fetchInboxModel, type InboxFetchOptions, type LiveInboxMapPin, type LiveInboxPagination } from '../../lib/data/inboxData'
import { isDev, shouldUseSupabase } from '../../lib/data/shared'
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
  sellerName?: string
  ownerType?: string
  contactLanguage?: string
  bestPhone?: string
  phoneConfidence?: number
  // Property details
  propertyCity?: string
  propertyState?: string
  propertyZip?: string
  marketName?: string
  propertyType?: string
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
  latestDirection?: string
  autoReplyStatus?: string
  needsReply?: boolean
  matchedKeywords?: string[]
  thread_id?: string
  latest_message_body?: string
  latest_message_direction?: string
  latest_activity_at?: string
  inbound_count?: number
  outbound_count?: number
  hydrationConfidence?: 'high' | 'medium' | 'low'
  hydrationSource?: string
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
  counts?: Record<string, number | null | undefined>
  mapPins?: LiveInboxMapPin[]
  pagination?: LiveInboxPagination | null
  loadedCount?: number
  fullyHydratedCount?: number
  partiallyHydratedCount?: number
  orphanCount?: number
  latestFetchMs?: number
  realtimeConnected?: boolean
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
      shouldUseSupabase: shouldUseSupabase(),
      supabaseUrlPresent,
      anonKeyPresent: supabaseAnonKeyPresent,
    })
  }

  if (!hasSupabaseEnv) {
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
    thread_id: t.thread_id || t.threadKey || t.id,
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
    lastDirection: (t.latestDirection === 'inbound' || t.latestDirection === 'outbound' ? t.latestDirection : (t.directionUsed === 'inbound' || t.directionUsed === 'outbound' ? t.directionUsed : 'unknown')),
    latestDirection: t.latestDirection ?? t.directionUsed,
    latest_message_body: t.latest_message_body ?? t.latestMessageBody ?? t.preview,
    latest_message_direction: t.latest_message_direction ?? t.latestDirection ?? t.directionUsed,
    latest_activity_at: t.latest_activity_at ?? lastAt,
    inbound_count: t.inbound_count ?? 0,
    outbound_count: t.outbound_count ?? 0,
    hydrationConfidence: t.hydrationConfidence ?? t.groupingConfidence ?? 'medium',
    hydrationSource: t.hydrationSource ?? t.groupingMethod ?? 'live_inbox',
    autoReplyStatus: t.autoReplyStatus,
    matchedKeywords: t.matchedKeywords,
    updatedAt: lastAt,
    queueStatus: t.autoReplyStatus || (t.queueId ? 'queued' : null),
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
  loadedCount: 0,
  fullyHydratedCount: 0,
  partiallyHydratedCount: 0,
  orphanCount: 0,
  latestFetchMs: 0,
  realtimeConnected: false,
}


// selectedThreadPreserved: merge refreshes into existing rows instead of replacing the list.
const mergeInboxModels = (prev: InboxModel, next: InboxModel, mode: 'refresh' | 'append'): InboxModel => {
  const mergedById = new Map<string, InboxThread>()
  const nextIds = new Set(next.threads.map((thread) => thread.id))
  const ordered = mode === 'append'
    ? [...prev.threads, ...next.threads]
    : [...next.threads, ...prev.threads.filter((thread) => !nextIds.has(thread.id))]
  for (const thread of ordered) {
    const existing = mergedById.get(thread.id)
    mergedById.set(thread.id, existing ? { ...existing, ...thread } : thread)
  }
  return {
    ...prev,
    ...next,
    threads: Array.from(mergedById.values()),
    mapPins: next.mapPins && next.mapPins.length > 0 ? next.mapPins : prev.mapPins,
    pagination: next.pagination ?? prev.pagination ?? null,
  }
}

export const useInboxData = () => {
  const [data, setData] = useState<InboxModel>(EMPTY_MODEL)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [recentlyUpdatedThreadIds, setRecentlyUpdatedThreadIds] = useState<Set<string>>(new Set())
  const lastFetchRef = useRef<InboxFetchOptions>({})
  const dataRef = useRef<InboxModel>(EMPTY_MODEL)
  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const runLoad = useCallback(async (options: InboxFetchOptions, mode: 'refresh' | 'append') => {
    const requestSeq = ++requestSeqRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (dataRef.current.threads.length === 0) setLoading(true)

    const runOptions = { ...options, signal: controller.signal }
    try {
      const model = await loadInbox(runOptions)
      if (requestSeq !== requestSeqRef.current) return dataRef.current
      setData((prev) => mergeInboxModels(prev, model ?? EMPTY_MODEL, mode))
      setError(null)
      return model
    } catch (err) {
      if (controller.signal.aborted) return dataRef.current
      setError(err)
      if (isDev) console.error('[NEXUS] useInboxData load failed', err)
      return dataRef.current
    } finally {
      if (requestSeq === requestSeqRef.current) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async (options: InboxFetchOptions = {}) => {
    lastFetchRef.current = {
      ...lastFetchRef.current,
      ...options,
      filters: options.filters !== undefined ? options.filters : lastFetchRef.current.filters,
      cursor: options.cursor ?? null,
      maxRows: options.maxRows ?? lastFetchRef.current.maxRows ?? 200,
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = lastFetchRef.current.filters?.query ?? ''
    const delay = query.trim() ? 250 : 0
    if (delay === 0) return runLoad(lastFetchRef.current, 'refresh')
    return await new Promise<InboxModel>((resolve) => {
      debounceRef.current = setTimeout(() => {
        void runLoad(lastFetchRef.current, 'refresh').then(resolve)
      }, delay)
    })
  }, [runLoad])

  const loadMore = useCallback(async (options: InboxFetchOptions = {}) => {
    if (loading) return dataRef.current
    const cursor = options.cursor ?? dataRef.current.pagination?.nextCursor ?? null
    const moreOptions = {
      ...lastFetchRef.current,
      ...options,
      filters: lastFetchRef.current.filters,
      cursor,
      offset: cursor ? undefined : dataRef.current.threads.length,
      maxRows: options.maxRows ?? 200,
      limit: options.limit ?? options.maxRows ?? 200,
    }
    return runLoad(moreOptions, 'append')
  }, [loading, runLoad])

  useEffect(() => {
    let cancelled = false
    void refresh()

    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null

    const markRecentlyUpdated = (threadId: string) => {
      setRecentlyUpdatedThreadIds((prev) => new Set([...prev, threadId]))
      setTimeout(() => {
        setRecentlyUpdatedThreadIds((prev) => {
          const next = new Set(prev)
          next.delete(threadId)
          return next
        })
      }, 5000)
    }

    if (shouldUseSupabase()) {
      const supabase = getSupabaseClient()
      const triggerRefresh = (payload: any) => {
        const threadId = payload?.new?.thread_key || payload?.new?.threadKey || payload?.old?.thread_key || payload?.old?.threadKey
        if (threadId) markRecentlyUpdated(threadId)
        if (refreshTimeout) clearTimeout(refreshTimeout)
        refreshTimeout = setTimeout(() => {
          if (!cancelled) void refresh()
        }, 500)
      }

      channel = supabase
        .channel('nexus-inbox-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_events' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'send_queue' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_map_pins' }, triggerRefresh)
        .subscribe((status) => {
          setData((prev) => ({ ...prev, realtimeConnected: status === 'SUBSCRIBED' }))
        })
    }

    pollInterval = setInterval(() => {
      if (!cancelled) void refresh()
    }, 7500)

    return () => {
      cancelled = true
      abortRef.current?.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (refreshTimeout) clearTimeout(refreshTimeout)
      if (pollInterval) clearInterval(pollInterval)
      if (channel) void getSupabaseClient().removeChannel(channel)
    }
  }, [refresh])

  return { data, loading, error, refresh, loadMore, recentlyUpdatedThreadIds }
}
