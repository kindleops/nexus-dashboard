import { useCallback, useEffect, useRef, useState } from 'react'
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
  markThreadRead,
  archiveThread,
  flagThread,
  doesMessageBelongToThread,
} from '../../lib/data/inboxData'
import type { ThreadMessage, ThreadContext, SuggestedDraft } from '../../lib/data/inboxData'
import { shouldUseSupabase } from '../../lib/data/shared'
import { getSupabaseClient, hasSupabaseEnv } from '../../lib/supabaseClient'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const PRIORITY_LABEL: Record<InboxThread['priority'], string> = {
  urgent: 'P0', high: 'P1', normal: 'P2', low: 'P3',
}

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

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })
    .replace(':00 ', ' ')
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────

type InboxLayoutMode = 'default' | 'conversation_focus' | 'triage'

export const InboxPage = ({ data }: { data: InboxModel }) => {
  // ── Live threads state (refreshable) ─────────────────────────────────────
  const [threads, setThreads] = useState<InboxThread[]>(data.threads)
  const [liveStats, setLiveStats] = useState<Pick<InboxModel, 'unreadCount' | 'urgentCount' | 'totalCount' | 'aiDraftCount'>>({
    unreadCount: data.unreadCount,
    urgentCount: data.urgentCount,
    totalCount: data.totalCount,
    aiDraftCount: data.aiDraftCount,
  })
  const [newMessageIndicator, setNewMessageIndicator] = useState(false)

  // ── Thread message / context / draft state ────────────────────────────────
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [suggestedDraft, setSuggestedDraft] = useState<SuggestedDraft | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<'off' | 'polling' | 'subscribed'>('off')
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(data.threads[0]?.id ?? null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  const [showAiActions, setShowAiActions] = useState(false)
  const [splitThread, setSplitThread] = useState<InboxThread | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false)
  const [scheduledTime, setScheduledTime] = useState<ScheduledTime | null>(null)
  const [now, setNow] = useState(() => new Date())
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

  const filtered = threads
    .filter(t => filterStatus === 'all' || t.status === filterStatus)
    .filter(t => filterPriority === 'all' || t.priority === filterPriority)
    .filter(t => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (
        t.ownerName.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.preview.toLowerCase().includes(q) ||
        t.marketId.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q) ||
        t.sentiment.toLowerCase().includes(q) ||
        t.labels.some(l => l.toLowerCase().includes(q))
      )
    })

  const selected = threads.find(t => t.id === selectedId) ?? null
  const hotCount = threads.filter(t => t.sentiment === 'hot').length
  const aiReady = threads.filter(t => t.aiDraft && t.status === 'unread').length

  // ── Live clock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Load thread messages + context + draft when thread changes ─────────────
  useEffect(() => {
    if (!selectedId || !selected) return
    if (!shouldUseSupabase()) {
      // Fall back to a single synthetic message from thread preview
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

    setMessagesLoading(true)
    setMessagesError(null)
    setThreadContext(null)
    setSuggestedDraft(null)

    Promise.all([
      getThreadMessagesForThread(selected),
      getThreadContext(selected),
      getSuggestedDraft(selected),
    ])
      .then(([messages, context, draft]) => {
        if (cancelled) return
        setSelectedMessages(messages)
        setThreadContext(context)
        setSuggestedDraft(draft)
        setLastRefreshAt(new Date().toISOString())
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Failed to load thread'
        setMessagesError(msg)
        // Fallback to thread preview as single message
        setSelectedMessages([{
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
        }])
        if (selected.aiDraft) setSuggestedDraft({ text: selected.aiDraft, confidence: null, reason: null, source: 'placeholder' })
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ── Thread context separate loading indicator ──────────────────────────────
  useEffect(() => {
    setContextLoading(messagesLoading)
    setDraftLoading(messagesLoading)
  }, [messagesLoading])

  // ── Polling: refresh thread list every 15 seconds ─────────────────────────
  useEffect(() => {
    if (!shouldUseSupabase()) return

    const debounceRef = { timer: 0 }

    const refresh = () => {
      window.clearTimeout(debounceRef.timer)
      debounceRef.timer = window.setTimeout(async () => {
        try {
          const fresh = await fetchInboxModel()
          setThreads(fresh.threads)
          setLiveStats({
            unreadCount: fresh.unreadCount,
            urgentCount: fresh.urgentCount,
            totalCount: fresh.totalCount,
            aiDraftCount: fresh.aiDraftCount,
          })
          setLastRefreshAt(new Date().toISOString())
        } catch {
          // Silently ignore poll errors
        }
      }, 500)
    }

    const pollId = setInterval(refresh, 15_000)
    setRealtimeStatus('polling')

    // Supabase realtime subscription (preferred)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null
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
              refresh()
              // If the change affects the selected thread, reload its messages and context
              const record = payload.new ?? payload.old
              if (record && selected && doesMessageBelongToThread(record, selected)) {
                Promise.all([
                  getThreadMessagesForThread(selected),
                  getThreadContext(selected),
                ])
                  .then(([messages, context]) => {
                    setSelectedMessages(messages)
                    setThreadContext(context)
                    setLastRefreshAt(new Date().toISOString())
                  })
                  .catch(() => undefined)
              }
            },
          )
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') setRealtimeStatus('subscribed')
          })
      } catch {
        // Realtime unavailable — polling fallback is active
        setRealtimeStatus('polling')
      }
    }

    return () => {
      clearInterval(pollId)
      window.clearTimeout(debounceRef.timer)
      if (channel) {
        try {
          channel.unsubscribe()
        } catch {
          // ignore
        }
      }
      setRealtimeStatus('off')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

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
    setDraftText('')
    setShowAiActions(false)
    setScheduledTime(null)
    setNewMessageIndicator(false)
    messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    // Mark thread read in Supabase if enabled
    if (shouldUseSupabase()) {
      markThreadRead(id).catch(() => undefined)
    }
  }, [])

  const handleSend = useCallback(() => {
    if (!draftText.trim() || !selected) return
    emitNotification({
      title: 'Reply Sent',
      detail: `Response sent to ${selected.ownerName}`,
      severity: 'success',
      sound: 'ui-confirm',
    })
    setDraftText('')
    setScheduledTime(null)
  }, [draftText, selected])

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

      // ── Esc → close overlays / exit layout mode ──────────────────────────
      if (e.key === 'Escape') {
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
          if (selected) emitNotification({ title: 'Thread Archived', detail: selected.ownerName, severity: 'info', sound: 'ui-confirm' })
          break
        case 'u': case 'U':
          if (selected) emitNotification({ title: 'Marked Read', detail: selected.ownerName, severity: 'info', sound: 'ui-confirm' })
          break
        case 'f': case 'F':
          if (selected) emitNotification({ title: 'Thread Flagged', detail: selected.ownerName, severity: 'info', sound: 'ui-confirm' })
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
  }, [selected, selectedId, commandOpen, schedulePanelOpen, splitThread, searchQuery, filtered, handleSelect, handleSend, layoutMode, leftPanelOpen, rightPanelOpen, mapOpen])

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
      action: () => emitNotification({ title: 'Thread Archived', detail: selected?.ownerName ?? '', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'status-mark-read', label: 'Mark Read', category: 'Status', shortcut: 'U',
      keywords: ['read', 'seen', 'mark read'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Marked Read', detail: selected?.ownerName ?? '', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'status-mark-unread', label: 'Mark Unread', category: 'Status',
      keywords: ['unread', 'new', 'unseen'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Marked Unread', detail: selected?.ownerName ?? '', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'status-flag', label: 'Flag Thread', category: 'Status', shortcut: 'F',
      keywords: ['flag', 'important', 'priority', 'star'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Thread Flagged', detail: selected?.ownerName ?? '', severity: 'info', sound: 'ui-confirm' })
    },
    { id: 'status-urgent', label: 'Mark Urgent', category: 'Status',
      keywords: ['urgent', 'p0', 'asap', 'hot', 'critical'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Marked Urgent', detail: selected?.ownerName ?? '', severity: 'warning', sound: 'ui-confirm' })
    },
    { id: 'status-dnc', label: 'Mark DNC', category: 'Status',
      keywords: ['dnc', 'do not contact', 'stop', 'opt out', 'remove'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Marked DNC', detail: `${selected?.ownerName ?? ''} removed from outreach`, severity: 'warning', sound: 'ui-confirm' })
    },
    { id: 'status-wrong-number', label: 'Mark Wrong Number', category: 'Status',
      keywords: ['wrong number', 'bad number', 'incorrect'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Marked Wrong Number', detail: selected?.ownerName ?? '', severity: 'warning', sound: 'ui-confirm' })
    },
    { id: 'status-not-interested', label: 'Mark Not Interested', category: 'Status',
      keywords: ['not interested', 'no', 'declined', 'rejected'],
      requiresThread: true,
      action: () => emitNotification({ title: 'Marked Not Interested', detail: selected?.ownerName ?? '', severity: 'info', sound: 'ui-confirm' })
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
      action: () => setFilterStatus('unread')
    },
    { id: 'filter-replied', label: 'Show Replied', category: 'Filters',
      keywords: ['replied', 'sent', 'responded'],
      action: () => setFilterStatus('replied')
    },
    { id: 'filter-archived', label: 'Show Archived', category: 'Filters',
      keywords: ['archived', 'done', 'cleared'],
      action: () => setFilterStatus('archived')
    },
    { id: 'filter-all', label: 'Show All Threads', category: 'Filters',
      keywords: ['all', 'clear filter', 'reset'],
      action: () => { setFilterStatus('all'); setFilterPriority('all') }
    },
    { id: 'filter-urgent', label: 'Show Urgent (P0)', category: 'Filters',
      keywords: ['urgent', 'p0', 'critical', 'hot'],
      action: () => setFilterPriority('urgent')
    },
    { id: 'filter-high', label: 'Show High Priority (P1)', category: 'Filters',
      keywords: ['high', 'p1'],
      action: () => setFilterPriority('high')
    },
    { id: 'filter-normal', label: 'Show Normal Priority (P2)', category: 'Filters',
      keywords: ['normal', 'p2', 'medium'],
      action: () => setFilterPriority('normal')
    },
    { id: 'filter-clear', label: 'Clear All Filters', category: 'Filters',
      keywords: ['clear', 'reset', 'remove filter', 'all'],
      action: () => { setFilterStatus('all'); setFilterPriority('all'); setSearchQuery('') }
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
      !leftPanelOpen && 'is-left-collapsed',
      !rightPanelOpen && 'is-right-collapsed',
      layoutMode === 'conversation_focus' && 'is-conversation-focus',
      layoutMode === 'triage' && 'is-triage-mode',
    )}>

      {/* ══ App Header ═══════════════════════════════════════════════════════ */}
      <header className="nx-inbox__hdr">
        {/* Left: title + status badges */}
        <div className="nx-inbox__hdr-left">
          <div className="nx-inbox__hdr-title">
            <Icon name="inbox" className="nx-inbox__hdr-icon" />
            <span>Inbox</span>
          </div>
          <div className="nx-inbox__hdr-badges">
            {newMessageIndicator && (
              <span className="nx-inbox-badge nx-inbox-badge--teal" title="New messages arrived">
                New messages
              </span>
            )}
            {liveStats.unreadCount > 0 && (
              <span className="nx-inbox-badge nx-inbox-badge--cyan" title={`${liveStats.unreadCount} unread`}>
                {liveStats.unreadCount} unread
              </span>
            )}
            {liveStats.urgentCount > 0 && (
              <span className="nx-inbox-badge nx-inbox-badge--red" title={`${liveStats.urgentCount} urgent`}>
                {liveStats.urgentCount} urgent
              </span>
            )}
            {hotCount > 0 && (
              <span className="nx-inbox-badge nx-inbox-badge--amber" title={`${hotCount} hot`}>
                {hotCount} hot
              </span>
            )}
            {aiReady > 0 && (
              <span className="nx-inbox-badge nx-inbox-badge--teal" title={`${aiReady} AI ready`}>
                {aiReady} AI ready
              </span>
            )}
          </div>
        </div>

        {/* Center: search / command input */}
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
          <kbd className="nx-inbox__hdr-search-kbd">⌘⇧K</kbd>
        </div>

        {/* Right: live state + clock + actions */}
        <div className="nx-inbox__hdr-right">
          <span className="nx-inbox-status-pill nx-inbox-status-pill--live">LIVE</span>
          {aiReady > 0 && (
            <span className="nx-inbox-status-pill nx-inbox-status-pill--ai">AI READY</span>
          )}
          <span className="nx-inbox__hdr-time">{formatClock(now)}</span>
          <span className="nx-inbox__hdr-date">{formatDate(now)}</span>
          <div className="nx-inbox__hdr-layout-hints" aria-hidden="true">
            <button
              type="button"
              className={cls('nx-inbox__hdr-layout-btn', !leftPanelOpen && 'is-active')}
              onClick={() => setLeftPanelOpen(v => !v)}
              title="Toggle Thread Queue ([)"
            >[ Queue</button>
            <button
              type="button"
              className={cls('nx-inbox__hdr-layout-btn', layoutMode === 'triage' && 'is-active')}
              onClick={() => { setLeftPanelOpen(true); setRightPanelOpen(true); setLayoutMode(m => m === 'triage' ? 'default' : 'triage') }}
              title="Toggle Triage Mode (\\)"
            >\ Triage</button>
            <button
              type="button"
              className={cls('nx-inbox__hdr-layout-btn', !rightPanelOpen && 'is-active')}
              onClick={() => setRightPanelOpen(v => !v)}
              title="Toggle Seller Dossier (])">
              ] Dossier
            </button>
          </div>
          <button
            type="button"
            className="nx-inbox__hdr-btn"
            title="Notifications"
            aria-label={`${liveStats.unreadCount} unread notifications`}
          >
            <Icon name="bell" className="nx-inbox__hdr-btn-icon" />
            {liveStats.unreadCount > 0 && (
              <span className="nx-inbox__hdr-notif">{liveStats.unreadCount}</span>
            )}
          </button>
          <button
            type="button"
            className="nx-inbox__hdr-btn"
            title="Inbox options (⌘⇧K)"
            aria-label="Inbox command palette"
            onClick={() => setCommandOpen(true)}
          >
            <Icon name="settings" className="nx-inbox__hdr-btn-icon" />
          </button>
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
                {liveStats.unreadCount > 0 && (
                  <span className="nx-inbox__count-pill">{liveStats.unreadCount}</span>
                )}
                {aiReady > 0 && (
                  <span className="nx-inbox__ai-pill">
                    <Icon name="spark" className="nx-inbox__ai-pill-icon" />
                    {aiReady}
                  </span>
                )}
              </div>
            </div>
            <div className="nx-inbox__stats">
              <div className="nx-inbox__stat">
                <span className="nx-inbox__stat-count">{liveStats.totalCount}</span>
                <span className="nx-inbox__stat-label">Total</span>
              </div>
              <div className="nx-inbox__stat">
                <span className="nx-inbox__stat-count">{liveStats.unreadCount}</span>
                <span className="nx-inbox__stat-label">Unread</span>
              </div>
              <div className="nx-inbox__stat">
                <span className="nx-inbox__stat-count">{liveStats.urgentCount}</span>
                <span className="nx-inbox__stat-label">Urgent</span>
              </div>
              <div className="nx-inbox__stat">
                <span className="nx-inbox__stat-count">{liveStats.aiDraftCount}</span>
                <span className="nx-inbox__stat-label">AI Ready</span>
              </div>
            </div>
            <div className="nx-inbox__search-wrap">
              <Icon name="search" className="nx-inbox__search-icon" />
              <input
                className="nx-inbox__search"
                type="search"
                placeholder="Filter threads…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Filter inbox threads"
              />
              {searchQuery && (
                <button type="button" className="nx-inbox__search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">×</button>
              )}
            </div>
            <div className="nx-inbox__filter-row">
              {['all', 'unread', 'replied', 'archived'].map(s => (
                <button
                  key={s}
                  type="button"
                  className={cls('nx-inbox__filter-btn', filterStatus === s && 'is-active')}
                  onClick={() => setFilterStatus(s)}
                >
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="nx-inbox__filter-row nx-inbox__filter-row--tight">
              {[
                { id: 'all', label: 'Any' },
                { id: 'urgent', label: 'P0' },
                { id: 'high', label: 'P1' },
                { id: 'normal', label: 'P2' },
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={cls('nx-inbox__filter-btn nx-inbox__filter-btn--priority', filterPriority === p.id && 'is-active')}
                  onClick={() => setFilterPriority(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="nx-inbox__queue-meta">
            <span>{filtered.length} threads</span>
            {(filterStatus !== 'all' || filterPriority !== 'all' || searchQuery) && (
              <button
                type="button"
                className="nx-inline-button"
                onClick={() => { setFilterStatus('all'); setFilterPriority('all'); setSearchQuery('') }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="nx-inbox__queue-list">
            {filtered.map(thread => (
              <button
                key={thread.id}
                type="button"
                className={cls(
                  'nx-thread-card',
                  selectedId === thread.id && 'is-selected',
                  thread.status === 'unread' && 'is-unread',
                  thread.sentiment === 'hot' && 'is-hot',
                  thread.sentiment === 'cold' && thread.status !== 'archived' && 'is-stalled',
                )}
                onClick={() => handleSelect(thread.id)}
              >
                <div className="nx-thread-card__row">
                  <div className="nx-thread-card__name-wrap">
                    <span className={cls('nx-thread-card__sentiment', SENTIMENT_CLS[thread.sentiment])} />
                    <span className="nx-thread-card__name">{thread.ownerName}</span>
                    {thread.unreadCount > 0 && (
                      <span className="nx-thread-card__unread">{thread.unreadCount}</span>
                    )}
                  </div>
                  <div className="nx-thread-card__meta">
                    <span className={cls('nx-thread-card__priority', PRIORITY_CLS[thread.priority])}>
                      {PRIORITY_LABEL[thread.priority]}
                    </span>
                    <span className="nx-thread-card__time">{thread.lastMessageLabel}</span>
                  </div>
                </div>
                <div className="nx-thread-card__subject">{thread.subject}</div>
                <div className="nx-thread-card__preview">{thread.preview}</div>
                <div className="nx-thread-card__chips">
                  {thread.aiDraft && (
                    <span className="nx-thread-card__ai-chip">
                      <Icon name="spark" className="nx-thread-card__chip-icon" />
                      AI Draft
                    </span>
                  )}
                  {thread.labels.slice(0, 2).map(l => (
                    <span key={l} className="nx-thread-card__label-chip">{l}</span>
                  ))}
                  <span className="nx-thread-card__count">{thread.messageCount} msgs</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="nx-inbox__empty">No threads match this filter.</div>
            )}
          </div>
        </aside>

        {/* ── Center: Conversation Workspace ────────────────────────────── */}
        <main className="nx-inbox__workspace">
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
                  <button type="button" className="nx-inbox__conv-btn" title="Reply (R)" onClick={() => composerRef.current?.focus()}>
                    <Icon name="send" className="nx-inbox__conv-btn-icon" />
                    Reply
                  </button>
                  <button
                    type="button"
                    className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                    title="Archive (E)"
                    onClick={() => {
                      if (selected) {
                        if (shouldUseSupabase()) archiveThread(selected.id).catch(() => undefined)
                        emitNotification({ title: 'Thread Archived', detail: selected.ownerName, severity: 'info', sound: 'ui-confirm' })
                      }
                    }}
                  >
                    <Icon name="archive" className="nx-inbox__conv-btn-icon" />
                    Archive
                  </button>
                  <button
                    type="button"
                    className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                    title="Flag (F)"
                    onClick={() => {
                      if (selected) {
                        if (shouldUseSupabase()) flagThread(selected.id).catch(() => undefined)
                        emitNotification({ title: 'Thread Flagged', detail: selected.ownerName, severity: 'info', sound: 'ui-confirm' })
                      }
                    }}
                  >
                    <Icon name="flag" className="nx-inbox__conv-btn-icon" />
                    Flag
                  </button>
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

              <div className="nx-inbox__messages" ref={messagesRef}>
                {messagesLoading && (
                  <div className="nx-inbox__messages-loading">
                    <Icon name="activity" className="nx-inbox__messages-loading-icon" />
                    <span>Loading messages…</span>
                  </div>
                )}

                {!messagesLoading && messagesError && (
                  <div className="nx-inbox__messages-error">
                    <Icon name="alert" className="nx-inbox__messages-error-icon" />
                    <span>Could not load messages. Showing last known state.</span>
                  </div>
                )}

                {!messagesLoading && selectedMessages.length === 0 && !messagesError && (
                  <div className="nx-inbox__messages-empty">
                    <Icon name="message" className="nx-inbox__messages-empty-icon" />
                    <span>No live message events found for this thread.</span>
                  </div>
                )}

                {selectedMessages.map((msg) => (
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
                    </div>
                  </div>
                ))}

                {suggestedDraft && !draftLoading && (
                  <div className="nx-ai-draft-card">
                    <div className="nx-ai-draft-card__head">
                      <div className="nx-ai-draft-card__label">
                        <Icon name="spark" className="nx-ai-draft-card__icon" />
                        <span>AI Draft</span>
                        <span className="nx-ai-draft-card__status">
                          {suggestedDraft.source === 'placeholder' ? 'Preview' : 'Ready'}
                        </span>
                      </div>
                      {suggestedDraft.confidence !== null && (
                        <div className="nx-ai-draft-card__confidence">
                          <span className="nx-conf-bar">
                            <span className="nx-conf-bar__fill" style={{ width: `${Math.round(suggestedDraft.confidence * 100)}%` }} />
                          </span>
                          <span className="nx-conf-label">{Math.round(suggestedDraft.confidence * 100)}% confidence</span>
                        </div>
                      )}
                    </div>
                    {suggestedDraft.reason && (
                      <p className="nx-ai-draft-card__reason">{suggestedDraft.reason}</p>
                    )}
                    <p className="nx-ai-draft-card__body">{suggestedDraft.text}</p>
                    {selected && (selected.sentiment === 'hot' || selected.priority === 'urgent') && (
                      <div className="nx-ai-draft-card__warning">
                        <Icon name="alert" className="nx-ai-draft-card__warning-icon" />
                        {selected.sentiment === 'hot'
                          ? 'Owner is actively negotiating — consider personalizing pricing details.'
                          : 'High priority — review and personalize before sending.'}
                      </div>
                    )}
                    <div className="nx-ai-draft-card__actions">
                      <button
                        type="button"
                        className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                        title="Send disabled — safe send route not yet configured"
                        disabled
                      >
                        <Icon name="send" className="nx-inbox__conv-btn-icon" />
                        Send Draft
                      </button>
                      <button
                        type="button"
                        className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost"
                        onClick={() => { setDraftText(suggestedDraft.text); composerRef.current?.focus() }}
                      >
                        Edit &amp; Send
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
              </div>

              <div className="nx-inbox__composer">
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
                      handleSend()
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
                    <button type="button" className="nx-compose-tool" title="Templates" aria-label="Insert template">
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
                      className="nx-inbox__send-btn"
                      disabled={!draftText.trim()}
                      onClick={handleSend}
                      title="Send (⌘↵)"
                    >
                      <Icon name="send" className="nx-inbox__send-btn-icon" />
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="nx-inbox__workspace-empty">
              <Icon name="inbox" className="nx-inbox__workspace-empty-icon" />
              <p>Select a thread to view the conversation</p>
            </div>
          )}
        </main>

        {/* ── Right: Seller Dossier / Map ──────────────────────────────── */}
        {selected && (
          <aside className="nx-inbox__dossier">
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
            <div className="nx-dossier__section">
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

            <div className="nx-dossier__section">
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

            <div className="nx-dossier__section">
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
                    <span className="nx-dossier__value">threadKey: {selected.threadKey ?? '-'}</span>
                    <span className="nx-dossier__value">groupingMethod: {selected.groupingMethod ?? '-'}</span>
                    <span className="nx-dossier__value">groupingConfidence: {selected.groupingConfidence ?? '-'}</span>
                    <span className="nx-dossier__value">ownerId: {selected.ownerId ?? '-'}</span>
                    <span className="nx-dossier__value">prospectId: {selected.prospectId ?? '-'}</span>
                    <span className="nx-dossier__value">propertyId: {selected.propertyId ?? '-'}</span>
                    <span className="nx-dossier__value">phoneNumber: {selected.phoneNumber ?? '-'}</span>
                    <span className="nx-dossier__value">canonicalE164: {selected.canonicalE164 ?? '-'}</span>
                    <span className="nx-dossier__value">messageCount: {selectedMessages.length || selected.messageCount}</span>
                    <span className="nx-dossier__value">latestInbound: {selected.lastInboundAt ?? '-'}</span>
                    <span className="nx-dossier__value">latestOutbound: {selected.lastOutboundAt ?? '-'}</span>
                    <span className="nx-dossier__value">needsResponse: {String(selected.needsResponse ?? false)}</span>
                    <span className="nx-dossier__value">unread: {String(selected.unread ?? selected.unreadCount > 0)}</span>
                    <span className="nx-dossier__value">contextMatchQuality: {threadContext?.contextMatchQuality ?? 'missing'}</span>
                    <span className="nx-dossier__value">matchedOwnerBy: {threadContext?.contextDebug?.matchedOwnerBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedProspectBy: {threadContext?.contextDebug?.matchedProspectBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedPropertyBy: {threadContext?.contextDebug?.matchedPropertyBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedPhoneBy: {threadContext?.contextDebug?.matchedPhoneBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedAiBrainBy: {threadContext?.contextDebug?.matchedAiBrainBy ?? '-'}</span>
                    <span className="nx-dossier__value">matchedQueueBy: {threadContext?.contextDebug?.matchedQueueBy ?? '-'}</span>
                    <span className="nx-dossier__value">realtimeStatus: {realtimeStatus}</span>
                    <span className="nx-dossier__value">lastRefreshAt: {lastRefreshAt ?? '-'}</span>
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

      <InboxSchedulePanel
        open={schedulePanelOpen}
        onClose={() => setSchedulePanelOpen(false)}
        thread={selected}
        onSchedule={time => {
          setScheduledTime(time)
          emitNotification({
            title: 'Reply Scheduled',
            detail: `Scheduled for ${time.label}`,
            severity: 'success',
            sound: 'ui-confirm',
          })
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
