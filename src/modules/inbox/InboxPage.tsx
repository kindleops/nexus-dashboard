/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useMemo, useEffect, useCallback } from 'react'
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
  getThreadMessagesForThread,
  getThreadContext,
  sendInboxMessageNow,
  type QueueProcessorHealth,
  type ThreadMessage,
  type ThreadContext,
} from '../../lib/data/inboxData'
import { emitNotification } from '../../shared/NotificationToast'
import { Icon } from '../../shared/icons'
import { NexusTopBar } from './components/NexusTopBar'
import { InboxSidebar } from './components/InboxSidebar'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { IntelligencePanel } from './components/IntelligencePanel'
import { InboxCommandMap } from './InboxCommandMap'
import { InboxUtilityDrawer, MapDossierDrawer } from './components/InboxUtilityDrawer'
import { AdvancedFiltersPopover } from './components/AdvancedFiltersPopover'
import { InboxCommandPalette } from './InboxCommandPalette'
import { TemplateLibraryDrawer } from './templates/TemplateLibraryDrawer'
import { InboxSchedulePanel, type ScheduledTime } from './InboxSchedulePanel'
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

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

export default function InboxPage() {
  const { data, loading: dataLoading } = useInboxData()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<InboxStageSelectValue>('all_stages')
  const [viewFilter, setViewFilter] = useState<InboxViewSelectValue>('priority')
  const [savedPreset, setSavedPreset] = useState<InboxSavedFilterPreset>('my_priority')
  const [advancedFilters, setAdvancedFilters] = useState<InboxAdvancedFilters>({ outOfStateOwner: 'all' })
  const [rightStageFilter, setRightStageFilter] = useState<InboxStageSelectValue>('all_stages')
  const [rightViewFilter, setRightViewFilter] = useState<InboxViewSelectValue>('needs_response')
  const [rightSavedPreset, setRightSavedPreset] = useState<InboxSavedFilterPreset>('new_inbounds')
  const [rightAdvancedFilters, setRightAdvancedFilters] = useState<InboxAdvancedFilters>({ outOfStateOwner: 'all' })
  const [searchQuery, setSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([])
  const [pendingMessagesByThread, setPendingMessagesByThread] = useState<Record<string, ThreadMessage[]>>({})
  const [visibleThreadCount, setVisibleThreadCount] = useState(250)
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([])
  const [starredThreadIds, setStarredThreadIds] = useState<string[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [queueProcessorHealth, setQueueProcessorHealth] = useState<QueueProcessorHealth | null>(null)
  const [queueProcessorHealthLoading, setQueueProcessorHealthLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
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

  const statusCounts = useMemo(() => (
    threads.reduce<Partial<Record<InboxStage, number>>>((counts, thread) => {
      counts[thread.inboxStage] = (counts[thread.inboxStage] ?? 0) + 1
      return counts
    }, {})
  ), [threads])
  const selectedSuppressed = useMemo(() => (selected ? isSuppressedThread(selected) : false), [selected])
  const selectedThreadMap = useMemo(() => {
    const map = new Map<string, (typeof threads)[number]>()
    threads.forEach((thread) => map.set(thread.id, thread))
    return map
  }, [threads])

  const selectedPendingMessages = useMemo(() => {
    if (!selected) return []
    return pendingMessagesByThread[selected.id] ?? []
  }, [pendingMessagesByThread, selected])

  const displayedMessages = useMemo(() => (
    [...selectedMessages, ...selectedPendingMessages].sort((a, b) => (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ))
  ), [selectedMessages, selectedPendingMessages])

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
    setVisibleThreadCount(250)
  }, [searchQuery, stageFilter, viewFilter, advancedFilters])

  useEffect(() => {
    setSelectedThreadIds((current) => current.filter((id) => filtered.some((thread) => thread.id === id)))
  }, [filtered])

  useEffect(() => {
    if (!selected) {
      setSelectedMessages([])
      setThreadContext(null)
      return
    }

    let active = true
    setMessagesLoading(true)
    setContextLoading(true)

    Promise.all([
      getThreadMessagesForThread(selected),
      getThreadContext(selected),
    ]).then(([messages, context]) => {
      if (!active) return
      setSelectedMessages(messages)
      setThreadContext(context)

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
        setTemplateDrawerOpen(false)
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

  const handleWorkflowMutation = useCallback(async (label: string, mutation: () => Promise<unknown>) => {
    try {
      await mutation()
      emitNotification({ title: label, detail: 'Action completed successfully', severity: 'success' })
    } catch (err) {
      emitNotification({ title: 'Error', detail: String(err), severity: 'critical' })
    }
  }, [])

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

  const handleToggleThreadSelection = useCallback((threadId: string) => {
    setSelectedThreadIds((current) => (
      current.includes(threadId)
        ? current.filter((id) => id !== threadId)
        : [...current, threadId]
    ))
  }, [])

  const handleSelectAllVisible = useCallback(() => {
    const visibleIds = filtered.slice(0, visibleThreadCount).map((thread) => thread.id)
    setSelectedThreadIds(visibleIds)
  }, [filtered, visibleThreadCount])

  const selectedThreads = useMemo(() => (
    selectedThreadIds
      .map((id) => selectedThreadMap.get(id))
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
  ), [selectedThreadIds, selectedThreadMap])

  const handleBulkReplyAll = useCallback(async () => {
    if (selectedThreads.length === 0) return
    const text = window.prompt('Reply all message')?.trim()
    if (!text) return

    const results = await Promise.all(selectedThreads.map((thread) => sendInboxMessageNow(thread, text)))
    const successCount = results.filter((result) => result.ok).length
    emitNotification({
      title: 'Bulk Reply',
      detail: `${successCount}/${selectedThreads.length} queued for immediate send`,
      severity: successCount === selectedThreads.length ? 'success' : 'warning',
    })
  }, [selectedThreads])

  const handleBulkStageChange = useCallback((stage: InboxStageSelectValue) => {
    if (!stage || stage === 'all_stages') return
    const workflowStageMap: Partial<Record<InboxStageSelectValue, InboxStage>> = {
      needs_response: 'needs_response',
      qualified: 'interested',
      suppressed: 'dnc_opt_out',
      closed: 'closed_converted',
      offer_sent: 'needs_offer',
    }
    const normalizedStage = workflowStageMap[stage]
    if (!normalizedStage) return
    selectedThreads.forEach((thread) => {
      void handleWorkflowMutation('Stage Updated', () => updateThreadStage(thread, normalizedStage))
    })
  }, [handleWorkflowMutation, selectedThreads])

  const handleBulkStatusChange = useCallback((status: 'open' | 'read' | 'unread' | 'archived' | 'suppressed') => {
    if (!status) return
    selectedThreads.forEach((thread) => {
      void handleWorkflowMutation('Status Updated', () => updateThreadStatus(thread, status))
    })
  }, [handleWorkflowMutation, selectedThreads])

  const handleBulkArchiveToggle = useCallback(() => {
    selectedThreads.forEach((thread) => {
      void handleWorkflowMutation('Thread Archived', () => archiveThread(thread))
    })
  }, [handleWorkflowMutation, selectedThreads])

  const handleBulkPinToggle = useCallback(() => {
    selectedThreads.forEach((thread) => {
      void handleWorkflowMutation(thread.isPinned ? 'Thread Unpinned' : 'Thread Pinned', () => (
        thread.isPinned ? unpinThread(thread) : pinThread(thread)
      ))
    })
  }, [handleWorkflowMutation, selectedThreads])

  const handleBulkStarToggle = useCallback(() => {
    selectedThreadIds.forEach((threadId) => {
      handleToggleStar(threadId)
    })
  }, [handleToggleStar, selectedThreadIds])

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
    <div className={cls('nx-premium-inbox', ...layoutClasses)}>
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
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            savedPreset={savedPreset}
            onApplySavedPreset={applySavedPreset}
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            loadingError={data.liveFetchStatus === 'error' ? data.liveFetchError : null}
            visibleThreadCount={visibleThreadCount}
            canLoadMore={visibleThreadCount < filtered.length}
            onLoadMore={() => setVisibleThreadCount((current) => Math.min(filtered.length, current + 250))}
            selectedThreadIds={selectedThreadIds}
            onToggleThreadSelection={handleToggleThreadSelection}
            onSelectAllVisible={handleSelectAllVisible}
            onBulkReplyAll={handleBulkReplyAll}
            onBulkStageChange={handleBulkStageChange}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkArchiveToggle={handleBulkArchiveToggle}
            onBulkPinToggle={handleBulkPinToggle}
            onBulkStarToggle={handleBulkStarToggle}
            starredThreadIds={starredThreadIds}
            onToggleStarThread={handleToggleStar}
          />
        )}

        {isDoubleSided && (
          <InboxSidebar
            threads={rightFiltered}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            savedPreset={rightSavedPreset}
            onApplySavedPreset={applyRightSavedPreset}
            viewCounts={viewCounts}
            onOpenAdvancedFilters={() => setActiveOverlay('filters')}
            loadingError={null}
            visibleThreadCount={visibleThreadCount}
            canLoadMore={visibleThreadCount < rightFiltered.length}
            onLoadMore={() => setVisibleThreadCount((current) => Math.min(rightFiltered.length, current + 250))}
            selectedThreadIds={selectedThreadIds}
            onToggleThreadSelection={handleToggleThreadSelection}
            onSelectAllVisible={handleSelectAllVisible}
            onBulkReplyAll={handleBulkReplyAll}
            onBulkStageChange={handleBulkStageChange}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkArchiveToggle={handleBulkArchiveToggle}
            onBulkPinToggle={handleBulkPinToggle}
            onBulkStarToggle={handleBulkStarToggle}
            starredThreadIds={starredThreadIds}
            onToggleStarThread={handleToggleStar}
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
            messages={displayedMessages}
            loading={messagesLoading}
            isSuppressed={selectedSuppressed}
            isStarred={selected ? starredThreadIds.includes(selected.id) : false}
            onTogglePin={handleTogglePin}
            onToggleStar={() => selected && handleToggleStar(selected.id)}
            onToggleArchive={handleToggleArchive}
          />

          <Composer
            draftText={draftText}
            setDraftText={setDraftText}
            onSend={handleSend}
            onOpenTemplates={() => setTemplateDrawerOpen(true)}
            onOpenSchedule={() => setSchedulePanelOpen(true)}
            onAI={() => setActiveOverlay('ai')}
            onOffer={() => setActiveOverlay('ai')}
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

      <TemplateLibraryDrawer
        open={templateDrawerOpen}
        onClose={() => setTemplateDrawerOpen(false)}
        thread={selected}
        threadContext={threadContext}
        onInsert={(text) => setDraftText(text)}
        onReplace={(text) => setDraftText(text)}
        onSendNow={handleSend}
        onQueue={handleSend}
        onSchedule={() => setSchedulePanelOpen(true)}
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
