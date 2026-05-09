import { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue } from 'react'
import { createPortal } from 'react-dom'
import { pushRoutePath } from '../../app/router'
import { useInboxData, toWorkflowThread } from './inbox.adapter'
import {
  updateThreadStage,
  updateThreadStatus,
  starThread,
  unstarThread,
  pinThread,
  unpinThread,
  archiveThread,
  unarchiveThread,
  markThreadRead,
  markThreadUnread,
  markThreadHot,
  snoozeThread,
  pauseAutomation,
  resumeAutomation,
  retryFailedSend,
  suppressThread,
  type InboxStatus,
  type SellerStage,
  type InboxWorkflowThread,
} from '../../lib/data/inboxWorkflowData'


import {
  getQueueProcessorHealth,
  getThreadIntelligence,
  getThreadMessagesForThread,
  getThreadContext,
  queueReplyFromInbox,
  scheduleReplyFromInbox,
  sendInboxMessageNow,
  SERVER_INBOX_THREAD_STAGE_VALUES,
  type QueueProcessorHealth,
  type ThreadIntelligenceRecord,
  type ThreadMessage,
  type ThreadContext,
  dedupeMessages,
  toThreadMessage,
} from '../../lib/data/inboxData'
import { fetchQueueModel, type QueueModel } from '../../lib/data/queueData'
import { fetchSmsTemplates, type SmsTemplate } from '../../lib/data/templateData'
import { fetchInboxActivity, logInboxActivity, type InboxActivityEvent } from '../../lib/data/inboxActivityData'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { emitNotification } from '../../shared/NotificationToast'
import { Icon } from '../../shared/icons'
import { NexusTopBar } from './components/NexusTopBar'
import { InboxSidebar } from './components/InboxSidebar'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { ComposerTranslationBar } from './components/ComposerTranslationBar'
import { IntelligencePanel } from './components/IntelligencePanel'
import type { TemplateActionPayload } from './components/TemplatePopover'
import { InboxActivityPanel } from './components/InboxActivityPanel'
import { InboxCommandMap } from './InboxCommandMap'
import { InboxUtilityDrawer, MapDossierDrawer } from './components/InboxUtilityDrawer'
import { AICopilotPanel } from './copilot/AICopilotPanel'
import { CopilotOrb } from '../../shared/copilot/CopilotOrb'
import { AdvancedFiltersPopover } from './components/AdvancedFiltersPopover'
import { InboxCommandPalette, type InboxCmd } from './InboxCommandPalette'
import { InboxSchedulePanel, type ScheduledTime } from './InboxSchedulePanel'
import { ThreadDebugModal } from './components/ThreadDebugModal'

import { translateText } from './translate.api'
import { buildThreadCommandIntel, type ThreadCommandIntel } from './ai-command-center'
import { buildAutonomousEngineModel, defaultAutonomyControlState, type AutonomyControlState } from './autonomy-engine'
import {
  closeMapMode,
  cycleInboxMode,
  cycleLeftPanelMode,
  cycleMapMode,
  cycleRightPanelMode,
  defaultInboxLayoutState,
  defaultMapSourceMode,
  getLayoutClassNames,
  layoutToastForState,
  openMapMode,
  resetLayoutMode,
  type ActiveOverlay,
  type MapSourceMode,
} from './inbox-layout-state'
import {
  applyInboxFilters,
  getAdvancedFilterOptions,
  getInboxViewCounts,
  getSavedPresetConfig,
  isSuppressedThread,
  type ApplyInboxFiltersOptions,
  type InboxAdvancedFilters,
  type InboxSavedFilterPreset,
  type InboxStageSelectValue,
  type InboxViewSelectValue,
} from './inbox-ui-helpers'
import './inbox-premium.css'
import './inbox-rebuild.css'
import './inbox-polish.css'
import './copilot/copilot.css'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  de: 'German',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
}

type ThreadTranslateViewMode = 'original' | 'translated'

const normalizeLanguageCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase().replace('_', '-')
  if (!cleaned) return null
  if (cleaned.startsWith('english')) return 'en'
  if (cleaned.startsWith('spanish')) return 'es'
  return cleaned
}

const languageLabelFor = (languageCode: string | null): string => {
  if (!languageCode) return 'Unknown'
  const baseCode = languageCode.split('-')[0]
  return LANGUAGE_LABELS[baseCode] ?? languageCode.toUpperCase()
}

const isEnglishLanguage = (languageCode: string | null): boolean => {
  if (!languageCode) return false
  return languageCode.startsWith('en')
}

