import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
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
  type InboxStatus,
  type SellerStage,
  type InboxWorkflowThread,
} from '../../lib/data/inboxWorkflowData'
import {
  getQueueProcessorHealth,
  getThreadIntelligence,
  getThreadMessagesForThread,
  getThreadContext,
  sendInboxMessageNow,
  SERVER_INBOX_THREAD_STAGE_VALUES,
  type QueueProcessorHealth,
  type ThreadIntelligenceRecord,
  type ThreadMessage,
  type ThreadContext,
} from '../../lib/data/inboxData'
import { emitNotification } from '../../shared/NotificationToast'
import { Icon } from '../../shared/icons'
import { NexusTopBar } from './components/NexusTopBar'
import { InboxSidebar } from './components/InboxSidebar'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { ComposerTranslationBar } from './components/ComposerTranslationBar'
import { IntelligencePanel } from './components/IntelligencePanel'
import { InboxActivityPanel } from './components/InboxActivityPanel'
import { InboxCommandMap } from './InboxCommandMap'
import { InboxUtilityDrawer, MapDossierDrawer } from './components/InboxUtilityDrawer'
import { AdvancedFiltersPopover } from './components/AdvancedFiltersPopover'
import { InboxCommandPalette } from './InboxCommandPalette'
import { InboxSchedulePanel, type ScheduledTime } from './InboxSchedulePanel'
import { translateText } from './translate.api'
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
  const [stageFilter, setStageFilter] = useState<InboxStageSelectValue>('all_stages')
  const [viewFilter, setViewFilter] = useState<InboxViewSelectValue>('priority')
  const [savedPreset, setSavedPreset] = useState<InboxSavedFilterPreset>('my_priority')
  const [advancedFilters, setAdvancedFilters] = useState<InboxAdvancedFilters>({ outOfStateOwner: 'all' })
  const [rightStageFilter, setRightStageFilter] = useState<InboxStageSelectValue>('all_stages')
  const [rightViewFilter, setRightViewFilter] = useState<InboxViewSelectValue>('active')
  const [rightSavedPreset, setRightSavedPreset] = useState<InboxSavedFilterPreset>('new_inbounds')
  const [rightAdvancedFilters, setRightAdvancedFilters] = useState<InboxAdvancedFilters>({ outOfStateOwner: 'all' })
  const [searchQuery, setSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([])
  const [pendingMessagesByThread, setPendingMessagesByThread] = useState<Record<string, ThreadMessage[]>>({})
  const [visibleThreadCount, setVisibleThreadCount] = useState(1000)
  const [mapSourceMode, _setMapSourceMode] = useState<MapSourceMode>(defaultMapSourceMode)

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
  const [showTranslation, setShowTranslation] = useState(false)
  const [layoutState, setLayoutState] = useState(defaultInboxLayoutState)
  const [dossierFull, setDossierFull] = useState(false)
  const [optimisticPatches, setOptimisticPatches] = useState<Record<string, Partial<InboxWorkflowThread>>>({})

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

  const advancedFilterOptions = useMemo(() => getAdvancedFilterOptions(threads), [threads])
  
  const viewCounts = useMemo(() => {
    const local = getInboxViewCounts(threads)
    const pick = (backend: number | null | undefined, localVal: number) => {
      if (data.dataMode !== 'live') return localVal
      if (backend !== null && backend !== undefined) return backend
      return null
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
  }, [threads, data, data.dataMode])

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

  const rightServerFilterOptions: ApplyInboxFiltersOptions = useMemo(() => {
    const live = data.dataMode === 'live'
    const double = layoutState.inboxMode === 'full_double'
    return {
      skipViewFilter: live && !double,
      skipStageFilter: live && !double && rightStageFilter !== 'all_stages' && SERVER_INBOX_THREAD_STAGE_VALUES.has(rightStageFilter),
    }
  }, [data.dataMode, layoutState.inboxMode, rightStageFilter])

  const rightFiltered = useMemo(() => (
    applyInboxFilters(threads, {
      search: '',
      stage: rightStageFilter,
      view: rightViewFilter,
      advanced: rightAdvancedFilters,
    }, rightServerFilterOptions)
  ), [threads, rightStageFilter, rightViewFilter, rightAdvancedFilters, rightServerFilterOptions])

  const searchResults = useMemo(() => (
    searchQuery.trim()
      ? applyInboxFilters(threads, {
          search: searchQuery,
          stage: 'all_stages',
          view: 'all',
          advanced: {},
        })
      : []
  ), [threads, searchQuery])

  const selected = useMemo(() => (
    threads.find((thread) => thread.id === selectedId) ?? filtered[0] ?? null
  ), [filtered, threads, selectedId])

  useEffect(() => {
    if (!DEV) return
    const first = filtered[0] as unknown as { uiIntent?: string; ui_intent?: string; priorityBucket?: string; priority_bucket?: string } | undefined
    console.log('[NEXUS Inbox Diagnostics]', {
      totalReturnedThreads: threads.length,
      activeFilterKey: viewFilter,
      firstThreadUiIntent: first?.uiIntent ?? first?.ui_intent ?? null,
      firstThreadPriorityBucket: first?.priorityBucket ?? first?.priority_bucket ?? null,
    })
  }, [DEV, filtered, threads.length, viewFilter])

  const selectedSuppressed = useMemo(() => (selected ? isSuppressedThread(selected) : false), [selected])

  const selectedPendingMessages = useMemo(() => {
    if (!selected) return []
    return pendingMessagesByThread[selected.id] ?? []
  }, [pendingMessagesByThread, selected])

  const displayedMessages = useMemo(() => (
    [...selectedMessages, ...selectedPendingMessages].sort((a, b) => (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ))
  ), [selectedMessages, selectedPendingMessages])

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
    if (config.stage) setRightStageFilter(config.stage)
    if (config.view) setRightViewFilter(config.view)
    if (config.advanced) setRightAdvancedFilters((current) => ({ ...current, ...config.advanced }))
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
    view: layoutState.inboxMode === 'full_double' ? 'all' : viewFilter,
    stage: stageFilter,
    query: searchQuery,
    advanced: advancedFilters,
  }), [layoutState.inboxMode, viewFilter, stageFilter, searchQuery, advancedFilters])

  useEffect(() => {
    setVisibleThreadCount(1000)
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

    const isNewSelection = prevSelectedIdRef.current !== selected.id
    prevSelectedIdRef.current = selected.id

    if (isNewSelection) {
      setThreadTranslations({})
      setThreadViewMode('original')
      setTranslatedDraftPreview(null)
      setOriginalDraftBeforeTranslation(null)
      setDetectedThreadLanguage(null)
      setTranslationError(null)
      setMessagesLoading(true)
      setContextLoading(true)
    }

    let active = true

    Promise.all([
      getThreadMessagesForThread(selected),
      getThreadContext(selected),
      getThreadIntelligence(selected),
    ]).then(([messages, context, intelligence]) => {
      if (!active) return
      setSelectedMessages(messages)
      setThreadContext(context)
      setThreadIntelligence(intelligence)

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
  }, [selected])

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
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }

      if (event.key === 'Escape') {
        setCommandOpen(false)
        setSchedulePanelOpen(false)
        setLayoutState((current) => ({ ...current, activeOverlay: null }))
        return
      }

      if (isTyping) return

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
  }, [announceLayout, layoutState.activeOverlay, layoutState.mapMode, layoutState.leftPanelMode, layoutState.inboxMode, setActiveOverlay])

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

  const handleStatusChange = useCallback(async (status: InboxStatus) => {
    if (!selected) return
    setOptimisticPatches(prev => ({ ...prev, [selected.id]: { ...prev[selected.id], inboxStatus: status } }))
    
    if (DEV) {
      console.log(`[NexusWorkflowStatus]`, {
        action: `status_change_${status}`,
        thread_id: selected.id.slice(-8),
        optimistic: true,
        preventedDefault: true,
        stoppedPropagation: true
      })
    }

    await handleWorkflowMutation(`Status: ${status.replace(/_/g, ' ')}`, () => updateThreadStatus(selected, status), { skipRefresh: true })
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
    setSelectedId(id)
    setSearchQuery('')
    setLayoutState((current) => ({ ...current, selectedThreadId: id }))
  }, [])

  const handleSend = useCallback(async (text: string) => {
    if (!selected || !text.trim()) return
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
      templateId: null,
      templateName: null,
      agentId: null,
      source: 'operator',
      rawStatus: 'pending',
      error: null,
    }

    setPendingMessagesByThread((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), optimisticMessage],
    }))

    const result = await sendInboxMessageNow(selected, text)
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
    }

    setDraftText('')
  }, [selected, selectedSuppressed])

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
            threads={filtered}
            activeViewFilter={viewFilter}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            savedPreset={savedPreset}
            onApplySavedPreset={applySavedPreset}
            onThreadAction={handleThreadAction}
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            onClearFilters={handleResetFilters}
            loadingError={DEV && data.liveFetchStatus === 'error' ? data.liveFetchError : null}
            visibleThreadCount={visibleThreadCount}
            canLoadMore={true}
            onLoadMore={handleLoadMore}
            recentlyUpdatedThreadIds={recentlyUpdatedThreadIds}
          />
        )}

        {isDoubleSided && (
          <InboxSidebar
            threads={rightFiltered}
            activeViewFilter={rightViewFilter}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            savedPreset={rightSavedPreset}
            onApplySavedPreset={applyRightSavedPreset}
            onThreadAction={handleThreadAction}
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            onClearFilters={handleResetFilters}
            loadingError={null}
            visibleThreadCount={visibleThreadCount}
            canLoadMore={true}
            onLoadMore={handleLoadMore}
            recentlyUpdatedThreadIds={recentlyUpdatedThreadIds}
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

          <ChatThread
            thread={selected}
            messages={displayedMessagesWithTranslation}
            loading={messagesLoading}
            isSuppressed={selectedSuppressed}
            isStarred={selected?.isStarred ?? false}
            onTogglePin={handleTogglePin}
            onToggleStar={handleToggleStar}
            onToggleArchive={handleToggleArchive}
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
            onOpenSchedule={() => setSchedulePanelOpen(true)}
            onAI={() => setActiveOverlay('ai')}
            thread={selected}
            threadContext={threadContext}
            onInsertTemplate={(text) => setDraftText(prev => prev ? `${prev}\n\n${text}` : text)}
            onReplaceTemplate={(text) => setDraftText(text)}
            onSendTemplate={handleSend}
            onScheduleTemplate={() => setSchedulePanelOpen(true)}
            onTranslate={() => setShowTranslation(!showTranslation)}
            isTranslating={showTranslation}
            disabled={selectedSuppressed}
            disabledReason="Messaging disabled for suppressed thread"
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
                threads={threads}
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
            context={threadContext}
            intelligence={threadIntelligence}
            messages={displayedMessages}
            isSuppressed={selectedSuppressed}
            panelMode={rightPanelMode}
            onCollapse={() => setLayoutState((current) => ({ ...current, rightPanelMode: 'hidden' }))}
            onOpenMap={() => setLayoutState(openMapMode)}
            onOpenDossier={() => setActiveOverlay('dossier')}
            onOpenAi={() => setActiveOverlay('ai')}
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

      {aiOpen && <InboxUtilityDrawer type="ai" thread={selected} onClose={() => setActiveOverlay(null)} />}
      {keysOpen && <InboxUtilityDrawer type="keys" thread={selected} onClose={() => setActiveOverlay(null)} />}

      <InboxCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        hasThread={!!selected}
        commands={[]}
      />

      <InboxSchedulePanel
        open={schedulePanelOpen}
        onClose={() => setSchedulePanelOpen(false)}
        thread={selected}
        onSchedule={(time) => {
          setScheduledTime(time)
          setSchedulePanelOpen(false)
          emitNotification({ title: 'Scheduled', detail: `Sent set for ${time.label}`, severity: 'success' })
        }}
      />
      {contextLoading && <div hidden>Loading context</div>}
      {scheduledTime && <div hidden>{scheduledTime.label}</div>}
    </div>
  )
}
