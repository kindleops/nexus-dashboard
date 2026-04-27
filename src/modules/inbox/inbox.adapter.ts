import type { CommandCenterStore } from '../../domain/types'
import { formatRelativeTime } from '../../shared/formatters'
import { fetchInboxModel } from '../../lib/data/inboxData'
import { isDev, shouldUseSupabase } from '../../lib/data/shared'

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
}

export interface InboxModel {
  threads: InboxThread[]
  unreadCount: number
  urgentCount: number
  totalCount: number
  aiDraftCount: number
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

  return {
    threads,
    unreadCount: threads.filter((t) => t.unreadCount > 0).length,
    urgentCount: threads.filter((t) => t.priority === 'urgent').length,
    totalCount: threads.length,
    aiDraftCount: threads.filter((t) => t.aiDraft !== null).length,
  }
}

export const loadInbox = async (): Promise<InboxModel> => {
  if (shouldUseSupabase()) {
    try {
      return await fetchInboxModel()
    } catch (error) {
      if (isDev) {
        console.warn('[NEXUS] Inbox Supabase load failed, using normalized store.', error)
      }
    }
  }

  const { loadCommandCenterStore } = await import('../../domain/normalize-command-center')
  const store = await loadCommandCenterStore()
  return adaptInboxModel(store)
}
