import { useState, useMemo, useEffect, useCallback } from 'react'
import { useInboxData, toWorkflowThread } from './inbox.adapter'
import { 
  updateThreadStage, 
  archiveThread, 
  markThreadRead,
  type InboxStatusTab
} from '../../lib/data/inboxWorkflowData'
import { getThreadMessagesForThread, getThreadContext, type ThreadMessage, type ThreadContext } from '../../lib/data/inboxData'
import { emitNotification } from '../../shared/NotificationToast'

// Modular Components
import { ThreadList } from './components/ThreadList'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { IntelligencePanel } from './components/IntelligencePanel'

// Overlays
import { InboxCommandPalette } from './InboxCommandPalette'
import { TemplateLibraryDrawer } from './templates/TemplateLibraryDrawer'
import { InboxSchedulePanel, type ScheduledTime } from './InboxSchedulePanel'

import './inbox-premium.css'

export default function InboxPage() {
  const { data, loading: dataLoading } = useInboxData()
  
  // -- Core State --
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workflowTab, setWorkflowTab] = useState<InboxStatusTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  
  // -- Detail State --
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  
  // -- Overlay State --
  const [commandOpen, setCommandOpen] = useState(false)
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false)
  const [scheduledTime, setScheduledTime] = useState<ScheduledTime | null>(null)

  // -- Derived Data --
  const threads = useMemo(() => (data.threads ?? []).map(toWorkflowThread), [data])
  const selected = useMemo(() => threads.find((t: any) => t.id === selectedId) ?? null, [threads, selectedId])

  const filtered = useMemo(() => {
    return threads.filter((t: any) => {
      const matchTab = workflowTab === 'all' || t.inboxStage === workflowTab
      const matchSearch = !searchQuery || 
        t.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.subject.toLowerCase().includes(searchQuery.toLowerCase())
      return matchTab && matchSearch
    })
  }, [threads, workflowTab, searchQuery])

  // -- Initial Selection --
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  // -- Load Detail Data --
  useEffect(() => {
    if (!selected) {
      setSelectedMessages([])
      setThreadContext(null)
      return
    }

    setMessagesLoading(true)
    setContextLoading(true)

    Promise.all([
      getThreadMessagesForThread(selected as any),
      getThreadContext(selected as any)
    ]).then(([messages, context]) => {
      setSelectedMessages(messages)
      setThreadContext(context)
    }).finally(() => {
      setMessagesLoading(false)
      setContextLoading(false)
    })
  }, [selected])

  // -- Handlers --
  const handleWorkflowMutation = useCallback(async (label: string, mutation: () => Promise<any>) => {
    try {
      await mutation()
      emitNotification({ title: label, detail: 'Action completed successfully', severity: 'success' })
    } catch (err) {
      emitNotification({ title: 'Error', detail: String(err), severity: 'critical' })
    }
  }, [])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const handleSend = useCallback(async (text: string) => {
    if (!selected || !text.trim()) return
    emitNotification({ title: 'Sending...', detail: `Message: "${text.slice(0, 20)}..."`, severity: 'info' })
    setDraftText('')
  }, [selected])

  if (dataLoading) return (
    <div className="nx-premium-inbox">
      <div className="nx-inbox-loading-state">
        <div className="nx-loading-spinner" />
        <span>Loading NEXUS Inbox…</span>
      </div>
    </div>
  )

  return (
    <div className="nx-premium-inbox">
      <ThreadList 
        threads={filtered}
        selectedId={selectedId}
        onSelect={handleSelect}
        workflowTab={workflowTab}
        setWorkflowTab={setWorkflowTab}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onUpdateStage={(id, stage) => {
          const t = threads.find((thread: any) => thread.id === id)
          if (t) void handleWorkflowMutation('Stage Updated', () => updateThreadStage(t, stage))
        }}
        onArchive={(t: any) => {
          void handleWorkflowMutation('Thread Archived', () => archiveThread(t))
        }}
        onMarkRead={(t: any) => {
          void handleWorkflowMutation('Marked Read', () => markThreadRead(t))
        }}
      />

      <main className="nx-inbox-center">
        <ChatThread 
          thread={selected}
          messages={selectedMessages}
          loading={messagesLoading}
        />
        
        <Composer 
          draftText={draftText}
          setDraftText={setDraftText}
          onSend={handleSend}
          onOpenTemplates={() => setTemplateDrawerOpen(true)}
          onOpenSchedule={() => setSchedulePanelOpen(true)}
          onAI={() => setCommandOpen(true)}
        />
      </main>

      <IntelligencePanel 
        thread={selected}
        context={threadContext}
      />

      <InboxCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        hasThread={!!selected}
        commands={[]} // To be populated with clean commands
      />
      
      <TemplateLibraryDrawer
        open={templateDrawerOpen}
        onClose={() => setTemplateDrawerOpen(false)}
        thread={selected as any}
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
        thread={selected as any}
        onSchedule={(time) => {
          setScheduledTime(time)
          setSchedulePanelOpen(false)
          emitNotification({ title: 'Scheduled', detail: `Sent set for ${time.label}`, severity: 'success' })
        }}
      />
      {contextLoading && <div style={{ display: 'none' }}>loading...</div>}
      {scheduledTime && <div style={{ display: 'none' }}>{scheduledTime.label}</div>}
    </div>
  )
}
