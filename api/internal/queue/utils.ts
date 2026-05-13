import { getSupabaseClient } from '../../../src/lib/supabaseClient'
import { asBoolean, asString, normalizeStatus } from '../../../src/lib/data/shared'

export interface SuppressionResult {
  safe: boolean
  blocked: boolean
  reason: string | null
  codes: string[]
}

/**
 * Hard Suppression Gate: Validates if a contact is safe to message.
 */
export async function checkSuppression(params: {
  phone: string
  threadKey?: string
  masterOwnerId?: string
  prospectId?: string
}): Promise<SuppressionResult> {
  const supabase = getSupabaseClient()
  const codes: string[] = []
  const phone = params.phone.replace(/\D/g, '')

  if (!phone || phone.length < 10) {
    return { safe: false, blocked: true, reason: 'Invalid phone number', codes: ['invalid_phone'] }
  }

  // 1. Check Global SMS Suppression List
  const { data: suppressions } = await supabase
    .from('sms_suppression_list')
    .select('suppression_type, is_active')
    .eq('phone_e164', phone.length === 10 ? `+1${phone}` : `+${phone}`)
    .eq('is_active', true)

  if (suppressions && suppressions.length > 0) {
    const types = suppressions.map(s => s.suppression_type)
    if (types.includes('opt_out')) codes.push('opt_out')
    if (types.includes('dnc')) codes.push('dnc')
    if (types.includes('wrong_number')) codes.push('wrong_number')
    if (types.includes('hostile')) codes.push('hostile_block')
    if (types.includes('legal')) codes.push('legal_threat')
  }

  // 2. Check Thread State
  if (params.threadKey) {
    const { data: thread } = await supabase
      .from('inbox_thread_state')
      .select('is_suppressed, automation_state, status')
      .eq('thread_key', params.threadKey)
      .single()

    if (thread) {
      if (thread.is_suppressed) codes.push('thread_suppressed')
      if (thread.automation_state === 'manual_control' || thread.automation_state === 'paused') {
        codes.push('human_takeover')
      }
    }
  }

  // 3. Check Message Events for recent Opt-Outs
  const { data: recentEvents } = await supabase
    .from('message_events')
    .select('is_opt_out, detected_intent')
    .eq('phone', phone.length === 10 ? `+1${phone}` : `+${phone}`)
    .order('created_at', { ascending: false })
    .limit(1)

  if (recentEvents && recentEvents.length > 0) {
    if (asBoolean(recentEvents[0].is_opt_out, false)) codes.push('opt_out_recent')
    const intent = normalizeStatus(recentEvents[0].detected_intent)
    if (['opt_out', 'wrong_number', 'hostile_or_legal'].includes(intent)) {
      codes.push(`intent_${intent}`)
    }
  }

  const blocked = codes.length > 0
  return {
    safe: !blocked,
    blocked,
    reason: blocked ? `Suppressed by: ${codes.join(', ')}` : null,
    codes
  }
}

/**
 * Generates a deterministic dedupe key for the queue.
 */
export function generateDedupeKey(params: {
  threadKey: string
  phone: string
  queueType: string
  stageCode: string
  touchNumber: number
}): string {
  const normalizedPhone = params.phone.replace(/\D/g, '')
  return `${params.threadKey}:${normalizedPhone}:${params.queueType}:${params.stageCode}:${params.touchNumber}`
}

/**
 * Calculates a natural delay in minutes based on intent.
 */
export function getNaturalDelay(intent: string): number {
  const normalized = normalizeStatus(intent)
  switch (normalized) {
    case 'simple_confirmation':
    case 'yes':
      return Math.floor(Math.random() * (4 - 2 + 1) + 2) // 2-4 mins
    case 'who_is_this':
    case 'confused':
      return Math.floor(Math.random() * (5 - 2 + 1) + 2) // 2-5 mins
    case 'spanish_route':
      return Math.floor(Math.random() * (6 - 3 + 1) + 3) // 3-6 mins
    case 'asking_price':
    case 'negotiation':
      return Math.floor(Math.random() * (12 - 5 + 1) + 5) // 5-12 mins
    case 'hot_lead':
    case 'offer_requested':
      return Math.floor(Math.random() * (8 - 3 + 1) + 3) // 3-8 mins
    default:
      return 5
  }
}

/**
 * Checks for existing active queue items with the same dedupe key.
 */
export async function checkExistingQueue(dedupeKey: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('send_queue')
    .select('id')
    .eq('dedupe_key', dedupeKey)
    .in('queue_status', ['queued', 'scheduled', 'sending'])
    .limit(1)

  return !!(data && data.length > 0)
}

/**
 * Adjusts scheduling to respect contact windows (8am-8pm local).
 */
export function scheduleWithWindow(baseDate: Date, timezone: string): Date {
  const date = new Date(baseDate)
  const hour = date.getHours() 

  if (hour < 8) {
    date.setHours(8, Math.floor(Math.random() * 15), 0, 0)
  } else if (hour >= 20) {
    date.setDate(date.getDate() + 1)
    date.setHours(9, Math.floor(Math.random() * 15), 0, 0)
  }

  // Add jitter
  date.setMinutes(date.getMinutes() + Math.floor(Math.random() * 12) + 1)
  
  return date
}

import { renderTemplate, type SmsTemplate } from '../../../src/lib/data/templateData'

/**
 * Renders a template and ensures the result is not blank.
 */
export function renderMessage(template: SmsTemplate, context: Record<string, string>): { 
  ok: boolean, 
  text: string, 
  reason?: string 
} {
  if (!template || !template.templateText || template.templateText.trim() === '') {
    return { ok: false, text: '', reason: 'missing_template_text' }
  }

  const rendered = renderTemplate(template, context)
  
  if (rendered.missingVariables.length > 0) {
    return { ok: false, text: '', reason: `missing_variables: ${rendered.missingVariables.join(', ')}` }
  }

  const text = rendered.renderedText.trim()
  if (!text) {
    return { ok: false, text: '', reason: 'blank_message_body' }
  }

  return { ok: true, text }
}

/**
 * Cleans up existing active blank queue rows.
 */
export async function cleanupBlankQueueRows(): Promise<number> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('send_queue')
    .update({ 
      queue_status: 'blocked', 
      blocked_reason: 'blank_message_body',
      updated_at: new Date().toISOString()
    })
    .in('queue_status', ['queued', 'scheduled', 'sending'])
    .or('message_body.eq."",message_text.eq.""')
    .select('id')

  if (error) {
    console.error('[Cleanup] Failed to clean up blank rows:', error)
    return 0
  }
  return data?.length || 0
}