export default function InboxPage() {
  const { data, loading: dataLoading, refresh: refreshInbox, loadMore, recentlyUpdatedThreadIds } = useInboxData()
  const DEV = Boolean(import.meta.env.DEV)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<InboxStageSelectValue>('all_stages')
  const [viewFilter, setViewFilter] = useState<InboxViewSelectValue>('priority')
  const [savedPreset, setSavedPreset] = useState<InboxSavedFilterPreset>('my_priority')
  const [advancedFilters, setAdvancedFilters] = useState<InboxAdvancedFilters>({ outOfStateOwner: 'all' })
  const [rightViewFilter, setRightViewFilter] = useState<InboxViewSelectValue>('active')
  const [rightSavedPreset, setRightSavedPreset] = useState<InboxSavedFilterPreset>('new_inbounds')
  const [searchQuery, setSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([])
  const [pendingMessagesByThread, setPendingMessagesByThread] = useState<Record<string, ThreadMessage[]>>({})
  const [visibleThreadCount, setVisibleThreadCount] = useState(1000)
  const [mapSourceMode, setMapSourceMode] = useState<MapSourceMode>(defaultMapSourceMode)

  const [messagesLoading, setMessagesLoading] = useState(false)
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [threadIntelligence, setThreadIntelligence] = useState<ThreadIntelligenceRecord | null>(null)
  const [queueProcessorHealth, setQueueProcessorHealth] = useState<QueueProcessorHealth | null>(null)
  const [queueProcessorHealthLoading, setQueueProcessorHealthLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [threadViewMode, setThreadViewMode] = useState<ThreadTranslateViewMode>('original')
  const [threadTranslations, setThreadTranslations] = useState<Record<string, string>>({})
  const [translatedDraftPreview, setTranslatedDraftPreview] = useState<string | null>(null)
  const [originalDraftBeforeTranslation, setOriginalDraftBeforeTranslation] = useState<string | null>(null)
  const [detectedThreadLanguage, setDetectedThreadLanguage] = useState<string | null>(null)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [threadTranslationLoading, setThreadTranslationLoading] = useState(false)
  const [draftTranslationLoading, setDraftTranslationLoading] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false)
  const [scheduledTime, setScheduledTime] = useState<ScheduledTime | null>(null)
  const [scheduledTemplatePayload, setScheduledTemplatePayload] = useState<TemplateActionPayload | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [layoutState, setLayoutState] = useState(defaultInboxLayoutState)
  const [dossierFull, setDossierFull] = useState(false)
  const [optimisticPatches, setOptimisticPatches] = useState<Record<string, Partial<InboxWorkflowThread>>>({})
  const [isAiListening, setIsAiListening] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [debugModalOpen, setDebugModalOpen] = useState(false)

  const [queueModel, setQueueModel] = useState<QueueModel | null>(null)
  const [templateInventory, setTemplateInventory] = useState<SmsTemplate[]>([])
  const [activityFeed, setActivityFeed] = useState<InboxActivityEvent[]>([])
  const [autonomyControls, setAutonomyControls] = useState<AutonomyControlState>(defaultAutonomyControlState)
  const messageCacheRef = useRef<Record<string, ThreadMessage[]>>({})
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const rawThreads = useMemo(() => (data.threads ?? []).map(toWorkflowThread), [data.threads])
  const threads = useMemo(() => {
    return rawThreads.map(t => optimisticPatches[t.id] ? { ...t, ...optimisticPatches[t.id] } : t)
  }, [rawThreads, optimisticPatches])

  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    const withCoords = threads.filter((t) => {
      const lat = (t as any).lat ?? (t as any).latitude ?? 0
      const lng = (t as any).lng ?? (t as any).longitude ?? 0
      return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0
    })
    console.log('[InboxPage]', {
      rawThreads: rawThreads.length,
      threadsAfterPatches: threads.length,
      withCoords: withCoords.length,
      sampleLat: withCoords[0] ? ((withCoords[0] as any).lat ?? (withCoords[0] as any).latitude) : null,
      sampleLng: withCoords[0] ? ((withCoords[0] as any).lng ?? (withCoords[0] as any).longitude) : null,
    })
  }

  const mapThreads = useMemo(() => {
    const pins = data.mapPins ?? []
    if (pins.length === 0) return threads
    const pinByKey = new Map(pins.map((pin) => [pin.threadKey || pin.id, pin]))
    const seen = new Set<string>()
    const hydrated = threads.map((thread) => {
      const pin = pinByKey.get(thread.threadKey || thread.id)
      if (!pin) return thread
      seen.add(pin.threadKey || pin.id)
      return {
        ...thread,
        lat: pin.lat,
        lng: pin.lng,
        propertyAddress: thread.propertyAddress || pin.propertyAddress,
        latestMessageBody: thread.latestMessageBody || pin.latestMessageBody,
      }
    })
    const synthetic = pins
      .filter((pin) => !seen.has(pin.threadKey || pin.id))
      .map((pin) => ({
        id: pin.threadKey || pin.id,
        threadKey: pin.threadKey || pin.id,
        ownerName: pin.ownerName || 'Unknown Seller',
        subject: pin.propertyAddress || 'Property pin',
        preview: pin.latestMessageBody || 'Map pin',
        propertyAddress: pin.propertyAddress,
        marketId: 'unknown',
        priority: 'normal',
        inboxStatus: 'waiting',
        conversationStage: pin.stage || 'needs_review',
        lat: pin.lat,
        lng: pin.lng,
        lastMessageAt: new Date().toISOString(),
        lastMessageIso: new Date().toISOString(),
        lastMessageBody: pin.latestMessageBody || '',
        isRead: true,
      } as InboxWorkflowThread))
    return [...hydrated, ...synthetic]
  }, [data.mapPins, threads])

  const advancedFilterOptions = useMemo(() => getAdvancedFilterOptions(threads), [threads])
  
  const viewCounts = useMemo(() => {
    const local = getInboxViewCounts(threads)
    const pick = (backend: number | null | undefined, localVal: number) => {
      if (data.dataMode !== 'live') return localVal
      if (backend !== null && backend !== undefined) return backend
      return localVal
    }

    const priority = pick(data.priorityInboxCount, local.priority)
    const active = pick(data.activeInboxCount, local.active)
    const waiting = pick(data.waitingInboxCount, local.waiting)
    const all = pick(data.allInboxCount, local.all)
    const unread = pick(data.unreadThreadsCount, local.needs_response)

    return {
      ...local,
      priority,
      active,
      waiting,
      all,
      unread,
      needs_reply: pick(data.counts?.needs_reply, local.needs_reply),
      positive_hot: pick(data.counts?.positive_hot, local.positive_hot),
      missing_context: pick(data.counts?.missing_context, local.missing_context),
      auto_replied: pick(data.counts?.auto_replied, local.auto_replied),
      auto_reply_failed: local.auto_reply_failed,
      offer_requested: local.offer_requested,
      wrong_number: local.wrong_number,
      opt_out: pick(data.counts?.suppressed, local.opt_out),
      manual_review: pick(data.counts?.manual_review, local.manual_review),
      my_priority: priority,
      new_inbounds: active,
      offer_needed: waiting,
      review_required: all,
      active_conversations: active,
      waiting_for_reply: waiting,
      all_threads: all,
      archived_leads: pick(data.archivedThreadsCount, local.archived),
      wrong_numbers: pick(data.hiddenThreadsCount, local.hidden),
      suppressed: pick(data.suppressedThreadsCount, local.suppressed),
    }
  }, [threads, data])

  const serverFilterOptions: ApplyInboxFiltersOptions = useMemo(() => {
    const live = data.dataMode === 'live'
    const double = layoutState.inboxMode === 'full_double'
    return {
      skipViewFilter: live && !double,
      skipStageFilter: live && !double && stageFilter !== 'all_stages' && SERVER_INBOX_THREAD_STAGE_VALUES.has(stageFilter),
    }
  }, [data.dataMode, layoutState.inboxMode, stageFilter])

  const filtered = useMemo(() => (
    applyInboxFilters(threads, {
      search: searchQuery,
      stage: stageFilter,
      view: viewFilter,
      advanced: advancedFilters,
    }, serverFilterOptions)
  ), [threads, searchQuery, stageFilter, viewFilter, advancedFilters, serverFilterOptions])

  const handleLoadMore = useCallback(async () => {
    await loadMore()
    setVisibleThreadCount(prev => prev + 200)
  }, [loadMore])

  const searchResults = useMemo(() => (
    deferredSearchQuery.trim()
      ? applyInboxFilters(threads, {
          search: deferredSearchQuery,
          stage: 'all_stages',
          view: 'all',
          advanced: {},
        })
      : []
  ), [threads, deferredSearchQuery])

  const selected = useMemo(() => {
    if (selectedId) {
      const byId = threads.find((thread) => thread.id === selectedId)
      if (byId) return byId
    }
    if (selectedThreadKey) {
      const byThreadKey = threads.find((thread) => (thread.threadKey || thread.id) === selectedThreadKey)
      if (byThreadKey) return byThreadKey
    }
    return selectedId ? null : (filtered[0] ?? null)
  }, [filtered, threads, selectedId, selectedThreadKey])

  const selectedFilteredOut = useMemo(() => (
    Boolean(selected && !filtered.some((thread) => thread.id === selected.id))
  ), [filtered, selected])

  useEffect(() => {
    if (!selected) return
    if (selected.id !== selectedId) setSelectedId(selected.id)
    if ((selected.threadKey || selected.id) !== selectedThreadKey) {
      setSelectedThreadKey(selected.threadKey || selected.id)
    }
  }, [selected, selectedId, selectedThreadKey])

  useEffect(() => {
    if (!DEV) return
    const first = filtered[0] as unknown as { uiIntent?: string; ui_intent?: string; priorityBucket?: string; priority_bucket?: string } | undefined
    console.log('[NEXUS Inbox Diagnostics]', {
      totalCount: data.totalCount,
      loadedCount: data.loadedCount ?? threads.length,
      activeFilterKey: viewFilter,
      activeCategory: viewFilter,
      fullyHydratedCount: data.fullyHydratedCount ?? 0,
      partiallyHydratedCount: data.partiallyHydratedCount ?? 0,
      orphanCount: data.orphanCount ?? 0,
      latestFetchMs: data.latestFetchMs ?? 0,
      realtimeConnected: data.realtimeConnected ?? false,
      firstThreadUiIntent: first?.uiIntent ?? first?.ui_intent ?? null,
      firstThreadPriorityBucket: first?.priorityBucket ?? first?.priority_bucket ?? null,
    })
  }, [DEV, data, filtered, threads.length, viewFilter])

  const selectedSuppressed = useMemo(() => (selected ? isSuppressedThread(selected) : false), [selected])

  const selectedPendingMessages = useMemo(() => {
    if (!selected) return []
    return pendingMessagesByThread[selected.id] ?? []
  }, [pendingMessagesByThread, selected])

  const displayedMessages = useMemo(() => (
    dedupeMessages([...selectedMessages, ...selectedPendingMessages])
  ), [selectedMessages, selectedPendingMessages])

  const commandIntel = useMemo(
    () => buildThreadCommandIntel(selected, displayedMessages, threadContext, threadIntelligence),
    [displayedMessages, selected, threadContext, threadIntelligence],
  )

  const liveCommandFeed = useMemo<ThreadCommandIntel[]>(() => {
    const selectedKey = selected?.threadKey || selected?.id || null
    return threads
      .slice(0, 8)
      .map((thread) => buildThreadCommandIntel(
        thread,
        (thread.threadKey || thread.id) === selectedKey ? displayedMessages : [],
        (thread.threadKey || thread.id) === selectedKey ? threadContext : null,
        (thread.threadKey || thread.id) === selectedKey ? threadIntelligence : null,
      ))
      .filter((item): item is ThreadCommandIntel => Boolean(item))
  }, [displayedMessages, selected?.id, selected?.threadKey, threadContext, threadIntelligence, threads])

  const autonomyModel = useMemo(
    () => buildAutonomousEngineModel({
      threads,
      threadIntel: liveCommandFeed,
      queueModel,
      templates: templateInventory,
      activities: activityFeed,
      controls: autonomyControls,
    }),
    [activityFeed, autonomyControls, liveCommandFeed, queueModel, templateInventory, threads],
  )

  const sellerLanguageCode = useMemo(() => {
    if (!selected && !threadIntelligence) return null

    const selectedRecord = (selected ?? {}) as unknown as Record<string, unknown>
    const intelligenceRecord = (threadIntelligence ?? {}) as Record<string, unknown>

    const candidates: unknown[] = [
      selectedRecord.sellerLanguage,
      selectedRecord.seller_language,
      selectedRecord.detectedLanguage,
      selectedRecord.detected_language,
      intelligenceRecord.seller_language,
      intelligenceRecord.detected_language,
      intelligenceRecord.language_code,
      intelligenceRecord.language,
      intelligenceRecord.preferred_language,
      detectedThreadLanguage,
    ]

    for (const candidate of candidates) {
      const normalized = normalizeLanguageCode(candidate)
      if (normalized) return normalized
    }
    return null
  }, [detectedThreadLanguage, selected, threadIntelligence])

  const sellerLanguageLabel = useMemo(
    () => languageLabelFor(sellerLanguageCode),
    [sellerLanguageCode],
  )

  const threadHasInboundMessages = useMemo(
    () => selectedMessages.some((message) => message.direction === 'inbound' && message.body.trim().length > 0),
    [selectedMessages],
  )

  const displayedMessagesWithTranslation = useMemo(() => {
    if (threadViewMode !== 'translated') return displayedMessages
    return displayedMessages.map((message) => {
      if (message.direction !== 'inbound') return message
      const translated = threadTranslations[message.id]
      if (!translated || translated === message.body) return message
      return {
        ...message,
        body: translated,
      }
    })
  }, [displayedMessages, threadTranslations, threadViewMode])

  const applySavedPreset = useCallback((preset: InboxSavedFilterPreset) => {
    if (DEV) {
      console.log(`[NexusInboxActionNoRefresh]`, {
        action: `apply_preset_${preset}`,
        optimistic: true,
        preventedDefault: true,
        stoppedPropagation: true
      })
    }
    setSavedPreset(preset)
    const config = getSavedPresetConfig(preset)
    if (config.stage) setStageFilter(config.stage)
    if (config.view) setViewFilter(config.view)
    if (config.advanced) setAdvancedFilters((current) => ({ ...current, ...config.advanced }))
  }, [DEV])

  const applyRightSavedPreset = useCallback((preset: InboxSavedFilterPreset) => {
    if (DEV) {
      console.log(`[NexusInboxActionNoRefresh]`, {
        action: `apply_right_preset_${preset}`,
        optimistic: true,
        preventedDefault: true,
        stoppedPropagation: true
      })
    }
    setRightSavedPreset(preset)
    const config = getSavedPresetConfig(preset)
    if (config.view) setRightViewFilter(config.view)
  }, [DEV])

  const setActiveOverlay = useCallback((activeOverlay: ActiveOverlay) => {
    setLayoutState((current) => ({ ...current, activeOverlay }))
  }, [])

  const announceLayout = useCallback((message: string) => {
    emitNotification({ title: message, detail: 'NEXUS layout updated', severity: 'success' })
  }, [])

  const handleResetFilters = useCallback(() => {
    setSearchQuery('')
    setStageFilter('all_stages')
    setViewFilter('priority')
    setAdvancedFilters({ outOfStateOwner: 'all' })
    setSavedPreset('my_priority')
  }, [])

  const liveThreadQuery = useMemo(() => ({
    // Keep the live payload broad so the premium left inbox can group every hydrated thread locally.
    view: 'all' as const,
    stage: stageFilter,
    query: searchQuery,
    advanced: advancedFilters,
  }), [stageFilter, searchQuery, advancedFilters])

  useEffect(() => {
    setVisibleThreadCount(200)
    refreshInbox({ filters: liveThreadQuery })
  }, [liveThreadQuery, refreshInbox])



  const prevSelectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selected) {
      setSelectedMessages([])
      setThreadContext(null)
      setThreadIntelligence(null)
      setThreadTranslations({})
      setThreadViewMode('original')
      setTranslatedDraftPreview(null)
      setOriginalDraftBeforeTranslation(null)
      setDetectedThreadLanguage(null)
      setTranslationError(null)
      prevSelectedIdRef.current = null
      return
    }

    const cacheKey = selected.threadKey || selected.id
    const cachedMessages = messageCacheRef.current[cacheKey] ?? []
    const isNewSelection = prevSelectedIdRef.current !== selected.id
    prevSelectedIdRef.current = selected.id

    if (isNewSelection) {
      setThreadTranslations({})
      setThreadViewMode('original')
      setTranslatedDraftPreview(null)
      setOriginalDraftBeforeTranslation(null)
      setDetectedThreadLanguage(null)
      setTranslationError(null)
      setSelectedMessages(cachedMessages)
      setMessagesLoading(cachedMessages.length === 0)
      setContextLoading(true)
    }
    setThreadIntelligence((selected ?? null) as unknown as ThreadIntelligenceRecord | null)

    let active = true

    Promise.all([
      getThreadMessagesForThread(selected),
      getThreadContext(selected),
      getThreadIntelligence(selected),
    ]).then(([messages, context, intelligence]) => {
      if (!active) return
      const resolvedMessages = messages.length > 0 ? messages : cachedMessages
      if (messages.length > 0) {
        messageCacheRef.current[cacheKey] = messages
      } else if (DEV) {
        console.warn('[InboxPage] message hydration returned 0 rows', {
          threadKey: cacheKey,
          ownerId: selected.ownerId,
          propertyId: selected.propertyId,
          phoneNumber: selected.phoneNumber,
          cachedMessages: cachedMessages.length,
        })
      }
      setSelectedMessages(resolvedMessages)
      setThreadContext(context)
      setThreadIntelligence({
        ...((selected ?? {}) as unknown as ThreadIntelligenceRecord),
        ...((intelligence ?? {}) as ThreadIntelligenceRecord),
      })

      const deliveredByBody = new Set(
        messages
          .filter((message) => message.direction === 'outbound' && String(message.deliveryStatus || '').toLowerCase() === 'delivered')
          .map((message) => String(message.body || '').trim().toLowerCase()),
      )

      if (deliveredByBody.size > 0) {
        setPendingMessagesByThread((current) => {
          const currentThreadPending = current[selected.id] ?? []
          const unresolved = currentThreadPending.filter((pending) => !deliveredByBody.has(String(pending.body || '').trim().toLowerCase()))
          if (unresolved.length === currentThreadPending.length) return current
          return {
            ...current,
            [selected.id]: unresolved,
          }
        })
      }
    }).finally(() => {
      if (!active) return
      setMessagesLoading(false)
      setContextLoading(false)
    })

    return () => {
      active = false
    }
  }, [DEV, selected])

  useEffect(() => {
    if (!selected || data.dataMode !== 'live') return

    const selectedKey = selected.threadKey || selected.id
    const selectedPhone = selected.canonicalE164 || selected.phoneNumber || ''
    const selectedOwnerId = selected.ownerId || ''
    const selectedPropertyId = selected.propertyId || ''
    const selectedProspectId = selected.prospectId || ''
    const supabase = getSupabaseClient()

    const mergeRealtimeMessage = (incoming: ThreadMessage) => {
      messageCacheRef.current[selectedKey] = dedupeMessages([
        ...(messageCacheRef.current[selectedKey] ?? []),
        incoming,
      ])

      setSelectedMessages((current) => {
        return dedupeMessages([...current, incoming])
      })
    }

    const belongsToSelection = (row: Record<string, unknown>) => {
      const rowThreadKey = String(row.thread_key ?? row.threadKey ?? '').trim()
      const rowFrom = String(row.from_phone_number ?? '').trim()
      const rowTo = String(row.to_phone_number ?? '').trim()
      const rowOwnerId = String(row.master_owner_id ?? '').trim()
      const rowPropertyId = String(row.property_id ?? '').trim()
      const rowProspectId = String(row.prospect_id ?? '').trim()
      return Boolean(
        (rowThreadKey && rowThreadKey === selectedKey) ||
        (selectedPhone && (rowFrom === selectedPhone || rowTo === selectedPhone)) ||
        (selectedOwnerId && rowOwnerId === selectedOwnerId) ||
        (selectedPropertyId && rowPropertyId === selectedPropertyId) ||
        (selectedProspectId && rowProspectId === selectedProspectId)
      )
    }

    const channel = supabase
      .channel(`nexus-inbox-thread-${selectedKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_events' }, (payload) => {
        const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>
        if (!belongsToSelection(row)) return
        if (DEV) {
          console.log('[InboxPage realtime message append]', {
            threadKey: selectedKey,
            eventType: payload.eventType,
            messageId: row.id ?? null,
          })
        }
        if (payload.eventType === 'DELETE') {
          setSelectedMessages((current) => current.filter((message) => message.id !== String(row.id ?? '')))
          return
        }
        mergeRealtimeMessage(toThreadMessage(row))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'send_queue' }, (payload) => {
        const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>
        if (!belongsToSelection(row)) return

        const queueId = String(row.id ?? row.queue_id ?? '').trim()
        const nextStatus = String(row.queue_status ?? row.status ?? 'pending').trim().toLowerCase()

        setPendingMessagesByThread((current) => {
          const currentThreadPending = current[selected.id] ?? []
          if (currentThreadPending.length === 0) return current
          let changed = false
          const nextPending = currentThreadPending.map((message) => {
            const messageQueueId = String(message.developerMeta?.queue_id ?? '').trim()
            const sameQueue = queueId && messageQueueId && messageQueueId === queueId
            const sameBody = String(row.message_body ?? row.message_text ?? '').trim() && String(row.message_body ?? row.message_text ?? '').trim() === message.body.trim()
            if (!sameQueue && !sameBody) return message
            changed = true
            return {
              ...message,
              deliveryStatus: nextStatus || message.deliveryStatus,
              rawStatus: nextStatus || message.rawStatus,
              error: String(row.failed_reason ?? row.failure_reason ?? '').trim() || message.error,
              developerMeta: {
                ...(message.developerMeta ?? {}),
                queue_id: queueId || String(message.developerMeta?.queue_id ?? ''),
              },
            }
          })
          return changed ? { ...current, [selected.id]: dedupeMessages(nextPending) } : current
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_thread_state' }, (payload) => {
        const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>
        if (!belongsToSelection(row)) return
        if (DEV) console.log('[InboxPage realtime dossier update]', { threadKey: selectedKey, eventType: payload.eventType })
        
        setThreadIntelligence((current) => {
          if (!current) return current
          return {
            ...current,
            ...row,
            // Map common aliases
            inboxCategory: row.inbox_category || current.inboxCategory,
            uiIntent: row.detected_intent || row.ui_intent || current.uiIntent,
            workflowStage: row.thread_stage || current.workflowStage,
          }
        })
      })
      .subscribe()


    return () => {
      void supabase.removeChannel(channel)
    }
  }, [DEV, data.dataMode, selected])

  const handleTranslateThread = useCallback(async () => {
    if (!threadHasInboundMessages || isEnglishLanguage(sellerLanguageCode)) return

    const inboundMessages = selectedMessages
      .filter((message) => message.direction === 'inbound' && message.body.trim().length > 0)

    if (inboundMessages.length === 0) return

    setTranslationError(null)
    setThreadTranslationLoading(true)

    try {
      const uniqueBodies = Array.from(new Set(inboundMessages.map((message) => message.body.trim())))
      const translationByBody = new Map<string, string>()

      await Promise.all(uniqueBodies.map(async (body) => {
        const result = await translateText({
          text: body,
          sourceLanguage: sellerLanguageCode ?? undefined,
          targetLanguage: 'en',
          mode: 'thread',
        })
        translationByBody.set(body, result.translatedText)
        if (result.detectedLanguage) {
          setDetectedThreadLanguage(result.detectedLanguage.toLowerCase())
        }
      }))

      const nextTranslations: Record<string, string> = {}
      inboundMessages.forEach((message) => {
        const translated = translationByBody.get(message.body.trim())
        if (translated) {
          nextTranslations[message.id] = translated
        }
      })

      setThreadTranslations(nextTranslations)
      setThreadViewMode('translated')
      emitNotification({
        title: 'Thread Translated',
        detail: `${Object.keys(nextTranslations).length} inbound messages translated to English`,
        severity: 'success',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to translate thread messages'
      setTranslationError(message)
      emitNotification({
        title: 'Translation Failed',
        detail: message,
        severity: 'warning',
      })
    } finally {
      setThreadTranslationLoading(false)
    }
  }, [selectedMessages, sellerLanguageCode, threadHasInboundMessages])

  const handleTranslateDraft = useCallback(async () => {
    const text = draftText.trim()
    if (!text) return

    setTranslationError(null)
    setDraftTranslationLoading(true)

    try {
      const targetLanguage = sellerLanguageCode && !isEnglishLanguage(sellerLanguageCode)
        ? sellerLanguageCode
        : 'es'

      const result = await translateText({
        text,
        sourceLanguage: 'en',
        targetLanguage,
        mode: 'draft',
      })

      setDetectedThreadLanguage((current) => current ?? result.detectedLanguage)
      setTranslatedDraftPreview(result.translatedText)
      setOriginalDraftBeforeTranslation(text)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to translate draft'
      setTranslationError(message)
      emitNotification({
        title: 'Draft Translation Failed',
        detail: message,
        severity: 'warning',
      })
    } finally {
      setDraftTranslationLoading(false)
    }
  }, [draftText, sellerLanguageCode])

  const handleUseDraftTranslation = useCallback(() => {
    if (!translatedDraftPreview) return
    setDraftText(translatedDraftPreview)
    setTranslationError(null)
  }, [translatedDraftPreview])

  const handleRevertDraftTranslation = useCallback(() => {
    if (!originalDraftBeforeTranslation) return
    setDraftText(originalDraftBeforeTranslation)
    setTranslatedDraftPreview(null)
    setOriginalDraftBeforeTranslation(null)
    setTranslationError(null)
  }, [originalDraftBeforeTranslation])

  useEffect(() => {
    let active = true

    const refreshHealth = async () => {
      setQueueProcessorHealthLoading(true)
      const snapshot = await getQueueProcessorHealth()
      if (!active) return
      setQueueProcessorHealth(snapshot)
      setQueueProcessorHealthLoading(false)
    }

    void refreshHealth()
    const interval = window.setInterval(() => {
      void refreshHealth()
    }, 30000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let active = true

    const refreshAutonomyInputs = async () => {
      try {
        const [nextQueue, nextTemplates, nextActivity] = await Promise.all([
          fetchQueueModel().catch(() => null),
          fetchSmsTemplates({ includeInactive: true, limit: 800 }).catch(() => []),
          fetchInboxActivity().catch(() => []),
        ])

        if (!active) return
        setQueueModel(nextQueue)
        setTemplateInventory(nextTemplates)
        setActivityFeed(nextActivity)
      } catch (error) {
        if (DEV) console.warn('[InboxPage autonomy inputs] refresh failed', error)
      }
    }

    void refreshAutonomyInputs()
    const interval = window.setInterval(() => {
      void refreshAutonomyInputs()
    }, 45000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [DEV])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('nexus:focus-search'))
        return
      }

      if (event.key === 'Escape') {
        setCommandOpen(false)
        setSchedulePanelOpen(false)
        setLayoutState((current) => ({ ...current, activeOverlay: null }))
        return
      }

      if (isTyping) return

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (filtered.length === 0) return
        const currentIndex = selected ? filtered.findIndex((thread) => thread.id === selected.id) : -1
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = currentIndex === -1
          ? 0
          : Math.max(0, Math.min(filtered.length - 1, currentIndex + delta))
        const nextThread = filtered[nextIndex]
        if (nextThread) {
          setSelectedId(nextThread.id)
          setSelectedThreadKey(nextThread.threadKey || nextThread.id)
          setLayoutState((current) => ({ ...current, selectedThreadId: nextThread.id }))
        }
        return
      }

      if (event.altKey && /^[1-7]$/.test(event.key)) {
        event.preventDefault()
        const presetByKey: InboxSavedFilterPreset[] = ['positive_hot', 'manual_review', 'needs_reply', 'auto_replied', 'outbound_only', 'missing_context', 'suppressed']
        const preset = presetByKey[Number(event.key) - 1]
        if (preset) applySavedPreset(preset)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        setLayoutState((current) => {
          const next = current.mapMode === 'off' ? openMapMode(current) : closeMapMode(current)
          announceLayout(next.mapMode === 'off' ? 'Map mode closed' : 'Map mode')
          return next
        })
        return
      }

      if (event.key === '[') {
        setLayoutState((current) => {
          const next = cycleLeftPanelMode(current)
          announceLayout(layoutToastForState(next, '['))
          return next
        })
      }
      if (event.key === ']') {
        setLayoutState((current) => {
          const next = cycleRightPanelMode(current)
          announceLayout(layoutToastForState(next, ']'))
          return next
        })
      }
      if (event.key === '/') {
        event.preventDefault()
        setLayoutState((current) => {
          const next = cycleInboxMode(current)
          announceLayout(layoutToastForState(next, '/'))
          return next
        })
      }
      if (event.key === '\\') {
        if (layoutState.mapMode !== 'off') {
          // In map mode: cycle map panel size (side → half → 75% → full → side)
          setLayoutState(cycleMapMode)
        } else if (layoutState.leftPanelMode === 'full' || layoutState.inboxMode === 'full_double') {
          // In full-screen inbox: toggle double-sided inbox
          setLayoutState((current) => ({
            ...current,
            inboxMode: current.inboxMode === 'full_double' ? 'default' : 'full_double',
            leftPanelMode: current.inboxMode === 'full_double' ? 'full' : 'default',
          }))
        } else {
          // Default: toggle dossier overlay
          setActiveOverlay(layoutState.activeOverlay === 'dossier' ? null : 'dossier')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [announceLayout, applySavedPreset, filtered, layoutState.activeOverlay, layoutState.mapMode, layoutState.leftPanelMode, layoutState.inboxMode, selected, setActiveOverlay])

  const handleWorkflowMutation = useCallback(async (label: string, mutation: () => Promise<any>, options?: { action?: { label: string, onClick: () => void }, skipRefresh?: boolean }) => {
    try {
      if (DEV) console.log(`[NexusInbox] Mutation Triggered: ${label}`, { options })
      const result = await mutation()
      if (DEV) console.log(`[NexusInbox] Mutation Result: ${label}`, result)
      
      if (result && 'ok' in result && !result.ok) {
        emitNotification({ title: 'Error', detail: result.errorMessage || 'Unknown error', severity: 'critical' })
        return
      }
      if (!options?.skipRefresh) {
        if (DEV) console.log(`[NexusInbox] Refreshing data for: ${label}`)
        await refreshInbox({ filters: liveThreadQuery })
      } else {
        if (DEV) console.log(`[NexusInbox] Skipping refresh (optimistic only) for: ${label}`)
      }
      emitNotification({ 
        title: label, 
        detail: 'Action completed successfully', 
        severity: 'success',
        action: options?.action
      })
    } catch (err) {
      emitNotification({ title: 'Error', detail: String(err), severity: 'critical' })
    }
  }, [refreshInbox, liveThreadQuery, DEV])

  const handleThreadAction = useCallback(async (target: string | InboxWorkflowThread, action: string) => {
    const thread = typeof target === 'string' ? threads.find((t) => t.id === target) : target
    if (!thread) return

    let label = ''
    let mutation = async () => ({ ok: true, threadKey: thread.id })
    let optimistic: Partial<InboxWorkflowThread> = {}

    switch (action) {
      case 'archive':
        label = 'Thread Archived'
        mutation = () => archiveThread(thread)
        optimistic = { isArchived: true, inboxStatus: 'closed' }
        break
      case 'unarchive':
        label = 'Thread Restored'
        mutation = () => unarchiveThread(thread)
        optimistic = { isArchived: false, inboxStatus: 'needs_review' }
        break
      case 'star':
        label = 'Thread Starred'
        mutation = () => starThread(thread)
        optimistic = { isStarred: true }
        break
      case 'unstar':
        label = 'Star Removed'
        mutation = () => unstarThread(thread)
        optimistic = { isStarred: false }
        break
      case 'pin':
        label = 'Thread Pinned'
        mutation = () => pinThread(thread)
        optimistic = { isPinned: true }
        break
      case 'unpin':
        label = 'Pin Removed'
        mutation = () => unpinThread(thread)
        optimistic = { isPinned: false }
        break
      case 'read':
        label = 'Marked Read'
        mutation = () => markThreadRead(thread)
        optimistic = { isRead: true, unread: false, inboxStatus: 'closed' }
        break
      case 'unread':
        label = 'Marked Unread'
        mutation = () => markThreadUnread(thread)
        optimistic = { isRead: false, unread: true, inboxStatus: 'new_reply' }
        break
      default:
        return
    }

    setOptimisticPatches(prev => ({ ...prev, [thread.id]: { ...prev[thread.id], ...optimistic } }))
    
    if (DEV) {
      console.log(`[NexusInboxActionNoRefresh]`, {
        action,
        thread_id: thread.id.slice(-8),
        optimistic: true,
        persisted: false,
        stoppedPropagation: true
      })
    }

    await handleWorkflowMutation(label, mutation, {
      skipRefresh: true,
      action: action === 'archive'
        ? {
            label: 'Undo',
            onClick: () => {
              setOptimisticPatches(prev => ({
                ...prev,
                [thread.id]: { ...prev[thread.id], isArchived: false, inboxStatus: 'new_reply' },
              }))
              console.log(`[NexusInboxActionNoRefresh]`, {
                action: 'undo_archive',
                thread_id: thread.id.slice(-8),
                optimistic: true,
                preventedDefault: true,
                stoppedPropagation: true
              })
              void handleWorkflowMutation('Thread Restored', () => unarchiveThread(thread), { skipRefresh: true })
            },
          }
        : undefined,
    })
  }, [threads, handleWorkflowMutation, DEV])

  const handleStatusChange = useCallback(async (status: InboxStatus | 'sent_message') => {
    if (!selected) return
    const actualStatus: InboxStatus = status === 'sent_message' ? 'waiting' : status
    const extraPatch = status === 'sent_message'
      ? { latestDirection: 'outbound' as const, lastDirection: 'outbound' as const, lastOutboundAt: new Date().toISOString() }
      : {}
    setOptimisticPatches(prev => ({ ...prev, [selected.id]: { ...prev[selected.id], inboxStatus: actualStatus, ...extraPatch } }))
    
    if (DEV) {
      console.log(`[NexusWorkflowStatus]`, {
        action: `status_change_${status}`,
        thread_id: selected.id.slice(-8),
        optimistic: true,
        preventedDefault: true,
        stoppedPropagation: true
      })
    }

    await handleWorkflowMutation(`Status: ${actualStatus.replace(/_/g, ' ')}`, () => updateThreadStatus(selected, actualStatus), { skipRefresh: true })
  }, [selected, handleWorkflowMutation, DEV])

  const handleStageChange = useCallback(async (stage: SellerStage) => {
    if (!selected) return
    setOptimisticPatches(prev => ({ ...prev, [selected.id]: { ...prev[selected.id], conversationStage: stage } }))
    
    if (DEV) {
      console.log(`[NexusWorkflowStatus]`, {
        action: `stage_change_${stage}`,
        thread_id: selected.id.slice(-8),
        optimistic: true,
        preventedDefault: true,
        stoppedPropagation: true
      })
    }

    await handleWorkflowMutation(`Stage: ${stage.replace(/_/g, ' ')}`, () => updateThreadStage(selected, stage), { skipRefresh: true })
  }, [selected, handleWorkflowMutation, DEV])

  const handleToggleStar = useCallback(() => {
    if (!selected) return
    handleThreadAction(selected, selected.isStarred ? 'unstar' : 'star')
  }, [handleThreadAction, selected])

  const handleTogglePin = useCallback(() => {
    if (!selected) return
    handleThreadAction(selected, selected.isPinned ? 'unpin' : 'pin')
  }, [handleThreadAction, selected])

  const handleToggleArchive = useCallback(() => {
    if (!selected) return
    handleThreadAction(selected, selected.isArchived ? 'unarchive' : 'archive')
  }, [handleThreadAction, selected])

  const handleSelect = useCallback((id: string) => {
    const thread = threads.find((candidate) => candidate.id === id)
    setSelectedId(id)
    setSelectedThreadKey(thread?.threadKey || thread?.id || null)
    setLayoutState((current) => ({ ...current, selectedThreadId: id }))
  }, [threads])

  const handleOperatorAction = useCallback(async (id: string, action: string) => {
    const thread = threads.find((t) => t.id === id)
    if (!thread) return

    if (DEV) console.log(`[OperatorAction] ${action} on ${id.slice(-8)}`)

    switch (action) {
      case 'mark_hot':
        await handleWorkflowMutation('Lead: HOT', () => markThreadHot(thread), { skipRefresh: true })
        break
      case 'snooze':
        await handleWorkflowMutation('Thread: Snoozed', () => snoozeThread(thread), { skipRefresh: true })
        break
      case 'pause_automation':
        await handleWorkflowMutation('Automation: Paused', () => pauseAutomation(thread), { skipRefresh: true })
        break
      case 'resume_automation':
        await handleWorkflowMutation('Automation: Resumed', () => resumeAutomation(thread), { skipRefresh: true })
        break
      case 'suppress':
        await handleWorkflowMutation('Thread: Suppressed (DNC)', () => suppressThread(thread), { skipRefresh: true })
        break
      case 'retry_send':
        await handleWorkflowMutation('Timeline: Retrying...', () => retryFailedSend(thread), { skipRefresh: true })
        break
      case 'archive':
        await handleThreadAction(thread, 'archive')
        break
      case 'unarchive':
        await handleThreadAction(thread, 'unarchive')
        break
      case 'star':
        await handleThreadAction(thread, 'star')
        break
      case 'unstar':
        await handleThreadAction(thread, 'unstar')
        break
      case 'pin':
        await handleThreadAction(thread, 'pin')
        break
      case 'unpin':
        await handleThreadAction(thread, 'unpin')
        break
      case 'read':
        await handleThreadAction(thread, 'read')
        break
      case 'unread':
        await handleThreadAction(thread, 'unread')
        break
      default:
        console.warn('[OperatorAction] Unknown action', action)
    }
  }, [threads, handleWorkflowMutation, handleThreadAction, DEV])


  const handleSend = useCallback(async (text: string, template?: SmsTemplate | null) => {
    if (!selected || !text.trim() || isSending) return
    if (selectedSuppressed) {
      emitNotification({
        title: 'Suppressed Thread',
        detail: 'No message needed — suppression logged.',
        severity: 'warning',
      })
      return
    }

    const timestamp = new Date().toISOString()
    const optimisticMessage: ThreadMessage = {
      id: `pending-${selected.id}-${Date.now()}`,
      direction: 'outbound',
      body: text.trim(),
      createdAt: timestamp,
       timelineAt: timestamp,
      deliveredAt: null,
      deliveryStatus: 'pending',
      fromNumber: '',
      toNumber: selected.canonicalE164 || selected.phoneNumber || '',
      ownerId: selected.ownerId || '',
      prospectId: selected.prospectId || '',
      propertyId: selected.propertyId || '',
      phoneNumber: selected.phoneNumber || '',
      canonicalE164: selected.canonicalE164 || '',
      templateId: template?.templateId ?? template?.id ?? null,
      templateName: template?.useCase ?? null,
      agentId: null,
      source: 'operator',
      rawStatus: 'pending',
      error: null,
    }

    setPendingMessagesByThread((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), optimisticMessage],
    }))

    setIsSending(true)
    try {
      const result = await sendInboxMessageNow(selected, text, {
        selectedTemplate: template ?? null,
        threadContext,
      })
      emitNotification({
        title: result.ok
          ? (result.queueProcessorEligible ? 'Queued For Immediate Send' : 'Queued (Processor Delayed)')
          : 'Send Failed',
        detail: result.ok
          ? (result.queueProcessorEligible
            ? `Queue row ${result.queueId ?? 'created'} is eligible for immediate send`
            : (result.errorMessage ?? `Queue row ${result.queueId ?? 'created'} created, but processing appears delayed`))
          : (result.errorMessage ?? 'Could not queue message for send'),
        severity: result.ok
          ? (result.queueProcessorEligible ? 'success' : 'warning')
          : 'critical',
      })

      if (!result.ok) {
        setPendingMessagesByThread((current) => ({
          ...current,
          [selected.id]: (current[selected.id] ?? []).filter((pending) => pending.id !== optimisticMessage.id),
        }))
      } else {
        setPendingMessagesByThread((current) => ({
          ...current,
          [selected.id]: dedupeMessages((current[selected.id] ?? []).map((pending) => (
            pending.id !== optimisticMessage.id
              ? pending
              : {
                  ...pending,
                  deliveryStatus: result.deliveryStatus || 'queued',
                  rawStatus: result.deliveryStatus || 'queued',
                  developerMeta: {
                    ...(pending.developerMeta ?? {}),
                    queue_id: result.queueId ?? '',
                    provider_message_sid: result.providerMessageSid ?? '',
                  },
                }
          ))),
        }))
      }

      setDraftText('')
    } finally {
      setIsSending(false)
    }
  }, [isSending, selected, selectedSuppressed, threadContext])

  const handleSendTemplate = useCallback(async (payload: TemplateActionPayload) => {
    await handleSend(payload.text, payload.template)
  }, [handleSend])

  const handleQueueTemplate = useCallback(async (payload: TemplateActionPayload) => {
    if (!selected || !payload.text.trim()) return
    const result = await queueReplyFromInbox(selected, payload.text, {
      selectedTemplate: payload.template,
      threadContext,
    })
    emitNotification({
      title: result.ok ? 'Reply Queued For Approval' : 'Queue Failed',
      detail: result.ok
        ? `Queue row ${result.queueId ?? 'created'} is waiting for approval`
        : (result.errorMessage ?? 'Could not queue reply'),
      severity: result.ok ? 'success' : 'critical',
    })
    if (result.ok) {
      setDraftText('')
    }
  }, [selected, threadContext])

  const handleScheduleTemplate = useCallback((payload: TemplateActionPayload) => {
    setScheduledTemplatePayload(payload)
    setDraftText(payload.text)
    setSchedulePanelOpen(true)
  }, [])

  const insertAiSuggestion = useCallback((suggestionText: string) => {
    setDraftText((prev) => (prev.trim() ? `${prev.trim()}\n\n${suggestionText}` : suggestionText))
  }, [])

  const updateAutonomyControl = useCallback(async (
    patch: Partial<AutonomyControlState>,
    title: string,
    detail: string,
  ) => {
    setAutonomyControls((current) => ({ ...current, ...patch }))
    emitNotification({ title, detail, severity: patch.autonomousMode === 'emergency_stop' ? 'critical' : 'success' })
    await logInboxActivity({
      event_type: 'ai_copilot_interaction',
      thread_key: selected?.threadKey || '__system__',
      actor: 'operator',
      title,
      description: detail,
      metadata: { autonomy_patch: patch },
      undo_payload: null,
    })
  }, [selected?.threadKey])

  const commandPaletteCommands = useMemo<InboxCmd[]>(() => {
    const commands: InboxCmd[] = [
      {
        id: 'focus-search',
        label: 'Focus Search',
        category: 'Navigation',
        shortcut: 'Cmd+Shift+F',
        keywords: ['find', 'search', 'seller', 'address'],
        action: () => window.dispatchEvent(new CustomEvent('nexus:focus-search')),
      },
      {
        id: 'open-ai',
        label: 'Open AI Assist',
        category: 'AI',
        shortcut: 'Cmd+K',
        keywords: ['copilot', 'assistant', 'draft'],
        action: () => setActiveOverlay('ai'),
      },
      {
        id: 'autonomy-emergency-stop',
        label: autonomyControls.autonomousMode === 'emergency_stop' ? 'Resume Autonomous Engine' : 'Emergency Stop Automation',
        category: 'AI',
        keywords: ['pause', 'emergency', 'automation', 'governance'],
        action: () => {
          void updateAutonomyControl(
            { autonomousMode: autonomyControls.autonomousMode === 'emergency_stop' ? 'approval_required' : 'emergency_stop' },
            autonomyControls.autonomousMode === 'emergency_stop' ? 'Autonomous Engine Resumed' : 'Emergency Stop Engaged',
            autonomyControls.autonomousMode === 'emergency_stop'
              ? 'System moved back into approval-required mode.'
              : 'All autonomous execution should be treated as halted until reviewed.',
          )
        },
      },
      {
        id: 'autonomy-approval-mode',
        label: autonomyControls.autonomousMode === 'approval_required' ? 'Enable Full Autonomy Mode' : 'Require Approval For Autonomy',
        category: 'AI',
        keywords: ['approval', 'human review', 'governance'],
        action: () => {
          void updateAutonomyControl(
            { autonomousMode: autonomyControls.autonomousMode === 'approval_required' ? 'active' : 'approval_required' },
            autonomyControls.autonomousMode === 'approval_required' ? 'Full Autonomy Enabled' : 'Approval Mode Enabled',
            autonomyControls.autonomousMode === 'approval_required'
              ? 'Autonomous execution restored for eligible threads.'
              : 'Negotiation and sensitive automations now require operator approval.',
          )
        },
      },
      {
        id: 'open-map',
        label: 'Open Map',
        category: 'Map',
        shortcut: 'Cmd+M',
        keywords: ['map', 'pin', 'property'],
        action: () => setLayoutState(openMapMode),
      },
      {
        id: 'open-dossier',
        label: 'Open Dossier Overlay',
        category: 'Layout',
        keywords: ['briefing', 'dossier', 'intel'],
        requiresThread: true,
        action: () => setActiveOverlay('dossier'),
      },
      {
        id: 'activity-feed',
        label: 'Open Activity Feed',
        category: 'Navigation',
        keywords: ['activity', 'timeline', 'audit'],
        action: () => setActiveOverlay('activity'),
      },
      {
        id: 'queue-hot-leads',
        label: 'Jump To Hot Leads',
        category: 'Filters',
        shortcut: 'Alt+1',
        keywords: ['hot', 'priority', 'leads'],
        action: () => applySavedPreset('positive_hot'),
      },
      {
        id: 'queue-needs-review',
        label: 'Jump To Needs Review',
        category: 'Filters',
        shortcut: 'Alt+2',
        keywords: ['review', 'manual', 'operator'],
        action: () => applySavedPreset('manual_review'),
      },
      {
        id: 'queue-new-inbound',
        label: 'Jump To New Inbound',
        category: 'Filters',
        shortcut: 'Alt+3',
        keywords: ['inbound', 'reply', 'new'],
        action: () => applySavedPreset('needs_reply'),
      },
    ]

    if (selected && commandIntel) {
      const firstSuggestion = commandIntel.suggestions[0]
      if (firstSuggestion) {
        commands.push({
          id: 'insert-ai-reply',
          label: `Insert ${firstSuggestion.label}`,
          category: 'Reply',
          requiresThread: true,
          keywords: ['reply', 'draft', 'suggested'],
          action: () => insertAiSuggestion(firstSuggestion.text),
        })
      }

      commands.push(
        {
          id: 'set-needs-review',
          label: 'Route Thread To Needs Review',
          category: 'Status',
          requiresThread: true,
          keywords: ['review', 'manual', 'escalate'],
          action: () => void handleStatusChange('needs_review'),
        },
        {
          id: 'set-queued',
          label: 'Mark Thread Queued',
          category: 'Status',
          requiresThread: true,
          keywords: ['queue', 'automation', 'follow-up'],
          action: () => void handleStatusChange('queued'),
        },
        {
          id: 'advance-stage',
          label: 'Advance Seller Stage',
          category: 'Seller',
          requiresThread: true,
          keywords: ['advance', 'stage', 'workflow'],
          action: () => {
            const stageOrder: SellerStage[] = [
              'ownership_check',
              'interest_probe',
              'seller_response',
              'price_discovery',
              'condition_details',
              'offer_reveal',
              'negotiation',
              'contract_path',
              'dead_suppressed',
            ]
            const currentIndex = stageOrder.indexOf(selected.conversationStage)
            const nextStage = stageOrder[Math.min(stageOrder.length - 1, Math.max(0, currentIndex + 1))]
            void handleStageChange(nextStage)
          },
        },
        {
          id: 'schedule-followup',
          label: 'Schedule Follow-Up',
          category: 'Schedule',
          requiresThread: true,
          keywords: ['schedule', 'follow up', 'later'],
          action: () => setSchedulePanelOpen(true),
        },
        {
          id: 'route-to-automation',
          label: 'Route Thread To Automation',
          category: 'AI',
          requiresThread: true,
          keywords: ['automation', 'route', 'eligible'],
          action: () => void handleStatusChange('queued'),
        },
        {
          id: 'route-to-manual-review',
          label: 'Escalate Thread To Manual Review',
          category: 'AI',
          requiresThread: true,
          keywords: ['manual', 'review', 'escalate'],
          action: () => void handleStatusChange('needs_review'),
        },
        {
          id: 'star-thread',
          label: selected.isStarred ? 'Remove Star' : 'Star Thread',
          category: 'Seller',
          requiresThread: true,
          keywords: ['star', 'priority', 'bookmark'],
          action: () => handleToggleStar(),
        },
      )
    }

    return commands
  }, [
    applySavedPreset,
    autonomyControls.autonomousMode,
    commandIntel,
    handleStageChange,
    handleStatusChange,
    handleToggleStar,
    insertAiSuggestion,
    selected,
    setActiveOverlay,
    updateAutonomyControl,
  ])

  if (dataLoading) return (
    <div className="nx-premium-inbox">
      <div className="nx-inbox-loading-state">
        <div className="nx-loading-spinner" />
        <span>Loading NEXUS Inbox...</span>
      </div>
    </div>
  )

  const { theme, leftPanelMode, rightPanelMode, inboxMode, mapMode, activeOverlay } = layoutState
  const layoutClasses = getLayoutClassNames(layoutState)
  const mapOpen = mapMode !== 'off'
  const dossierOpen = activeOverlay === 'dossier'
  const aiOpen = activeOverlay === 'ai'
  const keysOpen = activeOverlay === 'keys'
  const showLeftPanel = leftPanelMode !== 'hidden'
  const showRightPanel = rightPanelMode !== 'hidden'
  const isDoubleSided = inboxMode === 'full_double'

  return (
    <div id="nx-inbox-root" className={cls('nx-premium-inbox nx-inbox', ...layoutClasses)}>
      <NexusTopBar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={handleSelect}
        selectedThread={selected}
        isSuppressed={selectedSuppressed}
        notificationCount={data.unreadCount}
        queueProcessorHealth={queueProcessorHealth}
        queueProcessorHealthLoading={queueProcessorHealthLoading}
        autonomyModel={autonomyModel}
        theme={theme}
        onToggleTheme={() => setLayoutState((current) => ({
          ...current,
          theme: current.theme === 'dark' ? 'light' : 'dark',
        }))}
        activeOverlay={activeOverlay}
        onOpenOverlay={setActiveOverlay}
        onCloseOverlay={() => setActiveOverlay(null)}
        onOpenMap={() => setLayoutState(openMapMode)}
        onOpenDossier={() => setActiveOverlay('dossier')}
        onOpenAi={() => setActiveOverlay('ai')}
        onOpenKeys={() => setActiveOverlay('keys')}
        onOpenKpis={() => pushRoutePath('/dashboard/kpis')}
        onOpenActivity={() => setActiveOverlay('activity')}
        onResetLayout={() => setLayoutState(resetLayoutMode)}
      />

      <div className="nx-inbox-shell">
        {showLeftPanel && (
          <InboxSidebar
            threads={threads}
            selectedId={selected?.id ?? null}
            activeViewFilter={viewFilter}
            onSelect={handleSelect}
            onThreadAction={handleThreadAction}
            savedPreset={savedPreset}
            onApplySavedPreset={applySavedPreset}
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            onClearFilters={handleResetFilters}
            onLoadMore={handleLoadMore}
            canLoadMore={Boolean(data.pagination?.hasMore)}
            recentlyUpdatedThreadIds={recentlyUpdatedThreadIds}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            visibleThreadCount={visibleThreadCount}
            loadingError={data.liveFetchError}
          />
        )}

        {isDoubleSided && (
          <InboxSidebar
            threads={threads}
            selectedId={selected?.id ?? null}
            activeViewFilter={rightViewFilter}
            onSelect={handleSelect}
            onThreadAction={handleThreadAction}
            savedPreset={rightSavedPreset}
            onApplySavedPreset={applyRightSavedPreset}
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            onClearFilters={handleResetFilters}
            onLoadMore={handleLoadMore}
            canLoadMore={Boolean(data.pagination?.hasMore)}
            recentlyUpdatedThreadIds={recentlyUpdatedThreadIds}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            visibleThreadCount={visibleThreadCount}
            loadingError={data.liveFetchError}
          />
        )}

        <main className="nx-inbox-center">
          {dossierOpen && (
            <MapDossierDrawer
              mode="dossier"
              thread={selected}
              context={threadContext}
              full={dossierFull}
              onToggleFull={() => setDossierFull((full) => !full)}
              onClose={() => setActiveOverlay(null)}
            />
          )}

          {selectedFilteredOut && selected && (
            <div className="nx-filtered-out-notice">Selected thread is not in the current filter; detail remains open.</div>
          )}

          <ChatThread
            thread={selected}
            messages={displayedMessagesWithTranslation}
            loading={messagesLoading}
            isSuppressed={selectedSuppressed}
            isStarred={selected?.isStarred ?? false}
            onTogglePin={handleTogglePin}
            onToggleStar={handleToggleStar}
            onToggleArchive={handleToggleArchive}
            onThreadAction={handleOperatorAction}
            onOpenDebug={() => setDebugModalOpen(true)}
            searchQuery={searchQuery}
          />


          {showTranslation && (
            <ComposerTranslationBar
            sellerLanguageLabel={sellerLanguageLabel}
            sellerLanguageCode={sellerLanguageCode}
            isSellerLanguageEnglish={isEnglishLanguage(sellerLanguageCode)}
            hasInboundMessages={threadHasInboundMessages}
            hasThreadTranslations={Object.keys(threadTranslations).length > 0}
            threadViewMode={threadViewMode}
            isThreadTranslating={threadTranslationLoading}
            isDraftTranslating={draftTranslationLoading}
            hasDraftText={Boolean(draftText.trim())}
            translatedDraftPreview={translatedDraftPreview}
            translationError={translationError}
            canRevertDraft={Boolean(originalDraftBeforeTranslation)}
            onTranslateThread={handleTranslateThread}
            onTranslateDraft={handleTranslateDraft}
            onSetThreadViewMode={setThreadViewMode}
            onUseDraftTranslation={handleUseDraftTranslation}
            onRevertDraft={handleRevertDraftTranslation}
          />
          )}

          <Composer
            draftText={draftText}
            setDraftText={setDraftText}
            onSend={handleSend}
            isSending={isSending}
            onOpenSchedule={() => {
              setScheduledTemplatePayload({ text: draftText, template: null })
              setSchedulePanelOpen(true)
            }}
            onAI={() => setActiveOverlay('ai')}
            thread={selected}
            threadContext={threadContext}
            onInsertTemplate={(text) => setDraftText(prev => prev ? `${prev}\n\n${text}` : text)}
            onReplaceTemplate={(text) => setDraftText(text)}
            onSendTemplate={handleSendTemplate}
            onQueueTemplate={handleQueueTemplate}
            onScheduleTemplate={handleScheduleTemplate}
            onTranslate={() => setShowTranslation(!showTranslation)}
            isTranslating={showTranslation}
            disabled={!selected || selectedSuppressed}
            disabledReason={!selected ? 'Select a thread to compose' : 'Messaging disabled for suppressed thread'}
            aiHint={null}
            aiSuggestions={commandIntel?.suggestions ?? []}
          />
        </main>

        {mapOpen ? (
          <aside className="nx-map-right-panel">
            <div className="nx-map-right-header">
              <span className="nx-map-right-header__title">
                <Icon name="map" />
                Map View
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  · {mapMode === 'side' ? '25%' : mapMode === 'half' ? '50%' : mapMode === 'seventy_five' ? '75%' : 'Full'}
                </span>
              </span>
              <div className="nx-map-right-header__actions">
                <button
                  type="button"
                  title={mapSourceMode === 'visible_threads' ? 'Show all pins' : 'Show filtered pins only'}
                  onClick={() => setMapSourceMode((mode) => mode === 'visible_threads' ? 'all_active_coordinate_threads' : 'visible_threads')}
                >
                  {mapSourceMode === 'visible_threads' ? 'Show All Pins' : 'Filtered Pins'}
                </button>
                <button
                  type="button"
                  title="Expand map (\\)"
                  onClick={() => setLayoutState(cycleMapMode)}
                >
                  <Icon name="maximize" />
                </button>
                <button
                  type="button"
                  title="Close map (⌘M)"
                  onClick={() => setLayoutState(closeMapMode)}
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>
            <div className="nx-map-right-body">
              <InboxCommandMap
                threads={mapThreads}
                visibleThreads={filtered}
                selectedThread={selected}
                zoomedIn={mapMode !== 'side'}
                sourceMode={mapSourceMode}
                onSelectThreadId={handleSelect}
              />
            </div>
            {selected && (
              <div className="nx-map-right-footer">
                <strong>{selected.propertyAddress || selected.subject || 'Property Unknown'}</strong>
                <span>{selected.market || selected.marketId || 'Market Unknown'}</span>
              </div>
            )}
          </aside>
        ) : showRightPanel && !isDoubleSided ? (
          <IntelligencePanel
            thread={selected}
            threadContext={threadContext}
            intelligence={threadIntelligence}
            onStatusChange={handleStatusChange}
            onStageChange={handleStageChange}
          />

        ) : null}
      </div>

      <AdvancedFiltersPopover
        open={activeOverlay === 'filters'}
        stageFilter={stageFilter}
        setStageFilter={setStageFilter}
        viewFilter={viewFilter}
        setViewFilter={setViewFilter}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={(patch) => setAdvancedFilters((current) => ({ ...current, ...patch }))}
        advancedFilterOptions={advancedFilterOptions}
        viewCounts={viewCounts}
        onReset={handleResetFilters}
        onClose={() => setActiveOverlay(null)}
        onApply={() => { /* Handled by useEffect */ }}
      />

      {activeOverlay === 'activity' && typeof document !== 'undefined'
        ? createPortal(
            <InboxActivityPanel
              threadKey={selected?.threadKey}
              onClose={() => setActiveOverlay(null)}
              onViewThread={(key) => {
                const t = threads.find((thread) => thread.threadKey === key)
                if (t) handleSelect(t.id)
                setActiveOverlay(null)
              }}
            />,
            document.body,
          )
        : null}

      {aiOpen
        ? createPortal(
            <AICopilotPanel
              thread={selected}
              context={threadContext}
              intelligence={threadIntelligence}
              onClose={() => setActiveOverlay(null)}
              onInsertDraft={(text) => setDraftText((prev) => (prev ? `${prev}\n\n${text}` : text))}
            />,
            document.body,
          )
        : (
          /* Global Floating AI Anchor — visible when side panel is NOT open */
          <div 
            className={cls("nx-global-ai-anchor", isAiListening && 'is-listening')} 
            onClick={() => setActiveOverlay('ai')}
          >
            <CopilotOrb 
              state={isAiListening ? 'listening' : 'idle'} 
              amplitude={isAiListening ? 0.5 : 0} 
              onClick={() => setActiveOverlay('ai')} 
              onPushToTalk={() => setIsAiListening(true)} 
              onPushToTalkRelease={() => {
                setIsAiListening(false)
                setActiveOverlay('ai')
                // We'll pass an 'auto-voice' intent if we were holding
              }} 
            />
            <span className="nx-global-ai-anchor__label">{isAiListening ? 'LISTENING...' : 'NEXUS AI'}</span>
          </div>
        )}

      {keysOpen && <InboxUtilityDrawer type="keys" thread={selected} onClose={() => setActiveOverlay(null)} />}


      <InboxCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        hasThread={!!selected}
        commands={commandPaletteCommands}
      />

      <InboxSchedulePanel
        open={schedulePanelOpen}
        onClose={() => {
          setSchedulePanelOpen(false)
          setScheduledTemplatePayload(null)
        }}
        thread={selected}
        onSchedule={(time) => {
          setScheduledTime(time)
          setSchedulePanelOpen(false)
          const payload = scheduledTemplatePayload ?? { text: draftText, template: null }
          if (!selected || !payload.text.trim()) {
            emitNotification({ title: 'Schedule Failed', detail: 'No message available to schedule.', severity: 'warning' })
            return
          }
          void (async () => {
            const result = await scheduleReplyFromInbox(selected, payload.text, time.iso, {
              selectedTemplate: payload.template,
              threadContext,
            })
            emitNotification({
              title: result.ok ? 'Scheduled' : 'Schedule Failed',
              detail: result.ok ? `Sent set for ${time.label}` : (result.errorMessage ?? 'Could not schedule message'),
              severity: result.ok ? 'success' : 'critical',
            })
            if (result.ok) {
              setDraftText('')
              setScheduledTemplatePayload(null)
            }
          })()
        }}
      />
      {contextLoading && <div hidden>Loading context</div>}
      {scheduledTime && <div hidden>{scheduledTime.label}</div>}
      {debugModalOpen && (
        <ThreadDebugModal
          isOpen={debugModalOpen}
          onClose={() => setDebugModalOpen(false)}
          thread={selected}
          messages={selectedMessages}
          intelligence={threadIntelligence}
        />
      )}
    </div>

  )
}
