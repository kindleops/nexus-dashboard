import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InboxModel, InboxThread } from './inbox.adapter'
import { Icon } from '../../shared/icons'
import { SplitView } from '../../shared/SplitView'
import { emitNotification } from '../../shared/NotificationToast'
import { InboxCommandPalette } from './InboxCommandPalette'
import type { InboxCmd } from './InboxCommandPalette'
import { InboxSchedulePanel } from './InboxSchedulePanel'
import type { ScheduledTime } from './InboxSchedulePanel'
import { InboxCommandMap } from './InboxCommandMap'
import { formatRelativeTime } from '../../shared/formatters'
import {
  fetchInboxModel,
  getThreadMessagesForThread,
  getThreadContext,
  getSuggestedDraft,
  doesMessageBelongToThread,
  queueReplyFromInbox,
  sendInboxMessageNow,
  scheduleReplyFromInbox,
  checkSuppressionStatus,
} from '../../lib/data/inboxData'
import type { ThreadMessage, ThreadContext, SuggestedDraft, QueueReplyResult, SendNowResult } from '../../lib/data/inboxData'
import {
  archiveThread,
  fetchSentMessages,
  markThreadRead,
  markThreadUnread,
  pinThread,
  unarchiveThread,
  unpinThread,
  updateThreadPriority,
  updateThreadStage,
  updateThreadStatus,
  type InboxPriority,
  type InboxStage,
  type InboxStatusTab,
  type InboxThreadsQuery,
  type InboxWorkflowStatus,
  type InboxWorkflowThread,
} from '../../lib/data/inboxWorkflowData'
import { InboxStatusTabs } from './InboxStatusTabs'
import { InboxFilterBar } from './InboxFilterBar'
import { InboxStageDropdown } from './InboxStageDropdown'
import { InboxThreadRow } from './InboxThreadRow'
import { InboxThreadActions } from './InboxThreadActions'
import { SentMessagesView } from './SentMessagesView'
import { ArchivedThreadsView } from './ArchivedThreadsView'
import { TemplateLibraryDrawer } from './templates/TemplateLibraryDrawer'
import { buildTemplateContextFromThread, getRecommendedTemplates, renderTemplate, type SmsTemplate } from '../../lib/data/templateData'
import { shouldUseSupabase, useSupabaseData } from '../../lib/data/shared'
import { getSupabaseClient, hasSupabaseEnv } from '../../lib/supabaseClient'
import './inbox-rebuild.css'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const PRIORITY_CLS: Record<InboxThread['priority'], string> = {
  urgent: 'is-urgent', high: 'is-high', normal: 'is-normal', low: 'is-low',
}

const SENTIMENT_CLS: Record<InboxThread['sentiment'], string> = {
  hot: 'is-hot', warm: 'is-warm', neutral: 'is-neutral', cold: 'is-cold',
}

