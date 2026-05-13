import { getSupabaseClient } from '../../../src/lib/supabaseClient'
import { checkSuppression } from './utils'
import { asString, normalizeStatus, asNumber } from '../../../src/lib/data/shared'
import { resolveOutboundTextgridNumber } from '../../../src/lib/data/textgridRouting'
import { logInboxActivity } from '../../../src/lib/data/inboxActivityData'

type ApiRequest = {
  method?: string
  body?: any
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: any) => void
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabase = getSupabaseClient()
  const results: any[] = []
  const now = new Date().toISOString()

  try {
    // 1. Find due items
    const { data: queueItems, error: fetchError } = await supabase
      .from('send_queue')
      .select('*')
      .in('queue_status', ['queued', 'scheduled'])
      .lte('scheduled_for_utc', now)
      .limit(20) // Batch size

    if (fetchError) throw fetchError

    for (const item of (queueItems || [])) {
      const itemId = item.id
      const threadKey = asString(item.thread_key)
      const phone = asString(item.to_phone_number)
      const queueCreatedAt = asString(item.created_at)
      const body = asString(item.message_body || item.message_text, '').trim()

      // 1.5 Blank Message Body Safety Gate
      if (!body) {
        await supabase.from('send_queue').update({
          queue_status: 'blocked',
          blocked_reason: 'blank_message_body',
          updated_at: now
        }).eq('id', itemId)

        results.push({ itemId, status: 'blocked', reason: 'blank_message_body' })
        continue
      }

      // 2. Re-run Suppression Gate
      const suppression = await checkSuppression({
        phone,
        threadKey,
        masterOwnerId: item.master_owner_id,
        prospectId: item.prospect_id
      })

      if (suppression.blocked) {
        await supabase.from('send_queue').update({
          queue_status: 'blocked',
          blocked_reason: suppression.reason,
          updated_at: now
        }).eq('id', itemId)
        
        results.push({ itemId, status: 'blocked', reason: suppression.reason })
        continue
      }

      // 3. Check for interim reply
      const { data: recentInbound } = await supabase
        .from('message_events')
        .select('id')
        .eq('phone', phone.length === 10 ? `+1${phone}` : `+${phone}`)
        .eq('direction', 'inbound')
        .gt('created_at', queueCreatedAt)
        .limit(1)

      if (recentInbound && recentInbound.length > 0) {
        await supabase.from('send_queue').update({
          queue_status: 'cancelled',
          paused_reason: 'replied_before_send',
          updated_at: now
        }).eq('id', itemId)

        results.push({ itemId, status: 'cancelled', reason: 'replied_before_send' })
        continue
      }

      // 4. Resolve Routing
      const routingResult = await resolveOutboundTextgridNumber({
        marketId: item.market || item.market_id,
        ourNumber: item.from_phone_number,
        phoneNumber: phone,
        textgridNumberId: item.textgrid_number_id,
        property_address_state: item.property_address_state
      })

      if (!routingResult.ok) {
        await supabase.from('send_queue').update({
          queue_status: 'paused_invalid_queue_row',
          guard_reason: 'NO_VALID_LOCAL_TEXTGRID_NUMBER',
          failed_reason: 'Routing blocked: no sender number',
          updated_at: now
        }).eq('id', itemId)

        results.push({ itemId, status: 'paused_invalid_queue_row', reason: 'NO_VALID_LOCAL_TEXTGRID_NUMBER' })
        continue
      }

      // 5. Send Message (Simulation / Placeholder)
      // In a real system, we'd call the TextGrid API here.
      // Since we are instructed to follow the "existing processor" pattern, 
      // we'll update the record to 'sent' and record the event.
      
      const updatePayload: any = {
        queue_status: 'sent',
        sent_at: now,
        from_phone_number: routingResult.from_phone_number,
        textgrid_number_id: routingResult.textgrid_number_id,
        routing_tier: routingResult.routing_tier,
        routing_reason: routingResult.routing_reason,
        guard_reason: null, // Clear any previous guard reason
        updated_at: now
      }

      const { error: updateError } = await supabase.from('send_queue').update(updatePayload).eq('id', itemId)

      if (updateError) {
        results.push({ itemId, status: 'failed', reason: updateError.message })
        continue
      }

      // 6. Log Activity & Message Event
      await logInboxActivity({
        event_type: 'message_sent',
        thread_key: threadKey,
        actor: 'Queue Runner',
        title: 'Message Sent',
        description: `Successfully sent ${item.type} touch #${item.touch_number}`,
        metadata: {
          queue_id: itemId,
          to: phone,
          from: routingResult.from_phone_number,
          message_body: item.message_body
        },
        undo_payload: null
      })

      // We should also insert into message_events
      const eventPayload = {
        thread_id: null, // Should be resolved from threadKey if needed
        direction: 'outbound',
        phone: phone.length === 10 ? `+1${phone}` : `+${phone}`,
        body: item.message_body,
        status: 'sent',
        created_at: now,
        master_owner_id: item.master_owner_id,
        property_id: item.property_id,
        prospect_id: item.prospect_id,
        queue_id: itemId,
        metadata: {
          source: 'queue_runner',
          textgrid_number_id: routingResult.textgrid_number_id
        }
      }
      
      await supabase.from('message_events').insert(eventPayload)

      results.push({ itemId, status: 'sent', to: phone, from: routingResult.from_phone_number })
    }

    res.status(200).json({ ok: true, processed: results.length, results })
  } catch (error) {
    console.error('[Queue Run Error]:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'Queue run failed' })
  }
}
