import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { pushRoutePath } from '../../app/router'
import { useInboxData, toWorkflowThread } from './inbox.adapter'
import {
  archiveThread,
  pinThread,
  unpinThread,
  updateThreadStage,
  updateThreadStatus,
  type InboxStage,
} from '../../lib/data/inboxWorkflowData'
import {
  getQueueProcessorHealth,
  getThreadIntelligence,
  getThreadMessagesForThread,
  getThreadContext,
  sendInboxMessageNow,
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
  getLayoutClassNames,
  layoutToastForState,
  openMapMode,
  resetLayoutMode,
  type ActiveOverlay,
} from './inbox-layout-state'
import {
  applyInboxFilters,
  getAdvancedFilterOptions,
  getInboxViewCounts,
  getSavedPresetConfig,
  isSuppressedThread,
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

const STARRED_THREADS_STORAGE_KEY = 'nexus.inbox.starredThreadIds'
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
  const { data, loading: dataLoading, refresh: refreshInbox } = useInboxData()
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

  const [starredThreadIds, setStarredThreadIds] = useState<string[]>([])
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
  const [layoutState, setLayoutState] = useState(defaultInboxLayoutState)
  const [dossierFull, setDossierFull] = useState(false)

  const threads = useMemo(() => (data.threads ?? []).map(toWorkflowThread), [data.threads])
  const advancedFilterOptions = useMemo(() => getAdvancedFilterOptions(threads), [threads])
  const viewCounts = useMemo(() => getInboxViewCounts(threads), [threads])
  const filtered = useMemo(() => (
    applyInboxFilters(threads, {
      search: searchQuery,
      stage: stageFilter,
      view: viewFilter,
      advanced: advancedFilters,
    })
  ), [threads, searchQuery, stageFilter, viewFilter, advancedFilters])

  const rightFiltered = useMemo(() => (
    applyInboxFilters(threads, {
      search: '',
      stage: rightStageFilter,
      view: rightViewFilter,
      advanced: rightAdvancedFilters,
    })
  ), [threads, rightStageFilter, rightViewFilter, rightAdvancedFilters])

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

  const statusCounts = useMemo(() => (
    threads.reduce<Partial<Record<InboxStage, number>>>((counts, thread) => {
      counts[thread.inboxStage] = (counts[thread.inboxStage] ?? 0) + 1
      return counts
    }, {})
  ), [threads])
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
    setSavedPreset(preset)
    const config = getSavedPresetConfig(preset)
    if (config.stage) setStageFilter(config.stage)
    if (config.view) setViewFilter(config.view)
    if (config.advanced) setAdvancedFilters((current) => ({ ...current, ...config.advanced }))
  }, [])

  const applyRightSavedPreset = useCallback((preset: InboxSavedFilterPreset) => {
    setRightSavedPreset(preset)
    const config = getSavedPresetConfig(preset)
    if (config.stage) setRightStageFilter(config.stage)
    if (config.view) setRightViewFilter(config.view)
    if (config.advanced) setRightAdvancedFilters((current) => ({ ...current, ...config.advanced }))
  }, [])

  const setActiveOverlay = useCallback((activeOverlay: ActiveOverlay) => {
    setLayoutState((current) => ({ ...current, activeOverlay }))
  }, [])

  const announceLayout = useCallback((message: string) => {
    emitNotification({ title: message, detail: 'NEXUS layout updated', severity: 'success' })
  }, [])

  useEffect(() => {
    setVisibleThreadCount(1000)
  }, [searchQuery, stageFilter, viewFilter, advancedFilters])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STARRED_THREADS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setStarredThreadIds(parsed.filter((value): value is string => typeof value === 'string'))
      }
    } catch {
      // Ignore malformed local storage payloads.
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STARRED_THREADS_STORAGE_KEY, JSON.stringify(starredThreadIds))
  }, [starredThreadIds])



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

  const handleWorkflowMutation = useCallback(async (label: string, mutation: () => Promise<any>) => {
    try {
      const result = await mutation()
      if (result && 'ok' in result && !result.ok) {
        emitNotification({ title: 'Error', detail: result.errorMessage || 'Unknown error', severity: 'critical' })
        return
      }
      await refreshInbox()
      emitNotification({ title: label, detail: 'Action completed successfully', severity: 'success' })
    } catch (err) {
      emitNotification({ title: 'Error', detail: String(err), severity: 'critical' })
    }
  }, [refreshInbox])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    setSearchQuery('')
    setLayoutState((current) => ({ ...current, selectedThreadId: id }))
  }, [])

  const handleStageChange = useCallback((stage: InboxStage) => {
    if (!selected) return
    void handleWorkflowMutation('Stage Updated', () => updateThreadStage(selected, stage))
  }, [handleWorkflowMutation, selected])

  const handleTogglePin = useCallback(() => {
    if (!selected) return
    void handleWorkflowMutation(selected.isPinned ? 'Thread Unpinned' : 'Thread Pinned', () => (
      selected.isPinned ? unpinThread(selected) : pinThread(selected)
    ))
  }, [handleWorkflowMutation, selected])

  const handleToggleArchive = useCallback(() => {
    if (!selected) return
    void handleWorkflowMutation(selected.isArchived ? 'Thread Unarchived' : 'Thread Archived', () => (
      selected.isArchived ? updateThreadStatus(selected, 'open') : archiveThread(selected)
    ))
  }, [handleWorkflowMutation, selected])

  const handleToggleStar = useCallback((threadId: string) => {
    setStarredThreadIds((current) => (
      current.includes(threadId)
        ? current.filter((id) => id !== threadId)
        : [...current, threadId]
    ))
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
    <div className={cls('nx-premium-inbox nx-inbox', ...layoutClasses)}>
      <NexusTopBar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={handleSelect}
        selectedThread={selected}
        isSuppressed={selectedSuppressed}
        onStageChange={handleStageChange}
        statusCounts={statusCounts}
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
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            loadingError={DEV && data.liveFetchStatus === 'error' ? data.liveFetchError : null}
            visibleThreadCount={visibleThreadCount}
            canLoadMore={visibleThreadCount < filtered.length}
            onLoadMore={() => setVisibleThreadCount((current) => Math.min(filtered.length, current + 1000))}
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
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            loadingError={null}
            visibleThreadCount={visibleThreadCount}
            canLoadMore={visibleThreadCount < rightFiltered.length}
            onLoadMore={() => setVisibleThreadCount((current) => Math.min(rightFiltered.length, current + 1000))}
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
            isStarred={selected ? starredThreadIds.includes(selected.id) : false}
            onTogglePin={handleTogglePin}
            onToggleStar={() => selected && handleToggleStar(selected.id)}
            onToggleArchive={handleToggleArchive}
          />

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

          <Composer
            draftText={draftText}
            setDraftText={setDraftText}
            onSend={handleSend}
            onOpenSchedule={() => setSchedulePanelOpen(true)}
            onAI={() => setActiveOverlay('ai')}
            onOffer={() => setActiveOverlay('ai')}
            thread={selected}
            threadContext={threadContext}
            onInsertTemplate={(text) => setDraftText(text)}
            onReplaceTemplate={(text) => setDraftText(text)}
            onSendTemplate={handleSend}
            onScheduleTemplate={() => setSchedulePanelOpen(true)}
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
              {selected
                ? <InboxCommandMap thread={selected} zoomedIn={mapMode !== 'side'} />
                : <div className="nx-map-right-empty"><Icon name="map" /><span>Select a thread to view property</span></div>
              }
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
        onReset={() => {
          setStageFilter('all_stages')
          setViewFilter('priority')
          setAdvancedFilters({ outOfStateOwner: 'all' })
        }}
        onClose={() => setActiveOverlay(null)}
      />

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