function formatMarket(marketId: string): string {
  return marketId
    .replace(/^m-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function nba(t: InboxThread): string {
  if (t.priority === 'urgent') return 'Respond Now'
  if (t.sentiment === 'hot') return 'Send Offer'
  if (t.sentiment === 'warm') return 'Follow Up'
  if (t.sentiment === 'cold') return 'Re-engage'
  return 'Review Thread'
}

function stage(t: InboxThread): string {
  if (t.status === 'unread') return 'New Reply'
  if (t.status === 'replied') return 'Awaiting Seller'
  if (t.status === 'archived') return 'Archived'
  return 'Open Thread'
}

const normalizeThreadDirection = (value: string | null | undefined): 'inbound' | 'outbound' | 'unknown' => {
  const normalized = (value ?? '').toLowerCase()
  if (['inbound', 'incoming', 'received', 'reply'].includes(normalized)) return 'inbound'
  if (['outbound', 'outgoing', 'sent'].includes(normalized)) return 'outbound'
  return 'unknown'
}

const WORKFLOW_STATUSES: ReadonlySet<InboxWorkflowStatus> = new Set([
  'open',
  'unread',
  'read',
  'pending',
  'queued',
  'sent',
  'scheduled',
  'failed',
  'archived',
  'suppressed',
  'closed',
])

const WORKFLOW_STAGES: ReadonlySet<InboxStage> = new Set([
  'new_reply',
  'needs_response',
  'ai_draft_ready',
  'queued_reply',
  'sent_waiting',
  'interested',
  'needs_offer',
  'needs_call',
  'nurture',
  'not_interested',
  'wrong_number',
  'dnc_opt_out',
  'archived',
  'closed_converted',
])

const FAST_THREAD_MAX_MESSAGES = 240
const FAST_THREAD_MAX_PAGES = 4

const toPhoneDigits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '')

const deriveNeedsResponse = (thread: InboxThread, latestDirection: 'inbound' | 'outbound' | 'unknown'): boolean => {
  const inboundAt = thread.lastInboundAt ? new Date(thread.lastInboundAt).getTime() : 0
  const outboundAt = thread.lastOutboundAt ? new Date(thread.lastOutboundAt).getTime() : 0
  if (inboundAt > outboundAt) return true
  return latestDirection === 'inbound' && !thread.isOptOut
}

const deriveWorkflowState = (
  thread: InboxThread,
  queueStatus: string | null,
): Pick<InboxWorkflowThread, 'inboxStatus' | 'inboxStage' | 'isArchived' | 'isRead' | 'lastDirection' | 'needsResponse' | 'priority'> => {
  const lastDirection = normalizeThreadDirection(thread.directionUsed)
  const failed = Boolean(thread.failureReason) || ['failed', 'error', 'undelivered'].includes((thread.deliveryStatus ?? '').toLowerCase())
  const persistedStatus = (thread.threadWorkflowStatus ?? '').toLowerCase()
  const persistedStage = (thread.threadWorkflowStage ?? '').toLowerCase()
  const hasPersistedStatus = WORKFLOW_STATUSES.has(persistedStatus as InboxWorkflowStatus)
  const hasPersistedStage = WORKFLOW_STAGES.has(persistedStage as InboxStage)
  const isArchived = Boolean(thread.threadIsArchived) || thread.status === 'archived' || persistedStatus === 'archived'

  const lastInboundTs = thread.lastInboundAt ? new Date(thread.lastInboundAt).getTime() : 0
  const lastReadTs = thread.threadLastReadAt ? new Date(thread.threadLastReadAt).getTime() : 0
  const readCoversLatestInbound = lastInboundTs > 0 && lastReadTs > 0 && lastReadTs >= lastInboundTs

  let needsResponse = !isArchived && deriveNeedsResponse(thread, lastDirection)
  if (readCoversLatestInbound) needsResponse = false

  const persistedIsRead = Boolean(thread.threadIsRead)
  const isRead = !isArchived && (persistedIsRead || readCoversLatestInbound) && !needsResponse

  let inboxStatus: InboxWorkflowStatus = hasPersistedStatus
    ? (persistedStatus as InboxWorkflowStatus)
    : (isArchived ? 'archived' : 'open')

  if (!hasPersistedStatus) {
    if (thread.isOptOut) inboxStatus = 'suppressed'
    else if (failed || queueStatus === 'failed') inboxStatus = 'failed'
    else if (queueStatus === 'scheduled') inboxStatus = 'scheduled'
    else if (queueStatus === 'queued' || queueStatus === 'approval') inboxStatus = 'queued'
    else if (thread.lastOutboundAt || lastDirection === 'outbound') inboxStatus = 'sent'
    else if (needsResponse) inboxStatus = 'unread'
    else if (isRead) inboxStatus = 'read'
  }
  if (isArchived) inboxStatus = 'archived'

  let inboxStage: InboxStage = hasPersistedStage
    ? (persistedStage as InboxStage)
    : 'sent_waiting'

  if (!hasPersistedStage) {
    if (isArchived) inboxStage = 'archived'
    else if (thread.isOptOut) inboxStage = 'dnc_opt_out'
    else if (failed || queueStatus === 'failed') inboxStage = 'needs_response'
    else if (queueStatus === 'scheduled' || queueStatus === 'queued' || queueStatus === 'approval') inboxStage = 'queued_reply'
    else if (needsResponse) inboxStage = 'needs_response'
    else if (thread.aiDraft) inboxStage = 'ai_draft_ready'
  }
  if (isArchived) inboxStage = 'archived'

  const priority: InboxPriority = needsResponse ? 'urgent' : thread.priority

  return { inboxStatus, inboxStage, isArchived, isRead, lastDirection, needsResponse, priority }
}

const toWorkflowThread = (thread: InboxThread): InboxWorkflowThread => {
  const derived = deriveWorkflowState(thread, null)

  return {
    ...thread,
    threadKey: thread.threadKey ?? thread.id,
    inboxStatus: derived.inboxStatus,
    inboxStage: derived.inboxStage,
    isArchived: derived.isArchived,
    isRead: derived.isRead,
    isPinned: Boolean(thread.threadIsPinned),
    priority: derived.priority,
    lastInboundAt: thread.lastInboundAt ?? null,
    lastOutboundAt: thread.lastOutboundAt ?? null,
    lastMessageAt: thread.lastMessageIso,
    lastMessageBody: thread.preview,
    lastDirection: derived.lastDirection,
    updatedAt: thread.lastMessageIso,
    queueStatus: null,
  }
}

/** Returns true if the search query looks like a command intent */
function isCommandLike(q: string): boolean {
  const commandTriggers = [
    'mark ', 'show ', 'open ', 'draft', 'reply', 'send', 'archive', 'flag',
    'next ', 'prev ', 'find ', 'search', 'filter', 'snooze', 'summar', 'translat',
    'warm', 'shorter', 'direct', 'profes', 'urgnt', 'dnc', 'wrong', 'follow',
  ]
  const lower = q.toLowerCase()
  return commandTriggers.some(t => lower.startsWith(t) || lower.includes(t))
}

// ─────────────────────────────────────────────────────────────────────────────

type InboxLayoutMode = 'default' | 'conversation_focus' | 'triage'

const LIVE_REFRESH_TIMEOUT_MS = 120000

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

export const InboxPage = ({ data }: { data: InboxModel }) => {
  // ── Live threads state (refreshable) ─────────────────────────────────────
  const [threads, setThreads] = useState<InboxWorkflowThread[]>(() => data.threads.map(toWorkflowThread))
  const [sentItems, setSentItems] = useState<Awaited<ReturnType<typeof fetchSentMessages>>>([])
  const [workflowTab, setWorkflowTab] = useState<InboxStatusTab>('all')
  const [workflowFilters, setWorkflowFilters] = useState<InboxThreadsQuery>({ tab: 'all' })
  const [workflowWriteTarget, setWorkflowWriteTarget] = useState<string>('pending')
  const [lastMutationPayload, setLastMutationPayload] = useState<Record<string, unknown> | null>(null)
  const [lastMutationError, setLastMutationError] = useState<string | null>(null)
  const [threadRefreshNonce, setThreadRefreshNonce] = useState(0)
  const [threadListSyncing, setThreadListSyncing] = useState(false)
  const [newMessageIndicator, setNewMessageIndicator] = useState(false)

  // ── Thread message / context / draft state ────────────────────────────────
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesSyncing, setMessagesSyncing] = useState(false)
  const [fullHistoryLoading, setFullHistoryLoading] = useState(false)
  const [hasMoreThreadHistory, setHasMoreThreadHistory] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [suggestedDraft, setSuggestedDraft] = useState<SuggestedDraft | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<'off' | 'polling' | 'subscribed'>('off')
  const [dataMode, setDataMode] = useState<InboxModel['dataMode']>(data.dataMode)
  const [liveFetchStatus, setLiveFetchStatus] = useState<InboxModel['liveFetchStatus']>(data.liveFetchStatus)
  const [liveFetchError, setLiveFetchError] = useState<string | null>(data.liveFetchError)
  const [messageEventsCount, setMessageEventsCount] = useState<number | null>(data.messageEventsCount)
  const [messageEventsRawCount, setMessageEventsRawCount] = useState<number | null>(data.messageEventsRawCount)
  const [groupedThreadCount, setGroupedThreadCount] = useState<number | null>(data.groupedThreadCount)
  const [sendQueueCount, setSendQueueCount] = useState<number | null>(data.sendQueueCount)
  const [lastLiveFetchAt, setLastLiveFetchAt] = useState<string | null>(data.lastLiveFetchAt)
  const [queueStateByThreadKey, setQueueStateByThreadKey] = useState<Record<string, string>>({})
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'inbound' | 'outbound' | 'failed'>('all')
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
  const [recommendedTemplates, setRecommendedTemplates] = useState<SmsTemplate[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(data.threads[0]?.id ?? null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftByThreadId, setDraftByThreadId] = useState<Record<string, string>>({})
  const [composerSendMode, setComposerSendMode] = useState<'send_now' | 'queue_reply'>('send_now')
  const [showAiActions, setShowAiActions] = useState(false)
  const [splitThread, setSplitThread] = useState<InboxThread | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false)
  const [scheduledTime, setScheduledTime] = useState<ScheduledTime | null>(null)
  // ── Queue reply state ──────────────────────────────────────────────────────
  const [queueReplyLoading, setQueueReplyLoading] = useState(false)
  const [lastQueueReplyAttempt, setLastQueueReplyAttempt] = useState<string | null>(null)
  const [queueReplyStatus, setQueueReplyStatus] = useState<string | null>(null)
  const [queueReplyError, setQueueReplyError] = useState<string | null>(null)
  const [insertedQueueId, setInsertedQueueId] = useState<string | null>(null)
  const [queuedReplyPreview, setQueuedReplyPreview] = useState<string | null>(null)
  // ── Send Now state ─────────────────────────────────────────────────────
  const [sendNowLoading, setSendNowLoading] = useState(false)
  const [lastSendNowAttempt, setLastSendNowAttempt] = useState<string | null>(null)
  const [sendNowStatus, setSendNowStatus] = useState<string | null>(null)
  const [sendNowError, setSendNowError] = useState<string | null>(null)
  const [sendNowProviderSid, setSendNowProviderSid] = useState<string | null>(null)
  const [sendNowEventId, setSendNowEventId] = useState<string | null>(null)
  const [sendNowRouteUsed, setSendNowRouteUsed] = useState<string | null>(null)
  const [suppressionBlocked, setSuppressionBlocked] = useState(false)
  const [suppressionReason, setSuppressionReason] = useState<string | null>(null)
  const [suppressionChecked, setSuppressionChecked] = useState<string | null>(null) // phone that was checked
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{ id: string; body: string; createdAt: string; dedupeKey: string }>>([])
  const [sendQueueLastQueueKey, setSendQueueLastQueueKey] = useState<string | null>(null)
  const [sendQueueLastPayloadKeys, setSendQueueLastPayloadKeys] = useState<string[]>([])
  const [queueProcessorEligible, setQueueProcessorEligible] = useState<boolean | null>(null)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [layoutMode, setLayoutMode] = useState<InboxLayoutMode>('default')
  const [mapOpen, setMapOpen] = useState(false)
  const [mapZoomed, setMapZoomed] = useState(false)
  const [dossierTab, setDossierTab] = useState<'dossier' | 'map'>('dossier')

  const restoreLayout = () => {
    setLeftPanelOpen(true)
    setRightPanelOpen(true)
    setLayoutMode('default')
  }

  const messagesRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const headerSearchRef = useRef<HTMLInputElement>(null)
  const selectedMessagesRef = useRef<ThreadMessage[]>([])
  const messageCacheRef = useRef<Record<string, ThreadMessage[]>>({})
  const fullThreadLoadedRef = useRef<Record<string, boolean>>({})
  const selectedMessagesThreadKeyRef = useRef<string | null>(null)
  const selectedThreadRef = useRef<InboxWorkflowThread | null>(null)
  const lastSelectedThreadRef = useRef<InboxWorkflowThread | null>(data.threads[0] ? toWorkflowThread(data.threads[0]) : null)
  const liveRefreshInFlightRef = useRef(false)
  const lastRefreshRequestAtRef = useRef(0)

  const derivedThreads = useMemo(() => threads.map((thread) => {
    const queueStatus = queueStateByThreadKey[thread.threadKey ?? thread.id] ?? null
    const derived = deriveWorkflowState(thread, queueStatus)
    return {
      ...thread,
      queueStatus,
      inboxStatus: derived.inboxStatus,
      inboxStage: derived.inboxStage,
      isArchived: derived.isArchived,
      isRead: derived.isRead,
      lastDirection: derived.lastDirection,
      needsResponse: derived.needsResponse,
      priority: derived.priority,
    }
  }), [threads, queueStateByThreadKey])

  const filtered = derivedThreads
    .filter((thread) => {
      if (workflowTab === 'archived') return thread.isArchived || thread.status === 'archived'
      if (workflowTab === 'sent') return Boolean(thread.lastOutboundAt) || thread.lastDirection === 'outbound' || thread.inboxStatus === 'sent'
      if (workflowTab === 'priority') return thread.priority === 'urgent' || thread.priority === 'high'
      if (workflowTab === 'needs_response') return Boolean(thread.needsResponse)
      if (workflowTab === 'queued') return thread.queueStatus === 'queued' || thread.queueStatus === 'approval' || thread.inboxStatus === 'queued'
      if (workflowTab === 'scheduled') return thread.queueStatus === 'scheduled' || thread.inboxStatus === 'scheduled'
      if (workflowTab === 'failed') return Boolean(thread.failureReason) || ['failed', 'error', 'undelivered'].includes((thread.deliveryStatus ?? '').toLowerCase()) || thread.inboxStatus === 'failed'
      return !thread.isArchived
    })
    .filter((thread) => {
      if (workflowFilters.read === 'read') return thread.isRead
      if (workflowFilters.read === 'unread') return !thread.isRead
      return true
    })
    .filter((thread) => (workflowFilters.direction && workflowFilters.direction !== 'all' ? thread.lastDirection === workflowFilters.direction : true))
    .filter((thread) => (workflowFilters.market && workflowFilters.market !== 'all' ? (thread.market || thread.marketId) === workflowFilters.market : true))
    .filter((thread) => (workflowFilters.hasPropertyLink ? Boolean(thread.propertyId || thread.propertyAddress) : true))
    .filter((thread) => (workflowFilters.hasOwnerLink ? Boolean(thread.ownerId || thread.ownerName) : true))
    .filter((thread) => (workflowFilters.hasPhoneLink ? Boolean(thread.phoneNumber || thread.canonicalE164) : true))
    .filter((thread) => (workflowFilters.dncOptOut ? Boolean(thread.isOptOut) || thread.inboxStatus === 'suppressed' : true))
    .filter((thread) => (workflowFilters.priority && workflowFilters.priority !== 'all' ? thread.priority === workflowFilters.priority : true))
    .filter((thread) => (workflowFilters.status && workflowFilters.status !== 'all' ? thread.inboxStatus === workflowFilters.status : true))
    .filter((thread) => (workflowFilters.stage && workflowFilters.stage !== 'all' ? thread.inboxStage === workflowFilters.stage : true))
    .filter((thread) => {
      if (!workflowFilters.startDate) return true
      const start = new Date(workflowFilters.startDate).getTime()
      const ts = new Date(thread.lastMessageAt).getTime()
      return Number.isFinite(start) && Number.isFinite(ts) ? ts >= start : true
    })
    .filter((thread) => {
      if (!workflowFilters.endDate) return true
      const end = new Date(workflowFilters.endDate).getTime()
      const ts = new Date(thread.lastMessageAt).getTime()
      return Number.isFinite(end) && Number.isFinite(ts) ? ts <= end : true
    })
    .filter((thread) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return [thread.ownerName, thread.subject, thread.preview, thread.propertyAddress, thread.market, thread.marketId, thread.phoneNumber]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q))
    })

  const selectedLive = derivedThreads.find(t => t.id === selectedId) ?? threads.find(t => t.id === selectedId) ?? null
  const selected = selectedLive ?? lastSelectedThreadRef.current
  const hotCount = derivedThreads.filter(t => t.sentiment === 'hot').length
  const aiReady = derivedThreads.filter((t) => t.aiDraft && t.needsResponse).length
  const baseStats = useMemo(() => ({
    totalCount: derivedThreads.length,
    unreadCount: derivedThreads.filter((thread) => !thread.isRead || thread.unreadCount > 0).length,
    urgentCount: derivedThreads.filter((thread) => thread.priority === 'urgent' || thread.needsResponse).length,
    aiDraftCount: derivedThreads.filter((thread) => Boolean(thread.aiDraft)).length,
  }), [derivedThreads])

  useEffect(() => {
    if (selectedLive) {
      lastSelectedThreadRef.current = selectedLive
    }
  }, [selectedLive])

  useEffect(() => {
    selectedThreadRef.current = selected
  }, [selected])

  useEffect(() => {
    selectedMessagesRef.current = selectedMessages
  }, [selectedMessages])

  useEffect(() => {
    if (!selectedId) return
    setDraftByThreadId((prev) => {
      if (prev[selectedId] === draftText) return prev
      return { ...prev, [selectedId]: draftText }
    })
  }, [selectedId, draftText])

  useEffect(() => {
    if (!selected || !shouldUseSupabase()) {
      setRecommendedTemplates([])
      return
    }
    let cancelled = false
    getRecommendedTemplates(selected, threadContext)
      .then((items) => {
        if (!cancelled) setRecommendedTemplates(items)
      })
      .catch(() => {
        if (!cancelled) setRecommendedTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [selected, threadContext])

  useEffect(() => {
    if (!shouldUseSupabase()) {
      setDataMode('mock_preview')
      setLiveFetchStatus('disabled')
      setLiveFetchError(null)
      setMessageEventsRawCount(null)
      setGroupedThreadCount(null)
      setQueueStateByThreadKey({})
      return
    }

    let cancelled = false

    const load = async () => {
      if (liveRefreshInFlightRef.current) return
      liveRefreshInFlightRef.current = true
      setThreadListSyncing(true)
      try {
        const model = await withTimeout(
          fetchInboxModel(),
          LIVE_REFRESH_TIMEOUT_MS,
          `Live Inbox refresh timed out after ${LIVE_REFRESH_TIMEOUT_MS}ms`,
        )
        if (cancelled) return

        const nextThreads = model.threads.map(toWorkflowThread)
        setThreads(nextThreads)
        setDataMode(model.dataMode)
        setLiveFetchStatus(model.liveFetchStatus)
        setLiveFetchError(model.liveFetchError)
        setMessageEventsCount(model.messageEventsCount)
        setMessageEventsRawCount(model.messageEventsRawCount)
        setGroupedThreadCount(model.groupedThreadCount)
        setSendQueueCount(model.sendQueueCount)
        setLastLiveFetchAt(model.lastLiveFetchAt)

        setSelectedId((prevSelectedId) => {
          if (prevSelectedId) {
            return prevSelectedId
          }
          return nextThreads[0]?.id ?? null
        })
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Live Inbox data failed to load'
          const isTimeout = /timed out/i.test(message)
          if (isTimeout && threads.length === 0) {
            try {
              // Initial hydration fallback for large datasets: retry once without timeout.
              const model = await fetchInboxModel()
              if (cancelled) return

              const nextThreads = model.threads.map(toWorkflowThread)
              setThreads(nextThreads)
              setDataMode(model.dataMode)
              setLiveFetchStatus(model.liveFetchStatus)
              setLiveFetchError(model.liveFetchError)
              setMessageEventsCount(model.messageEventsCount)
              setMessageEventsRawCount(model.messageEventsRawCount)
              setGroupedThreadCount(model.groupedThreadCount)
              setSendQueueCount(model.sendQueueCount)
              setLastLiveFetchAt(model.lastLiveFetchAt)

              setSelectedId((prevSelectedId) => {
                if (prevSelectedId) {
                  return prevSelectedId
                }
                return nextThreads[0]?.id ?? null
              })
              return
            } catch (retryError) {
              const retryMessage = retryError instanceof Error ? retryError.message : 'Live Inbox data failed to load'
              setLiveFetchStatus('error')
              setLiveFetchError(retryMessage)
              setLastLiveFetchAt(new Date().toISOString())
              return
            }
          }

          if (isTimeout && threads.length > 0) {
            // Keep rendering the last known live data instead of hard-failing refresh UI.
            setLiveFetchStatus('success')
            setLiveFetchError(null)
            setLastLiveFetchAt(new Date().toISOString())
          } else {
            setLiveFetchStatus('error')
            setLiveFetchError(message)
            setLastLiveFetchAt(new Date().toISOString())
          }
        }
      } finally {
        liveRefreshInFlightRef.current = false
        if (!cancelled) setThreadListSyncing(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [threadRefreshNonce])

  useEffect(() => {
    if (!shouldUseSupabase() || threads.length === 0) {
      setQueueStateByThreadKey({})
      return
    }

    let cancelled = false

    const loadQueueState = async () => {
      try {
        const supabase = getSupabaseClient()
        const { data: rows, error } = await supabase
          .from('send_queue')
          .select('id, status, owner_id, property_id, prospect_id, phone_number, recipient_e164, created_at')
          .order('created_at', { ascending: false })
          .limit(2000)

        if (cancelled) return
        if (error || !rows) {
          setQueueStateByThreadKey({})
          return
        }

        const next: Record<string, string> = {}

        for (const thread of threads) {
          const match = rows.find((row) => {
            const threadPhone = toPhoneDigits(thread.phoneNumber)
            const rowPhone = toPhoneDigits(row.recipient_e164 ?? row.phone_number)
            const phoneMatch = threadPhone && rowPhone ? threadPhone === rowPhone : false
            const ownerMatch = Boolean(thread.ownerId && row.owner_id && thread.ownerId === row.owner_id)
            const propertyMatch = Boolean(thread.propertyId && row.property_id && thread.propertyId === row.property_id)
            const prospectMatch = Boolean(thread.prospectId && row.prospect_id && thread.prospectId === row.prospect_id)
            return phoneMatch || ownerMatch || propertyMatch || prospectMatch
          })
          if (match?.status) {
            next[thread.threadKey ?? thread.id] = String(match.status).toLowerCase()
          }
        }

        setQueueStateByThreadKey(next)
      } catch {
        if (!cancelled) setQueueStateByThreadKey({})
      }
    }

    void loadQueueState()
    return () => {
      cancelled = true
    }
  }, [threadRefreshNonce, threads])

  useEffect(() => {
    if (dataMode === 'mock_preview') return
    console.log('[Inbox Live Diagnostics]', {
      dataMode,
      liveFetchStatus,
      liveFetchError,
      messageEventsCount,
      messageEventsRawCount,
      groupedThreadCount,
      sendQueueCount,
      totalThreads: derivedThreads.length,
      filteredThreadCount: filtered.length,
      activeTab: workflowTab,
      activeFilters: {
        ...workflowFilters,
        search: searchQuery,
      },
    })
  }, [
    dataMode,
    liveFetchStatus,
    liveFetchError,
    messageEventsCount,
    messageEventsRawCount,
    groupedThreadCount,
    sendQueueCount,
    derivedThreads.length,
    filtered.length,
    workflowTab,
    workflowFilters,
    searchQuery,
  ])

  useEffect(() => {
    if (workflowTab !== 'sent') {
      setSentItems([])
      return
    }

    let cancelled = false
    fetchSentMessages({
      search: searchQuery || workflowFilters.search || undefined,
      market: workflowFilters.market,
      startDate: workflowFilters.startDate,
      endDate: workflowFilters.endDate,
    })
      .then((items) => {
        if (!cancelled) setSentItems(items)
      })
      .catch(() => {
        if (!cancelled) setSentItems([])
      })

    return () => {
      cancelled = true
    }
  }, [searchQuery, workflowFilters.endDate, workflowFilters.market, workflowFilters.search, workflowFilters.startDate, workflowTab])

  // ── Load thread messages + context + draft when thread changes ─────────────
  useEffect(() => {
    if (!selectedId || !selected) return
    const selectedThreadKey = selected.threadKey ?? selected.id
    if (dataMode === 'mock_preview') {
      // Fall back to a single synthetic message from thread preview
      selectedMessagesThreadKeyRef.current = selectedThreadKey
      setSelectedMessages([{
        id: `mock-${selectedId}`,
        direction: selected.status === 'replied' ? 'inbound' : 'outbound',
        body: selected.preview,
        createdAt: selected.lastMessageIso,
        deliveredAt: selected.lastMessageIso,
        deliveryStatus: 'delivered',
        fromNumber: '',
        toNumber: '',
        ownerId: selected.leadId,
        prospectId: '',
        propertyId: selected.leadId,
        phoneNumber: '',
        canonicalE164: '',
        templateId: null,
        templateName: null,
        agentId: null,
        source: 'sms',
        rawStatus: 'delivered',
        error: null,
      }])
      setSuggestedDraft(selected.aiDraft ? { text: selected.aiDraft, confidence: null, reason: null, source: 'placeholder' } : null)
      return
    }

    let cancelled = false
    const cachedMessages = messageCacheRef.current[selectedThreadKey] ?? []
    const fullThreadAlreadyLoaded = Boolean(fullThreadLoadedRef.current[selectedThreadKey])
    if (cachedMessages.length > 0) {
      selectedMessagesThreadKeyRef.current = selectedThreadKey
      setSelectedMessages(cachedMessages)
    } else {
      selectedMessagesThreadKeyRef.current = selectedThreadKey
      setSelectedMessages([])
    }
    setHasMoreThreadHistory(!fullThreadAlreadyLoaded && cachedMessages.length >= FAST_THREAD_MAX_MESSAGES)
    setFullHistoryLoading(false)

    const hasExistingMessages = cachedMessages.length > 0
    setMessagesLoading(!hasExistingMessages)
    setMessagesSyncing(hasExistingMessages)
    setMessagesError(null)

    Promise.all([
      getThreadMessagesForThread(selected, { maxPages: FAST_THREAD_MAX_PAGES, maxMessages: FAST_THREAD_MAX_MESSAGES }),
      getThreadContext(selected),
      getSuggestedDraft(selected),
    ])
      .then(([messages, context, draft]) => {
        if (cancelled) return
        messageCacheRef.current[selectedThreadKey] = messages
        if (messages.length < FAST_THREAD_MAX_MESSAGES) {
          fullThreadLoadedRef.current[selectedThreadKey] = true
        }
        selectedMessagesThreadKeyRef.current = selectedThreadKey
        setSelectedMessages(messages)
        setThreadContext(context)
        setSuggestedDraft(draft)
        setHasMoreThreadHistory(!fullThreadLoadedRef.current[selectedThreadKey] && messages.length >= FAST_THREAD_MAX_MESSAGES)
        setLastRefreshAt(new Date().toISOString())
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Failed to load thread'
        setMessagesError(msg)
        if (selectedMessagesThreadKeyRef.current !== selectedThreadKey || selectedMessagesRef.current.length === 0) {
          // Fallback to thread preview as single message for first-load only.
          const fallback: ThreadMessage[] = [{
            id: `fallback-${selectedId}`,
            direction: 'inbound',
            body: selected.preview,
            createdAt: selected.lastMessageIso,
            deliveredAt: null,
            deliveryStatus: 'unknown',
            fromNumber: '',
            toNumber: '',
            ownerId: selected.leadId,
            prospectId: '',
            propertyId: selected.leadId,
            phoneNumber: '',
            canonicalE164: '',
            templateId: null,
            templateName: null,
            agentId: null,
            source: 'sms',
            rawStatus: 'unknown',
            error: null,
          }]
          messageCacheRef.current[selectedThreadKey] = fallback
          fullThreadLoadedRef.current[selectedThreadKey] = true
          selectedMessagesThreadKeyRef.current = selectedThreadKey
          setSelectedMessages(fallback)
          setHasMoreThreadHistory(false)
          if (selected.aiDraft) setSuggestedDraft({ text: selected.aiDraft, confidence: null, reason: null, source: 'placeholder' })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMessagesLoading(false)
          setMessagesSyncing(false)
        }
      })

    return () => { cancelled = true }
  }, [dataMode, selected, selectedId])

  const loadFullThreadHistory = useCallback(() => {
    if (!selected || fullHistoryLoading) return
    const selectedThreadKey = selected.threadKey ?? selected.id
    if (fullThreadLoadedRef.current[selectedThreadKey]) {
      setHasMoreThreadHistory(false)
      return
    }

    setFullHistoryLoading(true)
    getThreadMessagesForThread(selected)
      .then((messages) => {
        messageCacheRef.current[selectedThreadKey] = messages
        fullThreadLoadedRef.current[selectedThreadKey] = true
        selectedMessagesThreadKeyRef.current = selectedThreadKey
        setSelectedMessages(messages)
        setHasMoreThreadHistory(false)
      })
      .catch(() => undefined)
      .finally(() => setFullHistoryLoading(false))
  }, [fullHistoryLoading, selected])

  // ── Thread context separate loading indicator ──────────────────────────────
  useEffect(() => {
    setContextLoading(messagesLoading)
    setDraftLoading(messagesLoading)
  }, [messagesLoading])

  // ── Polling: refresh thread list every 15 seconds ─────────────────────────
  useEffect(() => {
    if (!shouldUseSupabase()) return

    const requestRefresh = (mode: 'poll' | 'realtime') => {
      const nowTs = Date.now()
      const minGap = mode === 'poll' ? 15_000 : 1_000
      if (nowTs - lastRefreshRequestAtRef.current < minGap) return
      lastRefreshRequestAtRef.current = nowTs
      setThreadRefreshNonce((value) => value + 1)
      setLastRefreshAt(new Date().toISOString())
    }

    const pollId = setInterval(() => requestRefresh('poll'), 15_000)
    setRealtimeStatus('polling')

    // Supabase realtime subscription (preferred)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let queueChannel: any = null
    if (hasSupabaseEnv) {
      try {
        const supabase = getSupabaseClient()
        channel = supabase
          .channel('inbox-message-events')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'message_events' },
            (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
              setNewMessageIndicator(true)
              requestRefresh('realtime')
              // If the change affects the selected thread, reload its messages and context
              const record = payload.new ?? payload.old
              const activeThread = selectedThreadRef.current
              if (record && activeThread && doesMessageBelongToThread(record, activeThread)) {
                setMessagesSyncing(true)
                Promise.all([
                  getThreadMessagesForThread(activeThread, { maxPages: FAST_THREAD_MAX_PAGES, maxMessages: FAST_THREAD_MAX_MESSAGES }),
                  getThreadContext(activeThread),
                ])
                  .then(([messages, context]) => {
                    const activeThreadKey = activeThread.threadKey ?? activeThread.id
                    messageCacheRef.current[activeThreadKey] = messages
                    setSelectedMessages(messages)
                    setThreadContext(context)
                    setHasMoreThreadHistory(!fullThreadLoadedRef.current[activeThreadKey] && messages.length >= FAST_THREAD_MAX_MESSAGES)
                    setLastRefreshAt(new Date().toISOString())
                  })
                  .catch(() => undefined)
                  .finally(() => setMessagesSyncing(false))
              }
            },
          )
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') setRealtimeStatus('subscribed')
          })

        // Subscribe to send_queue changes to update queueContext in real time
        queueChannel = supabase
          .channel('inbox-send-queue')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'send_queue' },
            () => {
              // Refresh context to reflect updated queue state
              const activeThread = selectedThreadRef.current
              if (activeThread) {
                getThreadContext(activeThread)
                  .then((ctx) => {
                    setThreadContext(ctx)
                    setLastRefreshAt(new Date().toISOString())
                  })
                  .catch(() => undefined)
              }
            },
          )
          .subscribe()
      } catch {
        // Realtime unavailable — polling fallback is active
        setRealtimeStatus('polling')
      }
    }

    return () => {
      clearInterval(pollId)
      if (channel) {
        try { channel.unsubscribe() } catch { /* ignore */ }
      }
      if (queueChannel) {
        try { queueChannel.unsubscribe() } catch { /* ignore */ }
      }
      setRealtimeStatus('off')
    }
  }, [])

  // ── SplitView event listener ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ surfacePath?: string }>).detail
      if (d?.surfacePath !== '/inbox') return
      if (selected) setSplitThread(selected)
    }
    window.addEventListener('nx:copilot-split-view', handler)
    return () => window.removeEventListener('nx:copilot-split-view', handler)
  }, [selected])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    setDraftText(draftByThreadId[id] ?? '')
    setShowAiActions(false)
    setScheduledTime(null)
    setNewMessageIndicator(false)
    messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    // Mark thread read in Supabase if enabled
    if (shouldUseSupabase()) {
      const thread = threads.find((item) => item.id === id)
      if (thread) {
        markThreadRead(thread)
          .then((result) => {
            if (!result.ok) {
              setLastMutationError(result.errorMessage ?? 'Could not persist read state')
              emitNotification({
                title: 'Read Update Failed',
                detail: result.errorMessage ?? 'Could not persist read state',
                severity: 'warning',
                sound: 'ui-confirm',
              })
              return
            }
            setWorkflowWriteTarget(result.writeTarget)
            setLastMutationPayload(result.mutationPayload)
            setLastMutationError(null)
            setThreads((prev) => prev.map((item) => {
              const key = item.threadKey ?? item.id
              if (key !== result.threadKey) return item
              return {
                ...item,
                isRead: true,
                unread: false,
                unreadCount: 0,
                status: item.status === 'archived' ? 'archived' : 'read',
                inboxStatus: 'read',
                threadIsRead: true,
                threadLastReadAt: new Date().toISOString(),
              }
            }))
          })
          .catch(() => undefined)
      }
    }
  }, [threads, draftByThreadId])

  const handleWorkflowMutation = useCallback(async (
    actionName: string,
    run: () => Promise<{ ok: boolean; writeTarget: string; errorMessage: string | null; threadKey: string; mutationPayload: Record<string, unknown> | null }>,
  ) => {
    try {
      const result = await run()
      if (!result.ok) {
        setLastMutationError(result.errorMessage ?? 'Could not persist workflow change')
        emitNotification({
          title: `${actionName} Failed`,
          detail: result.errorMessage ?? 'Could not persist workflow change',
          severity: 'critical',
          sound: 'ui-confirm',
        })
        return
      }
      setWorkflowWriteTarget(result.writeTarget)
      setLastMutationPayload(result.mutationPayload)
      setLastMutationError(null)

      setThreads((prev) => prev.map((item) => {
        const key = item.threadKey ?? item.id
        if (key !== result.threadKey) return item

        const next = { ...item }
        const payload = result.mutationPayload ?? {}

        if (typeof payload['priority'] === 'string') {
          const priority = payload['priority'] as InboxPriority
          if (['urgent', 'high', 'normal', 'low'].includes(priority)) {
            next.priority = priority
          }
        }

        if (typeof payload['status'] === 'string') {
          const status = String(payload['status']).toLowerCase()
          next.threadWorkflowStatus = status
          if (status === 'archived') {
            next.status = 'archived'
            next.isArchived = true
            next.inboxStatus = 'archived'
            next.threadIsArchived = true
          } else if (status === 'unread') {
            next.status = 'unread'
            next.isRead = false
            next.unread = true
            next.unreadCount = Math.max(1, next.unreadCount)
            next.inboxStatus = 'unread'
            next.threadIsRead = false
          } else if (status === 'read') {
            next.status = next.status === 'archived' ? 'archived' : 'read'
            next.isRead = true
            next.unread = false
            next.unreadCount = 0
            next.inboxStatus = 'read'
            next.threadIsRead = true
          } else {
            next.inboxStatus = status as InboxWorkflowStatus
          }
        }

        if (typeof payload['stage'] === 'string') {
          next.inboxStage = String(payload['stage']) as InboxStage
          next.threadWorkflowStage = String(payload['stage'])
        }

        if (typeof payload['is_read'] === 'boolean') {
          const isRead = Boolean(payload['is_read'])
          next.isRead = isRead
          next.threadIsRead = isRead
          next.unread = !isRead
          next.unreadCount = isRead ? 0 : Math.max(1, next.unreadCount)
          if (!isRead) next.status = 'unread'
          if (isRead && next.status !== 'archived') next.status = 'read'
          next.threadLastReadAt = isRead ? new Date().toISOString() : null
        }

        if (typeof payload['is_archived'] === 'boolean') {
          const isArchived = Boolean(payload['is_archived'])
          next.isArchived = isArchived
          next.threadIsArchived = isArchived
          next.status = isArchived ? 'archived' : (next.isRead ? 'read' : 'unread')
          next.inboxStatus = isArchived ? 'archived' : next.inboxStatus
          next.threadArchivedAt = isArchived ? new Date().toISOString() : null
        }

        if (typeof payload['is_pinned'] === 'boolean') {
          next.isPinned = Boolean(payload['is_pinned'])
          next.threadIsPinned = Boolean(payload['is_pinned'])
        }

        return next
      }))

      const selectedKey = selectedThreadRef.current?.threadKey ?? selectedThreadRef.current?.id ?? null
      const archivedMutation = result.mutationPayload?.['is_archived'] === true || result.mutationPayload?.['status'] === 'archived'
      if (archivedMutation && selectedKey && selectedKey === result.threadKey && workflowTab !== 'archived') {
        const idx = filtered.findIndex((thread) => (thread.threadKey ?? thread.id) === result.threadKey)
        const nextVisible = (idx >= 0 ? (filtered[idx + 1] ?? filtered[idx - 1] ?? null) : null)
        setSelectedId(nextVisible?.id ?? null)
      }

      emitNotification({
        title: actionName,
        detail: `Saved to ${result.writeTarget}`,
        severity: 'success',
        sound: 'ui-confirm',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown persistence error'
      setLastMutationError(message)
      emitNotification({
        title: `${actionName} Failed`,
        detail: message,
        severity: 'critical',
        sound: 'ui-confirm',
      })
    }
  }, [filtered, workflowTab])

  const handleQueueReply = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? draftText).trim()
    if (!text || !selected || queueReplyLoading) return
    setQueueReplyLoading(true)
    setQueueReplyError(null)
    const attempt = new Date().toISOString()
    setLastQueueReplyAttempt(attempt)
    const scheduledAt = scheduledTime ? new Date(scheduledTime.label).toISOString() : undefined
    let result: QueueReplyResult
    try {
      result = await queueReplyFromInbox(selected, text, scheduledAt ? { scheduledAt } : undefined)
    } catch (err) {
      result = { ok: false, queueId: null, status: null, errorMessage: String(err), insertPayloadKeys: [] }
    }
    setQueueReplyLoading(false)
    setQueueReplyStatus(result.ok ? (result.status ?? 'approval') : 'error')
    if (result.ok) {
      setInsertedQueueId(result.queueId)
      setQueuedReplyPreview(text)
      setComposerSendMode('queue_reply')
      setDraftText('')
      setScheduledTime(null)
      emitNotification({
        title: 'Reply Queued',
        detail: `Queued for approval — queue ID: ${result.queueId ?? 'pending'}`,
        severity: 'success',
        sound: 'ui-confirm',
      })
      // Refresh context to show updated queueContext
      if (shouldUseSupabase()) {
        Promise.all([getThreadContext(selected)])
          .then(([ctx]) => {
            setThreadContext(ctx)
            setThreadRefreshNonce((value) => value + 1)
            setLastRefreshAt(new Date().toISOString())
          })
          .catch(() => undefined)
      }
    } else {
      setQueueReplyError(result.errorMessage)
      emitNotification({
        title: 'Queue Failed',
        detail: result.errorMessage ?? 'Could not queue reply',
        severity: 'critical',
        sound: 'ui-confirm',
      })
    }
  }, [draftText, selected, queueReplyLoading, scheduledTime])

  const handleScheduleReply = useCallback(async (text: string, scheduledAt: string) => {
    if (!text.trim() || !selected) return
    setQueueReplyLoading(true)
    setQueueReplyError(null)
    setLastQueueReplyAttempt(new Date().toISOString())
    let result: QueueReplyResult
    try {
      result = await scheduleReplyFromInbox(selected, text, scheduledAt)
    } catch (err) {
      result = { ok: false, queueId: null, status: null, errorMessage: String(err), insertPayloadKeys: [] }
    }
    setQueueReplyLoading(false)
    if (result.ok) {
      setInsertedQueueId(result.queueId)
      setDraftText('')
      setScheduledTime(null)
      setSchedulePanelOpen(false)
      emitNotification({
        title: 'Reply Scheduled',
        detail: `Scheduled — queue ID: ${result.queueId ?? 'pending'}`,
        severity: 'success',
        sound: 'ui-confirm',
      })
      if (shouldUseSupabase() && selected) {
        getThreadContext(selected).then(setThreadContext).catch(() => undefined)
      }
    } else {
      setQueueReplyError(result.errorMessage)
      emitNotification({ title: 'Schedule Failed', detail: result.errorMessage ?? 'Could not schedule reply', severity: 'critical', sound: 'ui-confirm' })
    }
  }, [selected])

  const handleSendNow = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? draftText).trim()
    if (!text || !selected || sendNowLoading) return
    if (suppressionBlocked) {
      emitNotification({ title: 'Send Blocked', detail: suppressionReason ?? 'Recipient opted out', severity: 'warning', sound: 'ui-confirm' })
      return
    }
    setSendNowLoading(true)
    setSendNowError(null)
    const attempt = new Date().toISOString()
    setLastSendNowAttempt(attempt)

    // Optimistic bubble (deduped by timestamp key)
    const optimisticKey = `optimistic:${attempt}`
    setOptimisticMessages(prev => [...prev, { id: optimisticKey, body: text, createdAt: attempt, dedupeKey: optimisticKey }])

    let result: SendNowResult
    try {
      result = await sendInboxMessageNow(selected, text)
    } catch (err) {
      result = { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: String(err), insertPayloadKeys: [], suppressionBlocked: false, sendRouteUsed: 'none', queueProcessorEligible: false }
    }

    setSendNowLoading(false)
    setSendNowStatus(result.ok ? (result.deliveryStatus ?? 'queued') : 'error')
    setSendNowRouteUsed(result.sendRouteUsed)

    if (result.ok) {
      setSendNowProviderSid(result.providerMessageSid)
      setSendNowEventId(result.messageEventId)
      setSendQueueLastQueueKey(result.queueId)
      setSendQueueLastPayloadKeys(result.insertPayloadKeys)
      setQueueProcessorEligible(result.queueProcessorEligible)
      setComposerSendMode('send_now')
      // Remove optimistic bubble once we have a real event id or after refresh
      setOptimisticMessages(prev => prev.filter(m => m.dedupeKey !== optimisticKey))
      setDraftText('')
      setScheduledTime(null)
      emitNotification({
        title: 'Message Sent',
        detail: `Queued for immediate send — ${selected.ownerName}`,
        severity: 'success',
        sound: 'ui-confirm',
      })
      if (shouldUseSupabase()) {
        Promise.all([
          getThreadMessagesForThread(selected, { maxPages: FAST_THREAD_MAX_PAGES, maxMessages: FAST_THREAD_MAX_MESSAGES }),
          getThreadContext(selected),
        ])
          .then(([msgs, ctx]) => {
            const selectedThreadKey = selected.threadKey ?? selected.id
            messageCacheRef.current[selectedThreadKey] = msgs
            setSelectedMessages(msgs)
            setThreadContext(ctx)
            setHasMoreThreadHistory(!fullThreadLoadedRef.current[selectedThreadKey] && msgs.length >= FAST_THREAD_MAX_MESSAGES)
            setThreadRefreshNonce((value) => value + 1)
            setLastRefreshAt(new Date().toISOString())
            // Remove optimistic bubble now that real messages loaded
            setOptimisticMessages([])
          })
          .catch(() => undefined)
      }
    } else {
      // Replace optimistic bubble with failed state
      setOptimisticMessages(prev => prev.map(m => m.dedupeKey === optimisticKey ? { ...m, id: `failed:${attempt}` } : m))
      if (result.suppressionBlocked) {
        setSuppressionBlocked(true)
        setSuppressionReason(result.errorMessage)
      }
      setSendNowError(result.errorMessage)
      emitNotification({
        title: 'Send Failed',
        detail: result.errorMessage ?? 'Could not send message',
        severity: 'critical',
        sound: 'ui-confirm',
      })
    }
  }, [draftText, selected, sendNowLoading, suppressionBlocked, suppressionReason])

  const handleSend = useCallback(() => {
    // Route through send queue — no direct TextGrid from browser
    void handleSendNow()
  }, [handleSendNow])

  const handleTemplateInsert = useCallback((text: string) => {
    if (!text.trim()) return
    setDraftText((prev) => (prev.trim() ? `${prev.trim()}\n\n${text.trim()}` : text.trim()))
    composerRef.current?.focus()
  }, [])

  const handleTemplateReplace = useCallback((text: string) => {
    if (!text.trim()) return
    setDraftText(text.trim())
    composerRef.current?.focus()
  }, [])

  const handleTemplateSendNow = useCallback((text: string) => {
    if (!text.trim()) return
    setTemplateDrawerOpen(false)
    setComposerSendMode('send_now')
    void handleSendNow(text)
  }, [handleSendNow])

  const handleTemplateQueue = useCallback((text: string) => {
    if (!text.trim()) return
    setTemplateDrawerOpen(false)
    setComposerSendMode('queue_reply')
    void handleQueueReply(text)
  }, [handleQueueReply])

  const handleTemplateSchedule = useCallback((text: string) => {
    if (!text.trim()) return
    setDraftText(text.trim())
    setTemplateDrawerOpen(false)
    setSchedulePanelOpen(true)
    composerRef.current?.focus()
  }, [])

  // ── Suppression check when selected thread changes ─────────────────────────
  useEffect(() => {
    if (!selected?.phoneNumber || !shouldUseSupabase()) return
    const phone = selected.canonicalE164 || selected.phoneNumber
    if (phone === suppressionChecked) return
    // Quick opt-out check from thread data first
    if (selected.isOptOut) {
      setSuppressionBlocked(true)
      setSuppressionReason('Opted out')
      setSuppressionChecked(phone)
      return
    }
    setSuppressionBlocked(false)
    setSuppressionReason(null)
    checkSuppressionStatus(phone)
      .then(({ suppressed, reason }) => {
        setSuppressionBlocked(suppressed)
        setSuppressionReason(reason)
        setSuppressionChecked(phone)
      })
      .catch(() => undefined)
  }, [selected?.phoneNumber, selected?.canonicalE164, selected?.isOptOut, suppressionChecked])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const isTyping = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement
      return (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable
      )
    }

    const navTo = (direction: 'next' | 'prev', predicate?: (t: InboxThread) => boolean) => {
      const list = predicate ? filtered.filter(predicate) : filtered
      if (!list.length) return
      const curIdx = list.findIndex(t => t.id === selectedId)
      const next = direction === 'next'
        ? list[(curIdx + 1) % list.length]
        : list[(curIdx - 1 + list.length) % list.length]
      if (next) handleSelect(next.id)
    }

    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // ── ⌘Enter → send message ────────────────────────────────────────────
      if (meta && e.key === 'Enter' && isTyping(e)) {
        // handled inline on textarea; skip global re-trigger
        return
      }

      // ── ⌘J → load AI draft into composer ─────────────────────────────────
      if (meta && e.key === 'j') {
        e.preventDefault()
        if (selected?.aiDraft) setDraftText(selected.aiDraft)
        return
      }

      // ── ⌘⇧S → open schedule panel ────────────────────────────────────────
      if (meta && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        setSchedulePanelOpen(v => !v)
        return
      }

      // ── ⌘⇧T → open template library ─────────────────────────────────────
      if (meta && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        setTemplateDrawerOpen(true)
        return
      }

      // ── Esc → close overlays / exit layout mode ──────────────────────────
      if (e.key === 'Escape') {
        if (templateDrawerOpen) { setTemplateDrawerOpen(false); return }
        if (schedulePanelOpen) { setSchedulePanelOpen(false); return }
        if (commandOpen) { setCommandOpen(false); return }
        if (splitThread) { setSplitThread(null); return }
        if (mapOpen) { setMapOpen(false); setDossierTab('dossier'); return }
        if (layoutMode !== 'default') { restoreLayout(); return }
        if (searchQuery) { setSearchQuery(''); headerSearchRef.current?.blur(); return }
        return
      }

      // ── / → focus header search ───────────────────────────────────────────
      if (e.key === '/' && !isTyping(e)) {
        e.preventDefault()
        headerSearchRef.current?.focus()
        return
      }

      // ── Single-key shortcuts (skip when typing or any modifier key held) ───
      if (isTyping(e)) return
      if (meta || e.altKey) return

      switch (e.key) {
        case 'j': navTo('next'); break
        case 'k': navTo('prev'); break
        case 'J': navTo('next', t => t.status === 'unread' || t.priority === 'urgent'); break
        case 'K': navTo('prev', t => t.status === 'unread' || t.priority === 'urgent'); break
        case 'e': case 'E':
          if (selected) void handleWorkflowMutation('Thread Archived', () => archiveThread(selected))
          break
        case 'u': case 'U':
          if (selected) void handleWorkflowMutation('Marked Read', () => markThreadRead(selected))
          break
        case 'f': case 'F':
          if (selected) {
            const nextPinned = selected.isPinned ? unpinThread(selected) : pinThread(selected)
            void handleWorkflowMutation(selected.isPinned ? 'Thread Unpinned' : 'Thread Pinned', () => nextPinned)
          }
          break
        case 'r': case 'R':
          composerRef.current?.focus()
          break
        case 'd': case 'D':
          // dossier is visible when thread is selected — we can open split view
          if (selected) setSplitThread(selected)
          break
        case 'p': case 'P':
          if (selected) emitNotification({ title: 'Opening Property', detail: selected.subject, severity: 'info', sound: 'ui-confirm' })
          break
        case 'o': case 'O':
          if (selected) emitNotification({ title: 'Opening Offer Panel', detail: selected.ownerName, severity: 'info', sound: 'ui-confirm' })
          break
        case 'c': case 'C':
          if (selected) emitNotification({ title: 'Opening Comps', detail: selected.subject, severity: 'info', sound: 'ui-confirm' })
          break
        case 't': case 'T':
          if (selected) emitNotification({ title: 'Translating Response', detail: 'Translating AI draft…', severity: 'info', sound: 'ui-confirm' })
          break
        case 's': case 'S':
          setSchedulePanelOpen(v => !v)
          break
        case '[':
          setLeftPanelOpen(v => {
            const next = !v
            if (!next && !rightPanelOpen) setLayoutMode('conversation_focus')
            else setLayoutMode('default')
            return next
          })
          break
        case ']':
          setRightPanelOpen(v => {
            const next = !v
            if (!next && !leftPanelOpen) setLayoutMode('conversation_focus')
            else setLayoutMode('default')
            return next
          })
          break
        case '\\':
          if (e.shiftKey) {
            restoreLayout()
          } else {
            setLayoutMode(m => {
              if (m === 'triage') { restoreLayout(); return 'default' }
              setLeftPanelOpen(true)
              setRightPanelOpen(true)
              return 'triage'
            })
          }
          break
        case 'm': case 'M':
          if (!mapOpen) {
            setMapOpen(true)
            setDossierTab('map')
            setRightPanelOpen(true)
          } else {
            setMapOpen(false)
            setDossierTab('dossier')
          }
          break
        case 'z': case 'Z':
          if (mapOpen) setMapZoomed(v => !v)
          break
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selected, selectedId, commandOpen, schedulePanelOpen, splitThread, searchQuery, filtered, handleSelect, handleSend, layoutMode, leftPanelOpen, rightPanelOpen, mapOpen, templateDrawerOpen, handleWorkflowMutation])

  // ── ⌘⇧K — context palette (global shortcut, inbox handler) ───────────────
  useEffect(() => {
    const onContextPalette = () => setCommandOpen(v => !v)
    window.addEventListener('nx:context-palette', onContextPalette)
    return () => window.removeEventListener('nx:context-palette', onContextPalette)
  }, [])

  // ── Build Inbox command list ───────────────────────────────────────────────
  const commands: InboxCmd[] = [
    // Navigation
    { id: 'nav-next', label: 'Next Thread', category: 'Navigation', shortcut: 'J',
      keywords: ['down', 'next', 'thread'],
      action: () => {
        const idx = filtered.findIndex(t => t.id === selectedId)
        const next = filtered[(idx + 1) % filtered.length]
        if (next) handleSelect(next.id)
      }
    },
    { id: 'nav-prev', label: 'Previous Thread', category: 'Navigation', shortcut: 'K',
      keywords: ['up', 'back', 'previous', 'thread'],
      action: () => {
        const idx = filtered.findIndex(t => t.id === selectedId)
        const prev = filtered[(idx - 1 + filtered.length) % filtered.length]
        if (prev) handleSelect(prev.id)
      }
    },
    { id: 'nav-next-unread', label: 'Next Unread Thread', category: 'Navigation', shortcut: '⇧J',
      keywords: ['unread', 'new', 'next'],
      action: () => {
        const unread = filtered.filter(t => t.status === 'unread' || t.unreadCount > 0)
        if (!unread.length) return
        const idx = unread.findIndex(t => t.id === selectedId)
        const next = unread[(idx + 1) % unread.length]
        if (next) handleSelect(next.id)
      }
    },
    { id: 'nav-prev-unread', label: 'Previous Unread Thread', category: 'Navigation', shortcut: '⇧K',
      keywords: ['unread', 'new', 'previous'],
      action: () => {
        const unread = filtered.filter(t => t.status === 'unread' || t.unreadCount > 0)
        if (!unread.length) return
        const idx = unread.findIndex(t => t.id === selectedId)
        const prev = unread[(idx - 1 + unread.length) % unread.length]
        if (prev) handleSelect(prev.id)
      }
    },
    { id: 'nav-next-urgent', label: 'Next Urgent Thread', category: 'Navigation', keywords: ['urgent', 'p0', 'high priority'],
      action: () => {
        const urgent = filtered.filter(t => t.priority === 'urgent' || t.priority === 'high')
        const idx = urgent.findIndex(t => t.id === selectedId)
        const next = urgent[(idx + 1) % urgent.length]
        if (next) handleSelect(next.id)
      }
    },
    { id: 'nav-focus-view', label: 'Open Focus View', category: 'Navigation', shortcut: 'D',
      keywords: ['focus', 'expand', 'fullscreen', 'modal'],
      requiresThread: true,
      action: () => { if (selected) setSplitThread(selected) }
    },
    { id: 'nav-close-focus', label: 'Close Focus View', category: 'Navigation', shortcut: 'Esc',
      keywords: ['close', 'exit', 'dismiss'],
      action: () => setSplitThread(null)
    },

    // Reply
    { id: 'reply-focus', label: 'Focus Composer', category: 'Reply', shortcut: 'R',
      keywords: ['reply', 'respond', 'compose', 'write', 'message'],
      requiresThread: true,
      action: () => composerRef.current?.focus()
    },
    { id: 'reply-send', label: 'Send Message', category: 'Reply', shortcut: '⌘↵',
      keywords: ['send', 'submit', 'reply'],
      requiresThread: true,
      action: handleSend
    },
    { id: 'reply-draft-load', label: 'Load AI Draft into Composer', category: 'Reply', shortcut: '⌘J',
      keywords: ['draft', 'generate', 'ai', 'load', 'fill'],
      requiresThread: true,
      action: () => {
        if (selected?.aiDraft) {
          setDraftText(selected.aiDraft)
          composerRef.current?.focus()
        }
      }
    },
    { id: 'reply-clear', label: 'Clear Draft', category: 'Reply',
      keywords: ['clear', 'empty', 'reset', 'delete draft'],
      action: () => setDraftText('')
    },
    { id: 'reply-templates', label: 'Open Template Library', category: 'Reply', shortcut: '⌘⇧T',
      keywords: ['template', 'library', 'sms template', 'snippet'],
      requiresThread: true,
      action: () => setTemplateDrawerOpen(true)
    },

    // AI
    { id: 'ai-draft', label: 'Generate AI Draft', category: 'AI', shortcut: '⌘J',
      keywords: ['generate', 'draft', 'ai', 'write', 'suggest'],
      requiresThread: true,
      action: () => {
        if (selected?.aiDraft) {
          setDraftText(selected.aiDraft)
          emitNotification({ title: 'AI Draft Ready', detail: 'Draft loaded into composer', severity: 'success', sound: 'ui-confirm' })
        } else {
          emitNotification({ title: 'Generating Draft…', detail: 'AI is writing a response', severity: 'info', sound: 'ui-confirm' })
        }
      }
    },
    { id: 'ai-regen', label: 'Regenerate AI Draft', category: 'AI', shortcut: '⌘R',
      keywords: ['regenerate', 'retry', 'again', 'redo', 'new draft'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Regenerating…', detail: 'New draft generating', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'ai-warmer', label: 'Make Draft Warmer', category: 'AI',
      keywords: ['warm', 'friendly', 'soften', 'tone'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Adjusting Tone', detail: 'Draft made warmer', severity: 'success', sound: 'ui-confirm' })
    },
    { id: 'ai-shorter', label: 'Make Draft Shorter', category: 'AI',
      keywords: ['shorter', 'concise', 'brief', 'compact'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Adjusting Draft', detail: 'Draft made more concise', severity: 'success', sound: 'ui-confirm' })
    },
    { id: 'ai-direct', label: 'Make Draft More Direct', category: 'AI',
      keywords: ['direct', 'assertive', 'clear', 'bold'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Adjusting Draft', detail: 'Draft made more direct', severity: 'success', sound: 'ui-confirm' })
    },
    { id: 'ai-professional', label: 'Make Draft More Professional', category: 'AI',
      keywords: ['professional', 'formal', 'business'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Adjusting Draft', detail: 'Draft revised for professional tone', severity: 'success', sound: 'ui-confirm' })
    },
    { id: 'ai-translate', label: 'Translate Response', category: 'AI', shortcut: 'T',
      keywords: ['translate', 'spanish', 'language'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Translating', detail: 'Draft being translated', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'ai-summarize', label: 'Summarize Thread', category: 'AI',
      keywords: ['summarize', 'summary', 'tldr', 'overview'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Thread Summary', detail: selected?.preview ?? '', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'ai-intent', label: 'Explain Seller Intent', category: 'AI',
      keywords: ['intent', 'explain', 'analysis', 'motivation'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Seller Intent', detail: `${selected?.ownerName ?? ''} — ${selected?.sentiment ?? ''} signal`, severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'ai-next-action', label: 'Recommend Next Action', category: 'AI',
      keywords: ['recommend', 'next', 'action', 'nba', 'what to do'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Recommended Action', detail: selected ? nba(selected) : '', severity: 'success', sound: 'ui-confirm' })
    },
    { id: 'ai-score-temp', label: 'Score Lead Temperature', category: 'AI',
      keywords: ['score', 'temperature', 'heat', 'lead', 'rank'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Lead Score', detail: `${selected?.ownerName ?? ''}: ${selected?.sentiment ?? ''}`, severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'ai-risk', label: 'Show Negotiation Risk', category: 'AI',
      keywords: ['risk', 'negotiation', 'objection', 'danger'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Negotiation Risk', detail: 'Analysis complete — moderate risk', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'ai-ask', label: 'Ask AI About This Thread', category: 'AI',
      keywords: ['ask', 'question', 'ai', 'chat', 'explain'],
      requiresThread: true,
      action: () => emitNotification({ title: 'AI Context Loaded', detail: `Thread: ${selected?.subject ?? ''}`, severity: 'info', sound: 'ui-confirm' })
    },

    // Seller
    { id: 'seller-dossier', label: 'Open Seller Dossier', category: 'Seller', shortcut: 'D',
      keywords: ['seller', 'dossier', 'contact', 'profile'],
      requiresThread: true,
      action: () => { if (selected) setSplitThread(selected) }
    },
    { id: 'seller-sms-history', label: 'View SMS History', category: 'Seller',
      keywords: ['sms', 'history', 'messages', 'log'],
      requiresThread: true,
      action: () => emitNotification({ title: 'SMS History', detail: `${selected?.messageCount ?? 0} messages with ${selected?.ownerName ?? ''}`, severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'seller-timeline', label: 'View Property Timeline', category: 'Seller',
      keywords: ['timeline', 'history', 'property', 'track'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Property Timeline', detail: selected?.subject ?? '', severity: 'info', sound: 'ui-confirm' })
    },

    // Property
    { id: 'prop-open', label: 'Open Property', category: 'Property', shortcut: 'P',
      keywords: ['property', 'house', 'address', 'listing', 'open'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Opening Property', detail: selected?.subject ?? '', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'prop-comps', label: 'View Comps', category: 'Property', shortcut: 'C',
      keywords: ['comps', 'comparable', 'market', 'value'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Opening Comps', detail: `Comps for ${selected?.subject ?? ''}`, severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'prop-offer', label: 'Open Offer Panel', category: 'Property', shortcut: 'O',
      keywords: ['offer', 'price', 'bid', 'deal'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Offer Panel', detail: `Offer for ${selected?.ownerName ?? ''}`, severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'prop-title', label: 'Open Title Status', category: 'Property',
      keywords: ['title', 'status', 'escrow', 'closing'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Title Status', detail: 'Opening title tracker', severity: 'info', sound: 'ui-confirm' })
    },

    // Status
    { id: 'status-archive', label: 'Archive Thread', category: 'Status', shortcut: 'E',
      keywords: ['archive', 'clear', 'done', 'close'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Thread Archived', () => archiveThread(selected))
      }
    },
    { id: 'status-mark-read', label: 'Mark Read', category: 'Status', shortcut: 'U',
      keywords: ['read', 'seen', 'mark read'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Marked Read', () => markThreadRead(selected))
      }
    },
    { id: 'status-mark-unread', label: 'Mark Unread', category: 'Status',
      keywords: ['unread', 'new', 'unseen'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Marked Unread', () => markThreadUnread(selected))
      }
    },
    { id: 'status-flag', label: 'Flag Thread', category: 'Status', shortcut: 'F',
      keywords: ['flag', 'important', 'priority', 'star'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        const nextPinned = selected.isPinned ? unpinThread(selected) : pinThread(selected)
        void handleWorkflowMutation(selected.isPinned ? 'Thread Unpinned' : 'Thread Pinned', () => nextPinned)
      }
    },
    { id: 'status-urgent', label: 'Mark Urgent', category: 'Status',
      keywords: ['urgent', 'p0', 'asap', 'hot', 'critical'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Priority Updated', () => updateThreadPriority(selected, 'urgent'))
      }
    },
    { id: 'status-dnc', label: 'Mark DNC', category: 'Status',
      keywords: ['dnc', 'do not contact', 'stop', 'opt out', 'remove'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Stage Updated', () => updateThreadStage(selected, 'dnc_opt_out'))
      }
    },
    { id: 'status-wrong-number', label: 'Mark Wrong Number', category: 'Status',
      keywords: ['wrong number', 'bad number', 'incorrect'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Stage Updated', () => updateThreadStage(selected, 'wrong_number'))
      }
    },
    { id: 'status-not-interested', label: 'Mark Not Interested', category: 'Status',
      keywords: ['not interested', 'no', 'declined', 'rejected'],
      requiresThread: true,
      action: () => {
        if (!selected) return
        void handleWorkflowMutation('Stage Updated', () => updateThreadStage(selected, 'not_interested'))
      }
    },
    { id: 'status-snooze', label: 'Snooze Thread', category: 'Status',
      keywords: ['snooze', 'later', 'remind', 'delay'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Thread Snoozed', detail: `${selected?.ownerName ?? ''} — follow up in 3 days`, severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'status-follow-up', label: 'Create Follow-up Task', category: 'Status',
      keywords: ['follow up', 'task', 'reminder', 'schedule'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Follow-up Created', detail: `Reminder set for ${selected?.ownerName ?? ''}`, severity: 'success', sound: 'ui-confirm' })
    },

    // Filters
    { id: 'filter-unread', label: 'Show Unread', category: 'Filters',
      keywords: ['unread', 'new', 'unseen', 'inbox'],
      action: () => setWorkflowFilters((prev) => ({ ...prev, read: 'unread' }))
    },
    { id: 'filter-replied', label: 'Show Replied', category: 'Filters',
      keywords: ['replied', 'sent', 'responded'],
      action: () => {
        setWorkflowTab('sent')
        setWorkflowFilters((prev) => ({ ...prev, tab: 'sent' }))
      }
    },
    { id: 'filter-archived', label: 'Show Archived', category: 'Filters',
      keywords: ['archived', 'done', 'cleared'],
      action: () => {
        setWorkflowTab('archived')
        setWorkflowFilters((prev) => ({ ...prev, tab: 'archived' }))
      }
    },
    { id: 'filter-all', label: 'Show All Threads', category: 'Filters',
      keywords: ['all', 'clear filter', 'reset'],
      action: () => {
        setWorkflowTab('all')
        setWorkflowFilters({ tab: 'all' })
      }
    },
    { id: 'filter-urgent', label: 'Show Urgent (P0)', category: 'Filters',
      keywords: ['urgent', 'p0', 'critical', 'hot'],
      action: () => setWorkflowFilters((prev) => ({ ...prev, priority: 'urgent' }))
    },
    { id: 'filter-high', label: 'Show High Priority (P1)', category: 'Filters',
      keywords: ['high', 'p1'],
      action: () => setWorkflowFilters((prev) => ({ ...prev, priority: 'high' }))
    },
    { id: 'filter-normal', label: 'Show Normal Priority (P2)', category: 'Filters',
      keywords: ['normal', 'p2', 'medium'],
      action: () => setWorkflowFilters((prev) => ({ ...prev, priority: 'normal' }))
    },
    { id: 'filter-clear', label: 'Clear All Filters', category: 'Filters',
      keywords: ['clear', 'reset', 'remove filter', 'all'],
      action: () => {
        setWorkflowTab('all')
        setWorkflowFilters({ tab: 'all' })
        setSearchQuery('')
      }
    },
    { id: 'filter-by-seller', label: 'Search by Seller Name', category: 'Filters',
      keywords: ['seller', 'name', 'contact', 'search'],
      action: () => headerSearchRef.current?.focus()
    },

    // Layout
    { id: 'layout-toggle-queue', label: 'Toggle Thread Queue', category: 'Layout', shortcut: '[',
      keywords: ['queue', 'list', 'left panel', 'toggle', 'hide', 'show'],
      action: () => setLeftPanelOpen(v => !v)
    },
    { id: 'layout-toggle-dossier', label: 'Toggle Seller Dossier', category: 'Layout', shortcut: ']',
      keywords: ['dossier', 'right panel', 'sidebar', 'toggle', 'hide', 'show'],
      action: () => setRightPanelOpen(v => !v)
    },
    { id: 'layout-conversation-focus', label: 'Focus Conversation', category: 'Layout',
      keywords: ['focus', 'conversation', 'full', 'expand', 'center'],
      action: () => { setLeftPanelOpen(false); setRightPanelOpen(false); setLayoutMode('conversation_focus') }
    },
    { id: 'layout-triage', label: 'Enter Triage Mode', category: 'Layout', shortcut: '\\',
      keywords: ['triage', 'scan', 'review', 'prioritize', 'fast'],
      action: () => { setLeftPanelOpen(true); setRightPanelOpen(true); setLayoutMode('triage') }
    },
    { id: 'layout-restore', label: 'Restore Inbox Layout', category: 'Layout', shortcut: '⇧\\',
      keywords: ['restore', 'reset', 'default', 'layout'],
      action: restoreLayout
    },

    // Map
    { id: 'map-open', label: 'Open Map Side View', category: 'Map', shortcut: 'M',
      keywords: ['map', 'property', 'location', 'geography', 'view'],
      requiresThread: true,
      action: () => { setMapOpen(true); setDossierTab('map'); setRightPanelOpen(true) }
    },
    { id: 'map-close', label: 'Close Map Side View', category: 'Map',
      keywords: ['close map', 'hide map', 'dismiss map'],
      action: () => { setMapOpen(false); setDossierTab('dossier') }
    },
    { id: 'map-toggle', label: 'Toggle Map Side View', category: 'Map', shortcut: '⌘M',
      keywords: ['toggle map', 'map', 'property view'],
      requiresThread: true,
      action: () => {
        if (!mapOpen) { setMapOpen(true); setDossierTab('map'); setRightPanelOpen(true) }
        else { setMapOpen(false); setDossierTab('dossier') }
      }
    },
    { id: 'map-zoom-property', label: 'Zoom to Property', category: 'Map', shortcut: 'Z',
      keywords: ['zoom', 'property', 'focus location', 'zoom in'],
      requiresThread: true,
      action: () => { setMapOpen(true); setDossierTab('map'); setMapZoomed(true) }
    },
    { id: 'map-zoom-market', label: 'Zoom to Market', category: 'Map',
      keywords: ['market', 'zoom out', 'area', 'region'],
      requiresThread: true,
      action: () => { setMapOpen(true); setDossierTab('map'); setMapZoomed(false) }
    },
    { id: 'map-nearby', label: 'Show Nearby Activity', category: 'Map',
      keywords: ['nearby', 'surrounding', 'context', 'area', 'neighbors'],
      requiresThread: true,
      action: () => {
        setMapOpen(true)
        setDossierTab('map')
        setRightPanelOpen(true)
        emitNotification({ title: 'Nearby Activity', detail: 'Context dots loaded on map', severity: 'info', sound: 'ui-confirm' })
      }
    },
    { id: 'sched-open', label: 'Schedule Reply', category: 'Schedule', shortcut: '⌘⇧S',
      keywords: ['schedule', 'send later', 'delay', 'queue'],
      requiresThread: true,
      action: () => setSchedulePanelOpen(true)
    },
    { id: 'sched-best', label: 'Send at Best Contact Time', category: 'Schedule',
      keywords: ['best time', 'optimal', 'recommended', 'best contact'],
      requiresThread: true,
      action: () => setSchedulePanelOpen(true)
    },
    { id: 'sched-later-today', label: 'Send Later Today', category: 'Schedule',
      keywords: ['later', 'tonight', 'this evening', 'today'],
      requiresThread: true,
      action: () => setSchedulePanelOpen(true)
    },
    { id: 'sched-tomorrow-morning', label: 'Send Tomorrow Morning', category: 'Schedule',
      keywords: ['tomorrow', 'morning', '9am'],
      requiresThread: true,
      action: () => setSchedulePanelOpen(true)
    },
    { id: 'sched-tomorrow-evening', label: 'Send Tomorrow Evening', category: 'Schedule',
      keywords: ['tomorrow', 'evening', 'afternoon'],
      requiresThread: true,
      action: () => setSchedulePanelOpen(true)
    },
    { id: 'sched-1hr', label: 'Send in 1 Hour', category: 'Schedule',
      keywords: ['1 hour', 'one hour', 'soon', 'in an hour'],
      requiresThread: true,
      action: () => {
        const t = new Date(Date.now() + 3_600_000)
        const label = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        setScheduledTime({ description: 'In 1 hour', label: `Today ${label}`, iso: t.toISOString() })
        emitNotification({ title: 'Reply Scheduled', detail: `Scheduled for ${label}`, severity: 'success', sound: 'ui-confirm' })
      }
    },
    { id: 'sched-next-window', label: 'Send Next Contact Window', category: 'Schedule',
      keywords: ['next window', 'contact window', 'weekday', 'next available'],
      requiresThread: true,
      action: () => setSchedulePanelOpen(true)
    },
    { id: 'sched-view', label: 'View Scheduled Messages', category: 'Schedule',
      keywords: ['view scheduled', 'scheduled', 'queue', 'pending'],
      action: () => emitNotification({
        title: 'Scheduled Messages',
        detail: scheduledTime ? `1 message scheduled: ${scheduledTime.label}` : 'No messages scheduled',
        severity: 'info',
        sound: 'ui-confirm',
      })
    },
    { id: 'sched-reschedule', label: 'Reschedule Reply', category: 'Schedule',
      keywords: ['reschedule', 'change time', 'edit schedule'],
      requiresThread: true,
      action: () => { if (scheduledTime) setSchedulePanelOpen(true) }
    },
    { id: 'sched-cancel', label: 'Cancel Scheduled Reply', category: 'Schedule',
      keywords: ['cancel', 'remove', 'delete schedule', 'unschedule'],
      requiresThread: true,
      action: () => {
        setScheduledTime(null)
        emitNotification({ title: 'Schedule Cancelled', detail: 'Scheduled reply removed', severity: 'info', sound: 'ui-confirm' })
      }
    },
    { id: 'sched-send-now', label: 'Send Scheduled Reply Now', category: 'Schedule',
      keywords: ['send now', 'immediate', 'right now', 'send immediately'],
      requiresThread: true,
      action: () => { if (scheduledTime) handleSend() }
    },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={cls(
      'nx-inbox',
      'is-operator-rebuild',
      !leftPanelOpen && 'is-left-collapsed',
      !rightPanelOpen && 'is-right-collapsed',
      layoutMode === 'conversation_focus' && 'is-conversation-focus',
      layoutMode === 'triage' && 'is-triage-mode',
    )}>

      <header className="nx-inbox__hdr">
        <div className="nx-inbox__hdr-left">
          <div className="nx-inbox__hdr-title">
            <Icon name="inbox" className="nx-inbox__hdr-icon" />
            <span>Operator Inbox</span>
          </div>
        </div>

        <div className="nx-inbox__hdr-search">
          <Icon name="search" className="nx-inbox__hdr-search-icon" />
          <input
            ref={headerSearchRef}
            className="nx-inbox__hdr-search-input"
            type="text"
            placeholder="Search threads, sellers, or commands…"
            value={searchQuery}
            aria-label="Search inbox threads or enter a command"
            autoComplete="off"
            spellCheck={false}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setSearchQuery('')
                e.currentTarget.blur()
              }
            }}
          />
          {searchQuery && isCommandLike(searchQuery) && (
            <span className="nx-inbox__hdr-search-mode">CMD</span>
          )}
        </div>

        <div className="nx-inbox__hdr-right">
          {newMessageIndicator && <span className="nx-inbox-status-pill nx-inbox-status-pill--ai">New</span>}
          <span className="nx-inbox-status-pill nx-inbox-status-pill--live">{realtimeStatus === 'subscribed' ? 'Live' : 'Polling'}</span>
          <span className="nx-inbox-status-pill">Queue {baseStats.unreadCount}</span>
          {aiReady > 0 && (
            <span className="nx-inbox-status-pill nx-inbox-status-pill--ai">AI {aiReady}</span>
          )}
          <button type="button" className={cls('nx-inbox__hdr-layout-btn', !leftPanelOpen && 'is-active')} onClick={() => setLeftPanelOpen(v => !v)}>Queue</button>
          <button type="button" className={cls('nx-inbox__hdr-layout-btn', layoutMode === 'triage' && 'is-active')} onClick={() => { setLeftPanelOpen(true); setRightPanelOpen(true); setLayoutMode(m => m === 'triage' ? 'default' : 'triage') }}>Triage {hotCount > 0 ? hotCount : ''}</button>
          <button type="button" className={cls('nx-inbox__hdr-layout-btn', !rightPanelOpen && 'is-active')} onClick={() => setRightPanelOpen(v => !v)}>Dossier</button>
          <button type="button" className="nx-inbox__hdr-layout-btn" onClick={() => setCommandOpen(true)}>AI</button>
        </div>
      </header>

      {/* ══ Three-column body ════════════════════════════════════════════════ */}
      <div className="nx-inbox__body">

        {/* ── Left: Thread Queue ────────────────────────────────────────── */}
        <aside className="nx-inbox__queue">
          <div className="nx-inbox__queue-head">
            <div className="nx-inbox__queue-title-row">
              <div className="nx-inbox__queue-title">
                <Icon name="inbox" className="nx-inbox__queue-icon" />
                <span>Threads</span>
              </div>
              <div className="nx-inbox__queue-counts">
                <span className="nx-inbox__count-pill">{filtered.length}</span>
                <button type="button" className="nx-inline-button" onClick={() => setFiltersDrawerOpen((v) => !v)}>
                  {filtersDrawerOpen ? 'Hide Filters' : 'Filters'}
                </button>
              </div>
            </div>
            <InboxStatusTabs
              value={workflowTab}
              onChange={(tab) => {
                setWorkflowTab(tab)
                setWorkflowFilters((prev) => ({ ...prev, tab }))
              }}
            />
            <div className={cls('nx-inbox__filter-drawer', filtersDrawerOpen && 'is-open')}>
              <InboxFilterBar
                filters={workflowFilters}
                markets={Array.from(new Set(threads.map((thread) => thread.market || thread.marketId).filter(Boolean)))}
                onChange={(patch) => setWorkflowFilters((prev) => ({ ...prev, ...patch }))}
                onReset={() => {
                  setWorkflowTab('all')
                  setWorkflowFilters({ tab: 'all' })
                  setSearchQuery('')
                }}
              />
            </div>
          </div>

          <div className="nx-inbox__queue-meta">
            <span>{filtered.length} threads</span>
            {(Object.keys(workflowFilters).length > 1 || searchQuery) && (
              <button
                type="button"
                className="nx-inline-button"
                onClick={() => {
                  setWorkflowTab('all')
                  setWorkflowFilters({ tab: 'all' })
                  setSearchQuery('')
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="nx-inbox__queue-list">
            {workflowTab === 'sent' ? (
              <SentMessagesView
                messages={sentItems}
                onOpenThread={(threadKey) => {
                  const match = filtered.find((thread) => thread.threadKey === threadKey)
                  if (match) {
                    setWorkflowTab('all')
                    setWorkflowFilters((prev) => ({ ...prev, tab: 'all' }))
                    handleSelect(match.id)
                  }
                }}
              />
            ) : workflowTab === 'archived' ? (
              <ArchivedThreadsView
                threads={filtered}
                selectedId={selectedId}
                onSelect={handleSelect}
                onUnarchive={(thread) => {
                  void handleWorkflowMutation('Thread Unarchived', () => unarchiveThread(thread))
                }}
              />
            ) : (
              filtered.map((thread) => (
                <InboxThreadRow
                  key={thread.id}
                  thread={thread}
                  selected={selectedId === thread.id}
                  onSelect={() => handleSelect(thread.id)}
                  onMarkRead={!thread.isRead ? () => {
                    void handleWorkflowMutation('Marked Read', () => markThreadRead(thread))
                  } : undefined}
                  onArchive={() => {
                    void handleWorkflowMutation('Thread Archived', () => archiveThread(thread))
                  }}
                />
              ))
            )}
            {filtered.length === 0 && (
              <div className="nx-inbox__empty" role="status" aria-live="polite">
                <strong>No matching threads.</strong>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="nx-inline-button"
                    onClick={() => {
                      setWorkflowTab('all')
                      setWorkflowFilters({ tab: 'all' })
                      setSearchQuery('')
                    }}
                  >
                    Show All Threads
                  </button>
                  <button
                    type="button"
                    className="nx-inline-button"
                    onClick={() => setThreadRefreshNonce((n) => n + 1)}
                  >
                    Retry Live Fetch
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── Center: Conversation Workspace ────────────────────────────── */}
        <main className="nx-inbox__workspace">
          {liveFetchStatus === 'error' && (
            <div className="nx-inbox__messages-error" role="alert" aria-live="polite" style={{ marginBottom: 10, display: 'grid', gap: 8 }}>
              <span><strong>Live Inbox refresh failed.</strong> {liveFetchError ? ` ${liveFetchError}` : ''}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="nx-inline-button"
                  onClick={() => setThreadRefreshNonce((n) => n + 1)}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="nx-inline-button"
                  onClick={() => {
                    setWorkflowTab('all')
                    setWorkflowFilters({ tab: 'all' })
                    setSearchQuery('')
                  }}
                >
                  Reset View
                </button>
              </div>
            </div>
          )}
          {selected ? (
            <>
              <div className="nx-inbox__conv-head">
                <div className="nx-inbox__conv-subject-wrap">
                  <span className="nx-inbox__conv-seller">{selected.ownerName}</span>
                  <h2 className="nx-inbox__conv-subject">{selected.subject}</h2>
                  <div className="nx-inbox__conv-meta">
                    <span className={cls('nx-sent-pill', SENTIMENT_CLS[selected.sentiment])}>
                      {selected.sentiment}
                    </span>
                    <span className={cls('nx-pri-pill', PRIORITY_CLS[selected.priority])}>
                      {selected.priority}
                    </span>
                    <span className="nx-inbox__conv-msg-count">{selected.messageCount} messages</span>
                  </div>
                </div>
                <div className="nx-inbox__conv-actions">
                  {(threadListSyncing || messagesSyncing) && (
                    <span className="nx-inbox__sync-pill" title="Refreshing live data">
                      <span className="nx-inbox__sync-dot" />
                      syncing...
                    </span>
                  )}
                  <button type="button" className="nx-inbox__conv-btn" title="Reply (R)" onClick={() => composerRef.current?.focus()}>
                    <Icon name="send" className="nx-inbox__conv-btn-icon" />
                    Reply
                  </button>
                  <button
                    type="button"
                    className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                    title="Template Library (Cmd+Shift+T)"
                    onClick={() => setTemplateDrawerOpen(true)}
                  >
                    <Icon name="file-text" className="nx-inbox__conv-btn-icon" />
                    Templates
                  </button>
                  <InboxStageDropdown
                    stage={selected.inboxStage}
                    status={selected.inboxStatus}
                    priority={selected.priority as InboxPriority}
                    onStageChange={(next) => {
                      void handleWorkflowMutation('Stage Updated', () => updateThreadStage(selected, next as InboxStage))
                    }}
                    onStatusChange={(next) => {
                      void handleWorkflowMutation('Status Updated', () => updateThreadStatus(selected, next as InboxWorkflowStatus))
                    }}
                    onPriorityChange={(next) => {
                      void handleWorkflowMutation('Priority Updated', () => updateThreadPriority(selected, next as InboxPriority))
                    }}
                  />
                  <InboxThreadActions
                    thread={selected}
                    onArchive={() => { void handleWorkflowMutation('Thread Archived', () => archiveThread(selected)) }}
                    onUnarchive={() => { void handleWorkflowMutation('Thread Unarchived', () => unarchiveThread(selected)) }}
                    onMarkRead={() => { void handleWorkflowMutation('Marked Read', () => markThreadRead(selected)) }}
                    onMarkUnread={() => { void handleWorkflowMutation('Marked Unread', () => markThreadUnread(selected)) }}
                    onPin={() => { void handleWorkflowMutation('Thread Pinned', () => pinThread(selected)) }}
                    onUnpin={() => { void handleWorkflowMutation('Thread Unpinned', () => unpinThread(selected)) }}
                  />
                  <button
                    type="button"
                    className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                    title="Focus view (D)"
                    onClick={() => setSplitThread(selected)}
                  >
                    <Icon name="maximize" className="nx-inbox__conv-btn-icon" />
                    Focus
                  </button>
                </div>
              </div>

              {recommendedTemplates.length > 0 && (
                <div className="nx-inbox__queue-meta">
                  <span>Recommended Templates</span>
                  <div className="nx-inbox-thread-actions">
                    {recommendedTemplates.slice(0, 3).map((template) => {
                      const rendered = renderTemplate(
                        template,
                        buildTemplateContextFromThread(selected, threadContext),
                      )
                      return (
                        <button
                          key={template.id}
                          type="button"
                          className="nx-inline-button"
                          title={template.templateText}
                          onClick={() => setDraftText(rendered.renderedText)}
                        >
                          {template.useCase}
                        </button>
                      )
                    })}
                    <button type="button" className="nx-inline-button" onClick={() => setTemplateDrawerOpen(true)}>
                      Browse Library
                    </button>
                  </div>
                </div>
              )}

              <div className="nx-inbox__messages" ref={messagesRef}>
                <div className="nx-inbox-timeline-filters" role="tablist" aria-label="Timeline filters">
                  {['all', 'inbound', 'outbound', 'failed'].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={timelineFilter === mode}
                      className={cls('nx-inbox-timeline-filter', timelineFilter === mode && 'is-active')}
                      onClick={() => setTimelineFilter(mode as 'all' | 'inbound' | 'outbound' | 'failed')}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                {messagesLoading && (
                  <div className="nx-inbox__messages-loading">
                    <Icon name="activity" className="nx-inbox__messages-loading-icon" />
                    <span>Loading messages…</span>
                  </div>
                )}

                {messagesSyncing && !messagesLoading && (
                  <div className="nx-inbox__messages-sync">Syncing latest events...</div>
                )}

                {!messagesLoading && messagesError && (
                  <div className="nx-inbox__messages-error">
                    <span>Could not refresh messages. Showing last known state.</span>
                  </div>
                )}

                {!messagesLoading && selectedMessages.length === 0 && !messagesError && (
                  <div className="nx-inbox__messages-empty">
                    <span>No messages loaded yet.</span>
                  </div>
                )}

                {selectedMessages
                  .filter((msg) => {
                    if (timelineFilter === 'all') return true
                    if (timelineFilter === 'failed') return Boolean(msg.error) || ['failed', 'undelivered', 'error'].includes(msg.deliveryStatus)
                    return msg.direction === timelineFilter
                  })
                  .map((msg) => (
                  <div
                    key={msg.id}
                    className={cls(
                      'nx-msg-card',
                      msg.direction === 'inbound' ? 'nx-msg-card--inbound' : 'nx-msg-card--outbound',
                      msg.direction === 'inbound' && selected?.sentiment === 'hot' && 'is-hot-msg',
                      msg.direction === 'inbound' && selected?.sentiment === 'warm' && 'is-warm-msg',
                      msg.error && 'is-failed-msg',
                    )}
                  >
                    <div className="nx-msg-card__head">
                      <div className="nx-msg-card__sender">
                        {msg.direction === 'inbound' && selected && (
                          <span className={cls('nx-thread-card__sentiment', SENTIMENT_CLS[selected.sentiment])} />
                        )}
                        <strong className="nx-msg-card__name">
                          {msg.direction === 'inbound' ? (selected?.ownerName ?? 'Seller') : 'Operator'}
                        </strong>
                        {msg.agentId && (
                          <span className="nx-msg-card__agent-badge">Agent</span>
                        )}
                        {msg.templateName && (
                          <span className="nx-msg-card__template-badge">{msg.templateName}</span>
                        )}
                      </div>
                      <div className="nx-msg-card__head-right">
                        <span className="nx-msg-card__channel">
                          <Icon name="message" className="nx-msg-card__channel-icon" />
                          {msg.source.toUpperCase()}
                        </span>
                        <span
                          className={cls(
                            'nx-msg-card__status',
                            msg.deliveryStatus === 'delivered' && 'is-delivered',
                            msg.deliveryStatus === 'failed' && 'is-failed',
                            msg.deliveryStatus === 'sent' && 'is-sent',
                          )}
                        >
                          {msg.deliveryStatus}
                        </span>
                        <span className="nx-msg-card__time">
                          {formatRelativeTime(msg.createdAt)}
                        </span>
                      </div>
                    </div>
                    <p className="nx-msg-card__body">{msg.body || <em>No message body</em>}</p>
                    {msg.error && (
                      <div className="nx-msg-card__error">
                        <Icon name="alert" className="nx-msg-card__error-icon" />
                        {msg.error}
                      </div>
                    )}
                    <div className="nx-msg-card__submeta">
                      {msg.direction === 'inbound' ? 'Inbound seller message' : 'Outbound reply'}
                      {msg.fromNumber && ` • ${msg.fromNumber}`}
                      {msg.direction === 'outbound' && (
                        <>
                          {msg.deliveredAt && ` • sent ${formatRelativeTime(msg.deliveredAt)}`}
                          {` • provider ${msg.deliveryStatus || 'unknown'}`}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {hasMoreThreadHistory && (
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="nx-inline-button"
                      onClick={loadFullThreadHistory}
                      disabled={fullHistoryLoading}
                    >
                      {fullHistoryLoading ? 'Loading full history...' : 'Load full thread history'}
                    </button>
                  </div>
                )}

                {suggestedDraft && !draftLoading && (
                  <div className="nx-ai-draft-card">
                    <div className="nx-ai-draft-card__head">
                      <div className="nx-ai-draft-card__label">
                        <Icon name="spark" className="nx-ai-draft-card__icon" />
                        <span>AI Draft Dock</span>
                      </div>
                    </div>
                    <textarea
                      className="nx-ai-draft-card__editor"
                      rows={2}
                      value={draftText || suggestedDraft.text}
                      onChange={(e) => setDraftText(e.target.value)}
                    />
                    <div className="nx-ai-draft-card__actions">
                      <button
                        type="button"
                        className={cls('nx-inbox__conv-btn', sendNowLoading && 'is-loading')}
                        title={suppressionBlocked ? (suppressionReason ?? 'Recipient opted out') : 'Send this reply immediately via queue processor'}
                        disabled={sendNowLoading || queueReplyLoading || suppressionBlocked || !(draftText || suggestedDraft.text)}
                        onClick={() => void handleSendNow(draftText || suggestedDraft.text)}
                      >
                        <Icon name="send" className="nx-inbox__conv-btn-icon" />
                        {sendNowLoading ? 'Sending…' : suppressionBlocked ? 'Blocked' : 'Send Now'}
                      </button>
                      <button
                        type="button"
                        className={cls('nx-inbox__conv-btn nx-inbox__conv-btn--ghost', queueReplyLoading && 'is-loading')}
                        title="Queue for operator approval"
                        disabled={sendNowLoading || queueReplyLoading || !(draftText || suggestedDraft.text)}
                        onClick={() => void handleQueueReply(draftText || suggestedDraft.text)}
                      >
                        {queueReplyLoading ? 'Queuing…' : 'Queue Reply'}
                      </button>
                      <button
                        type="button"
                        className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                        onClick={() => setTemplateDrawerOpen(true)}
                      >
                        Templates
                      </button>
                      <button
                        type="button"
                        className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                        onClick={() => { setDraftText(draftText || suggestedDraft.text); composerRef.current?.focus() }}
                      >
                        Move To Composer
                      </button>
                      <button
                        type="button"
                        className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                        onClick={() => {
                          if (selected) {
                            setDraftLoading(true)
                            getSuggestedDraft(selected)
                              .then(setSuggestedDraft)
                              .catch(() => undefined)
                              .finally(() => setDraftLoading(false))
                          }
                        }}
                      >
                        Regenerate
                      </button>
                    </div>
                  </div>
                )}

                {draftLoading && (
                  <div className="nx-ai-draft-card nx-ai-draft-card--loading">
                    <Icon name="spark" className="nx-ai-draft-card__icon" />
                    <span>Generating draft…</span>
                  </div>
                )}

                {/* ── Optimistic outbound bubble(s) ───────────────────────── */}
                {optimisticMessages.map((om) => (
                  <div key={om.id} className="nx-msg-card nx-msg-card--outbound nx-msg-card--optimistic">
                    <div className="nx-msg-card__head">
                      <div className="nx-msg-card__sender">
                        <strong className="nx-msg-card__name">You (sending…)</strong>
                      </div>
                      <div className="nx-msg-card__head-right">
                        <span className="nx-msg-card__time">{formatRelativeTime(om.createdAt)}</span>
                      </div>
                    </div>
                    <p className="nx-msg-card__body">{om.body}</p>
                    <div className="nx-msg-card__submeta">
                      {om.id.startsWith('failed:') ? '⚠️ Send failed — see diagnostics' : '⏳ Queuing for send…'}
                    </div>
                  </div>
                ))}
              </div>

              <div className="nx-inbox__composer">
                {/* Suppression warning */}
                {suppressionBlocked && (
                  <div className="nx-inbox__scheduled-banner" style={{ background: 'var(--nx-color-critical, #c0392b)', color: '#fff' }}>
                    <span className="nx-inbox__scheduled-label">
                      ⛔ {suppressionReason ?? 'Recipient opted out / suppressed'} — sending disabled
                    </span>
                  </div>
                )}
                {scheduledTime && (
                  <div className="nx-inbox__scheduled-banner">
                    <span className="nx-inbox__scheduled-label">
                      Scheduled for {scheduledTime.label}
                    </span>
                    <div className="nx-inbox__scheduled-actions">
                      <button type="button" className="nx-inbox__scheduled-btn" onClick={() => setSchedulePanelOpen(true)}>Edit</button>
                      <button type="button" className="nx-inbox__scheduled-btn" onClick={() => setScheduledTime(null)}>Cancel</button>
                      <button type="button" className="nx-inbox__scheduled-btn nx-inbox__scheduled-btn--primary" onClick={handleSend}>Send Now</button>
                    </div>
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  className="nx-inbox__composer-input"
                  placeholder={`Reply to ${selected.ownerName}… (⌘↵ to send)`}
                  rows={3}
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draftText.trim()) {
                      e.preventDefault()
                      if (composerSendMode === 'queue_reply') {
                        void handleQueueReply()
                      } else {
                        handleSend()
                      }
                    }
                  }}
                />
                {showAiActions && (
                  <div className="nx-inbox__ai-bar">
                    <button type="button" className="nx-ai-action">Generate Reply</button>
                    <button type="button" className="nx-ai-action">Soften Tone</button>
                    <button type="button" className="nx-ai-action">Add Urgency</button>
                    <button type="button" className="nx-ai-action">Translate</button>
                  </div>
                )}
                <div className="nx-inbox__composer-bar">
                  <div className="nx-inbox__composer-tools">
                    <button type="button" className="nx-compose-tool" title="Attach File" aria-label="Attach file">
                      <Icon name="layers" className="nx-compose-tool__icon" />
                    </button>
                    <button
                      type="button"
                      className={cls('nx-compose-tool', showAiActions && 'is-active')}
                      title="AI Assist (⌘J)"
                      aria-label="Toggle AI assist"
                      onClick={() => setShowAiActions(v => !v)}
                    >
                      <Icon name="spark" className="nx-compose-tool__icon" />
                    </button>
                    <button type="button" className="nx-compose-tool" title="Templates" aria-label="Insert template" onClick={() => setTemplateDrawerOpen(true)}>
                      <Icon name="file-text" className="nx-compose-tool__icon" />
                    </button>
                  </div>
                  <div className="nx-inbox__composer-actions">
                    <button
                      type="button"
                      className="nx-inbox__schedule-btn"
                      onClick={() => setSchedulePanelOpen(true)}
                      title="Schedule send (⌘⇧S)"
                    >
                      Schedule
                    </button>
                    <button
                      type="button"
                      className="nx-inbox__schedule-btn"
                      disabled={!draftText.trim() || queueReplyLoading || sendNowLoading}
                      onClick={() => {
                        setComposerSendMode('queue_reply')
                        void handleQueueReply()
                      }}
                      title="Queue for operator approval"
                    >
                      {queueReplyLoading ? 'Queuing…' : 'Queue Reply'}
                    </button>
                    <button
                      type="button"
                      className="nx-inbox__send-btn"
                      disabled={!draftText.trim() || sendNowLoading || suppressionBlocked}
                      onClick={() => {
                        setComposerSendMode('send_now')
                        void handleSendNow()
                      }}
                      title={suppressionBlocked ? (suppressionReason ?? 'Recipient opted out') : 'Send Now via queue processor (⌘↵)'}
                    >
                      <Icon name="send" className="nx-inbox__send-btn-icon" />
                      {sendNowLoading ? 'Sending…' : 'Send Now'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="nx-inbox__workspace-empty">
              <p>Keep operating from the thread rail. Select a thread to inspect the conversation.</p>
            </div>
          )}
        </main>

        {/* ── Right: Seller Dossier / Map ──────────────────────────────── */}
        {selected && (
          <aside className="nx-inbox__dossier nx-inbox__dossier--compact">
            {/* Tabs — Dossier | Map (shown when map is open) */}
            {mapOpen && (
              <div className="nx-dossier__tabs">
                <button
                  type="button"
                  className={cls('nx-dossier__tab', dossierTab === 'dossier' && 'is-active')}
                  onClick={() => setDossierTab('dossier')}
                >
                  Dossier
                </button>
                <button
                  type="button"
                  className={cls('nx-dossier__tab', dossierTab === 'map' && 'is-active')}
                  onClick={() => setDossierTab('map')}
                >
                  Map
                  {mapZoomed && <span className="nx-dossier__tab-badge">⬬</span>}
                </button>
              </div>
            )}

            {/* Map tab */}
            {dossierTab === 'map' && mapOpen && (
              <InboxCommandMap thread={selected} zoomedIn={mapZoomed} />
            )}

            {/* Dossier content (default, or when dossier tab is active) */}
            {(dossierTab === 'dossier' || !mapOpen) && (
              <div className="nx-dossier__content">
            {!contextLoading && !threadContext && (
              <div className="nx-dossier__section">
                <div className="nx-dossier__value">No linked seller context found yet.</div>
              </div>
            )}
            <div className="nx-dossier__section nx-dossier__card nx-dossier__card--seller">
              <h3 className="nx-dossier__section-title">Seller</h3>
              <div className="nx-dossier__name">
                {contextLoading ? '…' : (threadContext?.seller?.name ?? selected.ownerName)}
              </div>
              <div className="nx-dossier__pills">
                <span className={cls('nx-pri-pill', PRIORITY_CLS[selected.priority])}>{selected.priority}</span>
                <span className={cls('nx-sent-pill', SENTIMENT_CLS[selected.sentiment])}>{selected.sentiment}</span>
              </div>
              <div className="nx-dossier__row">
                <span className="nx-dossier__label">Market</span>
                <span className="nx-dossier__value">
                  {formatMarket(threadContext?.seller?.market ?? threadContext?.property?.market ?? selected.marketId)}
                </span>
              </div>
              <div className="nx-dossier__row">
                <span className="nx-dossier__label">Last Active</span>
                <span className="nx-dossier__value">{selected.lastMessageLabel}</span>
              </div>
              <div className="nx-dossier__row">
                <span className="nx-dossier__label">Messages</span>
                <span className="nx-dossier__value">{selectedMessages.length || selected.messageCount}</span>
              </div>
              {threadContext?.phone && (
                <div className="nx-dossier__row">
                  <span className="nx-dossier__label">Phone</span>
                  <span className="nx-dossier__value">{threadContext.phone}</span>
                </div>
              )}
              {threadContext?.contactStack && threadContext.contactStack.length > 0 && (
                <div className="nx-dossier__row">
                  <span className="nx-dossier__label">Contacts</span>
                  <div className="nx-dossier__contact-stack">
                    {threadContext.contactStack.map((c, i) => (
                      <span key={i} className="nx-dossier__contact-chip">
                        <Icon name={c.type === 'email' ? 'briefing' : 'message'} className="nx-dossier__contact-icon" />
                        {c.value}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="nx-dossier__section nx-dossier__card nx-dossier__card--deal">
              <h3 className="nx-dossier__section-title">Deal Context</h3>
              <div className="nx-dossier__subject">
                {contextLoading ? '…' : (threadContext?.property?.address ?? selected.subject)}
              </div>
              <div className="nx-dossier__row">
                <span className="nx-dossier__label">Stage</span>
                <span className="nx-dossier__value">
                  {threadContext?.dealContext?.stage ?? stage(selected)}
                </span>
              </div>
              <div className="nx-dossier__row">
                <span className="nx-dossier__label">Next Action</span>
                <span className="nx-dossier__value nx-dossier__value--accent">
                  {threadContext?.dealContext?.nextAction ?? nba(selected)}
                </span>
              </div>
              {threadContext?.queueContext && threadContext.queueContext.items.length > 0 && (
                <div className="nx-dossier__row">
                  <span className="nx-dossier__label">Queue</span>
                  <span className="nx-dossier__value">
                    {threadContext.queueContext.items.length} item(s) • {threadContext.queueContext.items[0]?.status}
                  </span>
                </div>
              )}
              {/* Queued reply badge after successful queueReplyFromInbox */}
              {queuedReplyPreview && (
                <div className="nx-dossier__row">
                  <span className="nx-dossier__label">Queued Reply</span>
                  <span className="nx-dossier__value nx-dossier__value--accent" title={queuedReplyPreview}>
                    ⏳ Awaiting approval{insertedQueueId ? ` · ${insertedQueueId.slice(0, 8)}` : ''}
                  </span>
                </div>
              )}
              {selected.labels.length > 0 && (
                <div className="nx-dossier__tags">
                  {selected.labels.map(l => (
                    <span key={l} className="nx-dossier__tag">{l}</span>
                  ))}
                </div>
              )}
            </div>

            {threadContext?.aiContext && (
              <div className="nx-dossier__section">
                <h3 className="nx-dossier__section-title">AI Intelligence</h3>
                {threadContext.aiContext.summary && (
                  <div className="nx-dossier__row">
                    <span className="nx-dossier__label">Summary</span>
                    <span className="nx-dossier__value">{threadContext.aiContext.summary}</span>
                  </div>
                )}
                {threadContext.aiContext.intent && (
                  <div className="nx-dossier__row">
                    <span className="nx-dossier__label">Intent</span>
                    <span className="nx-dossier__value nx-dossier__value--accent">{threadContext.aiContext.intent}</span>
                  </div>
                )}
                <div className="nx-dossier__row">
                  <span className="nx-dossier__label">Sentiment</span>
                  <span className={cls('nx-sent-pill', SENTIMENT_CLS[selected.sentiment])}>
                    {threadContext.aiContext.sentiment || selected.sentiment}
                  </span>
                </div>
              </div>
            )}

            <div className="nx-dossier__section nx-dossier__section--nba">
              <h3 className="nx-dossier__section-title">Suggested Action</h3>
              <div className="nx-dossier__nba">{threadContext?.dealContext?.nextAction ?? nba(selected)}</div>
              <p className="nx-dossier__nba-reason">
                {selected.priority === 'urgent'
                  ? 'Thread requires immediate attention.'
                  : selected.sentiment === 'hot'
                  ? 'Seller is actively engaged and time-sensitive.'
                  : selected.sentiment === 'warm'
                  ? 'Seller is showing continued interest.'
                  : 'Monitor for next engagement signal.'}
              </p>
              <div className="nx-dossier__reco-meta">
                <span className="nx-dossier__reco-urgency">
                  {selected.priority === 'urgent'
                    ? 'Urgency: Critical'
                    : selected.priority === 'high'
                    ? 'Urgency: High'
                    : 'Urgency: Standard'}
                </span>
              </div>
            </div>

            <div className="nx-dossier__section nx-dossier__card nx-dossier__card--quick-actions">
              <h3 className="nx-dossier__section-title">Quick Actions</h3>
              <div className="nx-dossier__actions">
                <button
                  type="button"
                  className="nx-dossier__action-btn"
                  title="Open property (P)"
                  onClick={() => emitNotification({ title: 'Opening Property', detail: threadContext?.property?.address ?? selected.subject, severity: 'info', sound: 'ui-confirm' })}
                >
                  <Icon name="map" className="nx-dossier__action-icon" />
                  View Property
                </button>
                <button
                  type="button"
                  className="nx-dossier__action-btn"
                  title="View comps (C)"
                  onClick={() => emitNotification({ title: 'Opening Comps', detail: threadContext?.property?.address ?? selected.subject, severity: 'info', sound: 'ui-confirm' })}
                >
                  <Icon name="trending-up" className="nx-dossier__action-icon" />
                  View Comps
                </button>
                <button
                  type="button"
                  className="nx-dossier__action-btn nx-dossier__action-btn--primary"
                  title="Send offer (O)"
                  onClick={() => emitNotification({ title: 'Opening Offer Panel', detail: threadContext?.seller?.name ?? selected.ownerName, severity: 'info', sound: 'ui-confirm' })}
                >
                  <Icon name="send" className="nx-dossier__action-icon" />
                  Send Offer
                </button>
                <button
                  type="button"
                  className="nx-dossier__action-btn"
                  title="Map side view (M)"
                  onClick={() => { setMapOpen(true); setDossierTab('map') }}
                >
                  <Icon name="map" className="nx-dossier__action-icon" />
                  Map View
                </button>
                {/* TODO: Link Contact — wire to phones/prospects table when contact linking is built */}
                {!threadContext?.contextDebug?.matchedPhoneBy && (
                  <button
                    type="button"
                    className="nx-dossier__action-btn"
                    title="Link this phone number to a contact (not yet implemented)"
                    disabled
                    onClick={() => emitNotification({ title: 'Link Contact', detail: 'Contact linking coming soon — phone not found in phones table', severity: 'info', sound: 'ui-confirm' })}
                  >
                    <Icon name="layers" className="nx-dossier__action-icon" />
                    Link Contact
                  </button>
                )}
              </div>
            </div>
            {import.meta.env.DEV && (
              <div className="nx-dossier__section">
                <button
                  type="button"
                  className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                  onClick={() => setShowDiagnostics((v) => !v)}
                >
                  {showDiagnostics ? 'Hide' : 'Show'} Inbox Diagnostics
                </button>
                {showDiagnostics && (
                  <div className="nx-dossier__row" style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                    <span className="nx-dossier__value">selectedThreadId: {selected.id}</span>
                    <span className="nx-dossier__value">selectedThreadKey: {selected.threadKey ?? selected.id}</span>
                    <span className="nx-dossier__value">stateRowFound: {String(selected.stateRowFound ?? false)}</span>
                    <span className="nx-dossier__value">archive/read mutation payload: {lastMutationPayload ? JSON.stringify(lastMutationPayload) : '-'}</span>
                    <span className="nx-dossier__value">last mutation error: {lastMutationError ?? '-'}</span>
                    <span className="nx-dossier__value">threadKey: {selected.threadKey ?? '-'}</span>
                    <span className="nx-dossier__value">groupingMethod: {selected.groupingMethod ?? '-'}</span>
                    <span className="nx-dossier__value">groupingConfidence: {selected.groupingConfidence ?? '-'}</span>
                    <span className="nx-dossier__value">ownerId: {selected.ownerId ?? '-'}</span>
                    <span className="nx-dossier__value">prospectId: {selected.prospectId ?? '-'}</span>
                    <span className="nx-dossier__value">propertyId: {selected.propertyId ?? '-'}</span>
                    <span className="nx-dossier__value">phoneNumber: {selected.phoneNumber ?? '-'}</span>
                    <span className="nx-dossier__value">canonicalE164: {selected.canonicalE164 ?? '-'}</span>
                    <span className="nx-dossier__value">sellerPhoneSourceField: {selected.sellerPhoneSourceField ?? '-'}</span>
                    <span className="nx-dossier__value">ourNumber: {selected.ourNumber ?? '-'}</span>
                    <span className="nx-dossier__value">directionUsed: {selected.directionUsed ?? '-'}</span>
                    <span className="nx-dossier__value">message_event_key: {selected.messageEventKey ?? '-'}</span>
                    <span className="nx-dossier__value">provider_message_sid: {selected.providerMessageSid ?? '-'}</span>
                    <span className="nx-dossier__value">queue_id: {selected.queueId ?? '-'}</span>
                    <span className="nx-dossier__value">phone_number_id: {selected.phoneNumberId ?? '-'}</span>
                    <span className="nx-dossier__value">textgrid_number_id: {selected.textgridNumberId ?? '-'}</span>
                    <span className="nx-dossier__value">is_opt_out: {selected.isOptOut != null ? String(selected.isOptOut) : '-'}</span>
                    <span className="nx-dossier__value">delivery_status: {selected.deliveryStatus ?? '-'}</span>
                    <span className="nx-dossier__value">provider_delivery_status: {selected.providerDeliveryStatus ?? '-'}</span>
                    <span className="nx-dossier__value">failure_reason: {selected.failureReason ?? '-'}</span>
                    <span className="nx-dossier__value">property_address: {selected.propertyAddress ?? '-'}</span>
                    <span className="nx-dossier__value">master_owner_id: {selected.ownerId ?? '-'}</span>
                    <span className="nx-dossier__value">prospect_id: {selected.prospectId ?? '-'}</span>
                    <span className="nx-dossier__value">property_id: {selected.propertyId ?? '-'}</span>
                    <span className="nx-dossier__value">messageCount: {selectedMessages.length || selected.messageCount}</span>
                    <span className="nx-dossier__value">latestInbound: {selected.lastInboundAt ?? '-'}</span>
                    <span className="nx-dossier__value">latestOutbound: {selected.lastOutboundAt ?? '-'}</span>
                    <span className="nx-dossier__value">needsResponse: {String(selected.needsResponse ?? false)}</span>
                    <span className="nx-dossier__value">unread: {String(selected.unread ?? selected.unreadCount > 0)}</span>
                    <span className="nx-dossier__value">contextMatchQuality: {threadContext?.contextMatchQuality ?? 'missing'}</span>
                    <span className="nx-dossier__value">resolvedPhoneTable: {threadContext?.contextDebug?.resolvedPhoneTable ?? '-'}</span>
                    <span className="nx-dossier__value">resolvedMasterOwnerTable: {threadContext?.contextDebug?.resolvedMasterOwnerTable ?? '-'}</span>
                    <span className="nx-dossier__value">resolvedOwnerTable: {threadContext?.contextDebug?.resolvedOwnerTable ?? '-'}</span>
                    <span className="nx-dossier__value">matchedPhoneBy: {threadContext?.contextDebug?.matchedPhoneBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedPhoneRowId: {threadContext?.contextDebug?.matchedPhoneRowId ?? '-'}</span>
                    <span className="nx-dossier__value">bridgedMasterOwnerId: {threadContext?.contextDebug?.bridgedMasterOwnerId ?? '-'}</span>
                    <span className="nx-dossier__value">bridgedProspectId: {threadContext?.contextDebug?.bridgedProspectId ?? '-'}</span>
                    <span className="nx-dossier__value">bridgedPropertyId: {threadContext?.contextDebug?.bridgedPropertyId ?? '-'}</span>
                    <span className="nx-dossier__value">matchedOwnerBy: {threadContext?.contextDebug?.matchedOwnerBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedProspectBy: {threadContext?.contextDebug?.matchedProspectBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedPropertyBy: {threadContext?.contextDebug?.matchedPropertyBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedPhoneBy: {threadContext?.contextDebug?.matchedPhoneBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedAiBrainBy: {threadContext?.contextDebug?.matchedAiBrainBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedQueueBy: {threadContext?.contextDebug?.matchedQueueBy ?? '-'}</span>
                    <span className="nx-dossier__value">realtimeStatus: {realtimeStatus}</span>
                    <span className="nx-dossier__value">lastRefreshAt: {lastRefreshAt ?? '-'}</span>
                    <span className="nx-dossier__value">lastQueueReplyAttempt: {lastQueueReplyAttempt ?? '-'}</span>
                    <span className="nx-dossier__value">queueReplyStatus: {queueReplyStatus ?? '-'}</span>
                    <span className="nx-dossier__value">insertedQueueId: {insertedQueueId ?? '-'}</span>
                    <span className="nx-dossier__value">queueReplyError: {queueReplyError ?? '-'}</span>
                    <span className="nx-dossier__value">lastSendNowAttempt: {lastSendNowAttempt ?? '-'}</span>
                    <span className="nx-dossier__value">sendNowStatus: {sendNowStatus ?? '-'}</span>
                    <span className="nx-dossier__value">sendNowError: {sendNowError ?? '-'}</span>
                    <span className="nx-dossier__value">sendNowProviderSid: {sendNowProviderSid ?? '-'}</span>
                    <span className="nx-dossier__value">sendNowEventId: {sendNowEventId ?? '-'}</span>
                    <span className="nx-dossier__value">sendNowRouteUsed: {sendNowRouteUsed ?? '-'}</span>
                    <span className="nx-dossier__value">workflowWriteTarget: {workflowWriteTarget}</span>
                    <span className="nx-dossier__value">dataMode: {dataMode}</span>
                    <span className="nx-dossier__value">liveFetchStatus: {liveFetchStatus}</span>
                    <span className="nx-dossier__value">liveFetchError: {liveFetchError ?? '-'}</span>
                    <span className="nx-dossier__value">messageEventsCount: {messageEventsCount ?? '-'}</span>
                    <span className="nx-dossier__value">messageEventsRawCount: {messageEventsRawCount ?? '-'}</span>
                    <span className="nx-dossier__value">groupedThreadCount: {groupedThreadCount ?? '-'}</span>
                    <span className="nx-dossier__value">filteredThreadCount: {filtered.length}</span>
                    <span className="nx-dossier__value">sendQueueCount: {sendQueueCount ?? '-'}</span>
                    <span className="nx-dossier__value">lastLiveFetchAt: {lastLiveFetchAt ?? '-'}</span>
                    <span className="nx-dossier__value">activeTab: {workflowTab}</span>
                    <span className="nx-dossier__value">activeFilters: {JSON.stringify({ ...workflowFilters, search: searchQuery })}</span>
                    <span className="nx-dossier__value">hasSupabaseEnv: {String(hasSupabaseEnv)}</span>
                    <span className="nx-dossier__value">useSupabaseData: {String(useSupabaseData)}</span>
                    <span className="nx-dossier__value">sendQueuePhoneFieldUsed: to_phone_number</span>
                    <span className="nx-dossier__value">sendQueueMessageFieldUsed: message_body / message_text</span>
                    <span className="nx-dossier__value">sendQueueStatusFieldUsed: queue_status</span>
                    <span className="nx-dossier__value">sendQueueLastQueueKey: {sendQueueLastQueueKey ?? '-'}</span>
                    <span className="nx-dossier__value">sendQueueLastPayloadKeys: {sendQueueLastPayloadKeys.length ? sendQueueLastPayloadKeys.join(', ') : '-'}</span>
                    <span className="nx-dossier__value">queueProcessorEligible: {queueProcessorEligible === null ? '-' : String(queueProcessorEligible)}</span>
                    <span className="nx-dossier__value">queueProcessorSelection: queue_status=queued AND scheduled_for&lt;=now</span>
                    <span className="nx-dossier__value">suppressionBlocked: {String(suppressionBlocked)}</span>
                    <span className="nx-dossier__value">suppressionReason: {suppressionReason ?? '-'}</span>
                    <span className="nx-dossier__value">optimisticCount: {optimisticMessages.length}</span>
                  </div>
                )}
              </div>
            )}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ══ Command Palette ════════════════════════════════════════════════ */}
      <InboxCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        hasThread={!!selected}
        commands={commands}
      />

      <TemplateLibraryDrawer
        open={templateDrawerOpen}
        thread={selected}
        threadContext={threadContext}
        onClose={() => setTemplateDrawerOpen(false)}
        onInsert={handleTemplateInsert}
        onReplace={handleTemplateReplace}
        onSendNow={handleTemplateSendNow}
        onQueue={handleTemplateQueue}
        onSchedule={handleTemplateSchedule}
      />

      <InboxSchedulePanel
        open={schedulePanelOpen}
        onClose={() => setSchedulePanelOpen(false)}
        thread={selected}
        onSchedule={time => {
          setScheduledTime(time)
          // If there's draft text, schedule it now
          if (draftText.trim() && selected) {
            void handleScheduleReply(draftText, time.label)
          } else {
            emitNotification({
              title: 'Reply Scheduled',
              detail: `Scheduled for ${time.label}`,
              severity: 'success',
              sound: 'ui-confirm',
            })
          }
        }}
      />

      {/* ══ Focus / SplitView ══════════════════════════════════════════════ */}
      <SplitView
        open={!!splitThread}
        title={splitThread?.subject ?? ''}
        subtitle={splitThread?.ownerName}
        badge={
          splitThread ? (
            <span className={`nx-sent-pill ${SENTIMENT_CLS[splitThread.sentiment]}`}>
              {splitThread.sentiment}
            </span>
          ) : undefined
        }
        onClose={() => setSplitThread(null)}
      >
        {splitThread && (
          <div className="nx-split-thread">
            <div className="nx-split-thread__intel">
              <Icon name="spark" className="nx-split-thread__icon" />
              <span>
                {splitThread.sentiment === 'hot'
                  ? `High urgency — ${splitThread.ownerName} is actively engaged.`
                  : splitThread.sentiment === 'warm'
                  ? `Active interest — maintain momentum with ${splitThread.ownerName}.`
                  : `Monitor thread for intent signals from ${splitThread.ownerName}.`}
              </span>
            </div>
            <div className="nx-split-thread__message">
              <strong>{splitThread.ownerName}</strong>
              <p>{splitThread.preview}</p>
              <span className="nx-split-thread__time">{splitThread.lastMessageLabel}</span>
            </div>
            {splitThread.aiDraft && (
              <div className="nx-split-thread__draft">
                <div className="nx-split-thread__draft-label">
                  <Icon name="spark" className="nx-split-thread__draft-icon" />
                  AI Draft Ready
                </div>
                <p>{splitThread.aiDraft}</p>
                <button
                  type="button"
                  className="nx-primary-button"
                  onClick={() => {
                    emitNotification({ title: 'Draft Sent', detail: `Response sent to ${splitThread.ownerName}`, severity: 'success', sound: 'ui-confirm' })
                    setSplitThread(null)
                  }}
                >
                  <Icon className="nx-primary-button__icon" name="send" />
                  Send Draft
                </button>
              </div>
            )}
            <div className="nx-split-thread__meta">
              <div className="nx-info-row"><span>Priority</span><strong>{splitThread.priority}</strong></div>
              <div className="nx-info-row"><span>Messages</span><strong>{splitThread.messageCount}</strong></div>
              <div className="nx-info-row"><span>Unread</span><strong>{splitThread.unreadCount}</strong></div>
            </div>
          </div>
        )}
      </SplitView>
    </div>
  )
}
