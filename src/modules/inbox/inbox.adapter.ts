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
  sellerName?: string
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
  ownerId?: string
  prospectId?: string
  propertyId?: string
  phoneNumber?: string
  phoneNumberId?: string
  textgridNumberId?: string
  canonicalE164?: string
  sellerPhone?: string
  ourNumber?: string
  latestDirection?: string
  directionUsed?: string
  autoReplyStatus?: string
  deliveryStatus?: string
  failureReason?: string
  propertyAddress?: string
  propertyAddressFull?: string
  market?: string
  marketName?: string
  lastInboundAt?: string | null
  lastOutboundAt?: string | null
  needsResponse?: boolean
  unread?: boolean
  uiIntent?: string
  priorityBucket?: string
  workflowStatus?: string
  workflowStage?: string
  threadWorkflowStatus?: string
  threadWorkflowStage?: string
  ownerDisplayName?: string
  latestMessageBody?: string
  latestMessageAt?: string
  lat?: number
  lng?: number
  ownerType?: string
  propertyType?: string
  propertyClass?: string
  finalAcquisitionScore?: number
  priorityScore?: number
  inboxCategory?: string
  matchedKeywords?: string[]
  groupingMethod?: string
  hydrationSource?: string
  queueId?: string
  needsReply?: boolean
  showInPriorityInbox?: boolean
  inbound_count?: number
  outbound_count?: number
  hydrationConfidence?: string
  groupingConfidence?: string
  latest_message_body?: string
  latest_message_direction?: string
  latest_activity_at?: string
  isStarred?: boolean
  isPinned?: boolean
  isHidden?: boolean
  isArchived?: boolean
  isSuppressed?: boolean
  threadIsPinned?: boolean
  threadIsStarred?: boolean
  threadIsHidden?: boolean
  threadIsSuppressed?: boolean
  isOptOut?: boolean
  thread_id?: string
  threadIsArchived?: boolean
  threadIsRead?: boolean
  latestMessage?: string
  inbox_category?: string
  display_phone?: string
  bestPhone?: string
  isRead?: boolean
  isDnc?: boolean
  beds?: string | number
  baths?: string | number
  sqft?: string | number
  yearBuilt?: string | number
  equityAmount?: number
  equityPercent?: number
  motivationScore?: number
  estimatedRepairCost?: number
  estimatedValue?: number | null
  contactLanguage?: string
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

  // Sort: by timestamp desc
  threads.sort((a, b) => {
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

  // Always try live if env vars exist
  try {
    const result = await withTimeout(
      (signal) => fetchInboxModel({ ...options, signal }),
      LIVE_INBOX_TIMEOUT_MS,
      `Live Inbox request timed out after ${LIVE_INBOX_TIMEOUT_MS}ms`,
    )
    if (isDev) console.log('[NexusInbox] Data source: live', { 
      threadCount: result.threads.length,
      dataMode: result.dataMode,
      totalCount: result.totalCount,
    })
    return result
  } catch (error) {
    const liveFetchError = error instanceof Error ? error.message : String(error)
    if (isDev) {
      console.error('[NEXUS] Inbox Supabase live load failed.', error)
    }
    return emptyLiveErrorModel(liveFetchError)
  }
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
    isArchived: t.threadIsArchived ?? (t.status === 'archived' || t.isArchived) ?? false,
    isRead: t.threadIsRead ?? (t.status === 'read' || t.unreadCount === 0) ?? true,
    isPinned: t.threadIsPinned ?? t.isPinned ?? false,
    isStarred: t.threadIsStarred ?? t.isStarred ?? false,
    isHidden: t.threadIsHidden ?? t.isHidden ?? false,
    isSuppressed: t.threadIsSuppressed ?? t.isSuppressed ?? t.isOptOut ?? false,
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

const threadIdentity = (thread: Pick<InboxThread, 'id' | 'threadKey'>): string =>
  thread.threadKey || thread.id


// selectedThreadPreserved: merge refreshes into existing rows instead of replacing the list.
const mergeInboxModels = (prev: InboxModel, next: InboxModel, mode: 'refresh' | 'append'): InboxModel => {
  const prevByKey = new Map(prev.threads.map((thread) => [threadIdentity(thread), thread]))
  const mergedById = new Map<string, InboxThread>()
  const ordered = mode === 'append'
    ? [...prev.threads, ...next.threads]
    : next.threads
  for (const thread of ordered) {
    const key = threadIdentity(thread)
    const base = prevByKey.get(key)
    const existing = mergedById.get(key)
    mergedById.set(key, existing ? { ...existing, ...thread } : { ...base, ...thread })
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
  const realtimeBatchRef = useRef<{ tables: Set<string>; threadKeys: Set<string>; eventCount: number }>({
    tables: new Set(),
    threadKeys: new Set(),
    eventCount: 0,
  })

  // Realtime config
  const realtimeEnabled = String(import.meta.env.VITE_INBOX_REALTIME_ENABLED ?? 'false').toLowerCase() === 'true'
  const minRefreshMs = 5000
  const lastRefreshAtRef = useRef<string | null>(null)
  const loadingRef = useRef(false)

  useEffect(() => {
    if (isDev) {
      console.log('[useInboxData] initialized', {
        realtimeEnabled,
        dataSource: shouldUseSupabase() ? 'live' : 'mock',
        hasEnvVars: hasSupabaseEnv,
      })
    }
  }, [realtimeEnabled])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  const runLoad = useCallback(async (options: InboxFetchOptions, mode: 'refresh' | 'append') => {
    const requestSeq = ++requestSeqRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (dataRef.current.threads.length === 0) setLoading(true)

    const runOptions = { ...options, signal: controller.signal }
    try {
      const model = await loadInbox(runOptions)
      if (requestSeq !== requestSeqRef.current) {
        if (isDev) console.log('[useInboxData] request superseded', { requestSeq, current: requestSeqRef.current })
        return dataRef.current
      }
      setData((prev) => mergeInboxModels(prev, model ?? EMPTY_MODEL, mode))
      setError(null)
      lastRefreshAtRef.current = new Date().toISOString()
      if (isDev) {
        console.log('[useInboxData] refresh complete', {
          refreshReason: 'manual',
          lastRefreshAt: lastRefreshAtRef.current,
          rowCount: model?.threads?.length ?? 0,
          totalCount: model?.totalCount ?? 0,
          dataMode: model?.dataMode,
        })
      }
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
    // Check minimum time between refreshes for automatic triggers
    if (options._automatic) {
      const now = Date.now()
      const lastRefresh = lastRefreshAtRef.current ? new Date(lastRefreshAtRef.current).getTime() : 0
      if (now - lastRefresh < minRefreshMs) {
        if (isDev) {
          console.log('[useInboxData] skippedRefreshReason: min interval not met', {
            lastRefreshAt: lastRefreshAtRef.current,
            msSinceLast: now - lastRefresh,
            minMs: minRefreshMs,
          })
        }
        return dataRef.current
      }
    }

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

    if (shouldUseSupabase() && realtimeEnabled) {
      const supabase = getSupabaseClient()
      const triggerRefresh = (payload: { table?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        const table = payload?.table ?? 'unknown'
        const rawThreadKey = payload?.new?.thread_key || payload?.old?.thread_key
        const threadKey = typeof rawThreadKey === 'string' ? rawThreadKey : ''
        
        if (threadKey) {
          markRecentlyUpdated(threadKey)
          
          // Surgical update if it's a message event
          if (table === 'message_events' && payload.new) {
            setData(prev => {
              const threads = [...prev.threads]
              const idx = threads.findIndex(t => (t.threadKey || t.id) === threadKey)
              if (idx !== -1) {
                const row = payload.new as any
                const direction = row.direction || 'inbound'
                const body = row.message_body || row.rendered_message || ''
                const at = row.message_created_at || row.event_timestamp || new Date().toISOString()
                
                threads[idx] = {
                  ...threads[idx],
                  preview: body,
                  lastMessageIso: at,
                  lastMessageLabel: formatRelativeTime(at),
                  latestMessageBody: body,
                  latestMessageAt: at,
                  latestDirection: direction,
                  messageCount: (threads[idx].messageCount || 0) + 1,
                  status: direction === 'inbound' ? 'unread' : threads[idx].status,
                  unreadCount: direction === 'inbound' ? (threads[idx].unreadCount || 0) + 1 : threads[idx].unreadCount,
                  needsReply: direction === 'inbound' ? true : threads[idx].needsReply,
                }
                
                // Sort after update
                threads.sort((a, b) => new Date(b.lastMessageIso).getTime() - new Date(a.lastMessageIso).getTime())
                return { ...prev, threads }
              }
              return prev
            })
          }
          
          // Surgical update if it's a thread state change
          if (table === 'inbox_thread_state' && payload.new) {
            setData(prev => {
              const threads = [...prev.threads]
              const idx = threads.findIndex(t => (t.threadKey || t.id) === threadKey)
              if (idx !== -1) {
                const row = payload.new as any
                threads[idx] = {
                  ...threads[idx],
                  inboxCategory: row.inbox_category || threads[idx].inboxCategory,
                  uiIntent: row.detected_intent || row.ui_intent || threads[idx].uiIntent,
                  workflowStage: row.thread_stage || threads[idx].workflowStage,
                  status: row.is_archived ? 'archived' : threads[idx].status,
                }
                return { ...prev, threads }
              }
              return prev
            })
          }
        }

        realtimeBatchRef.current.tables.add(table)
        if (threadKey) realtimeBatchRef.current.threadKeys.add(threadKey)
        realtimeBatchRef.current.eventCount += 1
        
        if (refreshTimeout) clearTimeout(refreshTimeout)
        refreshTimeout = setTimeout(() => {
          if (!cancelled) {
            if (isDev) {
              console.log('[useInboxData] background refresh sync', {
                refreshReason: 'realtime',
                tables: Array.from(realtimeBatchRef.current.tables),
                threadKeys: Array.from(realtimeBatchRef.current.threadKeys),
                eventCount: realtimeBatchRef.current.eventCount,
              })
            }
            realtimeBatchRef.current = { tables: new Set(), threadKeys: new Set(), eventCount: 0 }
            void refresh({ _automatic: true })
          }
        }, 5000) // Longer debounce for full refresh, surgical updates handle immediate UX
      }


      channel = supabase
        .channel('nexus-inbox-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_events' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'send_queue' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_map_pins' }, triggerRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_thread_state' }, triggerRefresh)
        .subscribe((status) => {
          setData((prev) => ({ ...prev, realtimeConnected: status === 'SUBSCRIBED' }))
        })

      if (isDev) console.log('[useInboxData] realtime subscriptions active')
    } else {
      if (isDev) console.log('[useInboxData] realtime disabled', { realtimeEnabled, shouldUseSupabase: shouldUseSupabase() })
    }

    return () => {
      cancelled = true
      abortRef.current?.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (refreshTimeout) clearTimeout(refreshTimeout)
      if (channel) void getSupabaseClient().removeChannel(channel)
    }
  }, [refresh, realtimeEnabled])

  return { data, loading, error, refresh, loadMore, recentlyUpdatedThreadIds }
}
