import { getSupabaseClient } from '../../../src/lib/supabaseClient'
import { checkSuppression, hydrateQueueRoutingContext, classifyQueueFailureReason } from './utils'
import { asString } from '../../../src/lib/data/shared'
import { resolveOutboundTextgridNumber } from '../../../src/lib/data/textgridRouting'
import { logInboxActivity } from '../../../src/lib/data/inboxActivityData'

export interface QueueRunCaps {
  sends_per_run: number
  auto_replies_per_run: number
  followups_per_run: number
  first_touches_per_run: number
  max_per_number_per_day: number
  max_per_market_per_hour: number
}

export interface QueueRunSummary {
  inspected: number
  sent: number
  blocked: number
  failed: number
  routing_blocked: number
  suppression_blocked: number
  duplicate_skipped: number
  replied_before_send: number
}

export const DEFAULT_SAFE_CAPS: QueueRunCaps = {
  sends_per_run: 10,
  auto_replies_per_run: 10,
  followups_per_run: 25,
  first_touches_per_run: 25,
  max_per_number_per_day: 40,
  max_per_market_per_hour: 75,
}

export const DEFAULT_LIVE_CAPS: QueueRunCaps = {
  sends_per_run: 50,
  auto_replies_per_run: 50,
  followups_per_run: 100,
  first_touches_per_run: 100,
  max_per_number_per_day: 150,
  max_per_market_per_hour: 250,
}

const toE164 = (value: string): string => {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.startsWith('1')) return `+${digits}`
  return digits ? `+${digits}` : ''
}

export const runQueueBatch = async (caps: Partial<QueueRunCaps> = {}): Promise<{ ok: true; summary: QueueRunSummary; results: any[] }> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  const resolvedCaps: QueueRunCaps = {
    ...DEFAULT_LIVE_CAPS,
    ...caps,
  }
  const results: any[] = []
  const summary: QueueRunSummary = {
    inspected: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    routing_blocked: 0,
    suppression_blocked: 0,
    duplicate_skipped: 0,
    replied_before_send: 0,
  }

  const { data: queueItems, error: fetchError } = await supabase
    .from('send_queue')
    .select('*')
    .in('queue_status', ['queued', 'scheduled'])
    .lte('scheduled_for_utc', now)
    .order('scheduled_for_utc', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(Math.max(resolvedCaps.sends_per_run * 4, resolvedCaps.sends_per_run))

  if (fetchError) throw fetchError

  const sentPerNumber = new Map<string, number>()
  const sentPerMarket = new Map<string, number>()

    const updateWithTaxonomy = async (itemId: string, payload: any, currentMeta: any) => {
      if (['blocked', 'cancelled', 'paused_invalid_queue_row', 'failed'].includes(payload.queue_status)) {
        const tax = classifyQueueFailureReason({ ...payload, metadata: { ...currentMeta, ...(payload.metadata || {}) } })
        payload.metadata = {
          ...currentMeta,
          ...(payload.metadata || {}),
          failure_category: tax.category,
          failure_reason_normalized: tax.reason_normalized,
          failure_is_true_delivery_failure: tax.is_true_delivery_failure,
          failure_is_data_hygiene: tax.is_data_hygiene,
          failure_is_repeat_contact_risk: tax.is_repeat_contact_risk
        }
      }
      return supabase.from('send_queue').update(payload).eq('id', itemId)
    }


  for (const item of queueItems || []) {
    if (summary.sent >= resolvedCaps.sends_per_run) break
    summary.inspected++

    const itemId = item.id
    const threadKey = asString(item.thread_key)
    const phone = asString(item.to_phone_number)
    const phoneE164 = toE164(phone)
    const queueCreatedAt = asString(item.created_at)
    const body = asString(item.message_body || item.message_text, '').trim()
    const dedupeKey = asString(item.dedupe_key)
    const hydrated = await hydrateQueueRoutingContext(item)
    const market = asString(hydrated.market || item.market || item.market_id, 'unknown')
    const currentMetadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata
      : {}

    if (!body) {
      await updateWithTaxonomy(itemId, {
        queue_status: 'blocked',
        blocked_reason: 'blank_message_body',
        updated_at: now,
      }, currentMetadata)
      summary.blocked++
      results.push({ itemId, status: 'blocked', reason: 'blank_message_body' })
      continue
    }

    if (dedupeKey) {
      const { count: duplicateCount } = await supabase
        .from('send_queue')
        .select('id', { count: 'exact', head: true })
        .eq('dedupe_key', dedupeKey)
        .in('queue_status', ['queued', 'scheduled', 'sending'])

      if ((duplicateCount ?? 0) > 1) {
        await updateWithTaxonomy(itemId, {
          queue_status: 'blocked',
          blocked_reason: 'duplicate_dedupe_key',
          updated_at: now,
        }, currentMetadata)
        summary.blocked++
        summary.duplicate_skipped++
        results.push({ itemId, status: 'blocked', reason: 'duplicate_dedupe_key' })
        continue
      }
    }

    if (phoneE164) {
      const existingCount = sentPerNumber.get(phoneE164) ?? (
        (await supabase
          .from('send_queue')
          .select('id', { count: 'exact', head: true })
          .eq('queue_status', 'sent')
          .eq('to_phone_number', phoneE164)
          .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        ).count ?? 0
      )
      if (existingCount >= resolvedCaps.max_per_number_per_day) {
        await updateWithTaxonomy(itemId, {
          queue_status: 'blocked',
          blocked_reason: 'max_per_number_per_day',
          updated_at: now,
        }, currentMetadata)
        summary.blocked++
        results.push({ itemId, status: 'blocked', reason: 'max_per_number_per_day' })
        continue
      }
      sentPerNumber.set(phoneE164, existingCount)
    }

    const existingMarketCount = sentPerMarket.get(market) ?? (
      (await supabase
        .from('send_queue')
        .select('id', { count: 'exact', head: true })
        .eq('queue_status', 'sent')
        .eq('market', market)
        .gte('sent_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      ).count ?? 0
    )
    if (existingMarketCount >= resolvedCaps.max_per_market_per_hour) {
      await updateWithTaxonomy(itemId, {
        queue_status: 'blocked',
        blocked_reason: 'max_per_market_per_hour',
        updated_at: now,
      }, currentMetadata)
      summary.blocked++
      results.push({ itemId, status: 'blocked', reason: 'max_per_market_per_hour' })
      continue
    }
    sentPerMarket.set(market, existingMarketCount)

    const suppression = await checkSuppression({
      phone,
      threadKey: asString(hydrated.thread_key || threadKey),
      masterOwnerId: asString(hydrated.master_owner_id || item.master_owner_id),
      prospectId: asString(hydrated.prospect_id || item.prospect_id),
    })

    if (suppression.blocked) {
      await updateWithTaxonomy(itemId, {
        queue_status: 'blocked',
        blocked_reason: suppression.reason,
        updated_at: now,
      }, currentMetadata)
      summary.blocked++
      summary.suppression_blocked++
      results.push({ itemId, status: 'blocked', reason: suppression.reason })
      continue
    }

    const { data: recentInbound } = await supabase
      .from('message_events')
      .select('id')
      .or(`from_phone_number.eq.${phoneE164},phone.eq.${phoneE164}`)
      .eq('direction', 'inbound')
      .gt('created_at', queueCreatedAt)
      .limit(1)

    if (recentInbound && recentInbound.length > 0) {
      await updateWithTaxonomy(itemId, {
        queue_status: 'cancelled',
        paused_reason: 'replied_before_send',
        updated_at: now,
      }, currentMetadata)
      summary.blocked++
      summary.replied_before_send++
      results.push({ itemId, status: 'cancelled', reason: 'replied_before_send' })
      continue
    }

    const routingResult = await resolveOutboundTextgridNumber({
      marketId: asString(hydrated.market_id || item.market_id),
      market: asString(hydrated.market || item.market),
      ourNumber: item.from_phone_number,
      phoneNumber: phone,
      textgridNumberId: item.textgrid_number_id,
      property_address_state: asString(hydrated.property_address_state || item.property_address_state),
      propertyId: asString(hydrated.property_id || item.property_id),
      threadKey: asString(hydrated.thread_key || threadKey),
    })

    if (!routingResult.ok) {
      await updateWithTaxonomy(itemId, {
        queue_status: 'paused_invalid_queue_row',
        seller_name: asString(hydrated.seller_name || item.seller_name) || null,
        property_address: asString(hydrated.property_address || item.property_address) || null,
        property_id: asString(hydrated.property_id || item.property_id) || null,
        master_owner_id: asString(hydrated.master_owner_id || item.master_owner_id) || null,
        prospect_id: asString(hydrated.prospect_id || item.prospect_id) || null,
        market: asString(hydrated.market || item.market) || null,
        market_id: asString(hydrated.market_id || item.market_id) || null,
        property_address_state: asString(hydrated.property_address_state || item.property_address_state) || null,
        thread_key: asString(hydrated.thread_key || item.thread_key) || null,
        guard_reason: 'NO_VALID_LOCAL_TEXTGRID_NUMBER',
        failed_reason: 'Routing blocked: no sender number',
        metadata: {
          ...currentMetadata,
          seller_name: asString(hydrated.seller_name || item.seller_name) || null,
          property_address: asString(hydrated.property_address || item.property_address) || null,
          property_id: asString(hydrated.property_id || item.property_id) || null,
          market: asString(hydrated.market || item.market) || null,
          property_address_state: asString(hydrated.property_address_state || item.property_address_state) || null,
          thread_key: asString(hydrated.thread_key || item.thread_key) || null,
          route_input_state: routingResult.route_input_state || null,
          route_input_market: routingResult.route_input_market || null,
          route_input_property_id: routingResult.route_input_property_id || null,
          route_candidate_count: routingResult.route_candidate_count ?? null,
          route_rejected_reasons: routingResult.route_rejected_reasons ?? [],
        },
        updated_at: now,
      }, currentMetadata)
      summary.blocked++
      summary.routing_blocked++
      results.push({ itemId, status: 'paused_invalid_queue_row', reason: 'NO_VALID_LOCAL_TEXTGRID_NUMBER' })
      continue
    }

    const updatePayload: Record<string, unknown> = {
      queue_status: 'sent',
      sent_at: now,
      seller_name: asString(hydrated.seller_name || item.seller_name) || null,
      property_address: asString(hydrated.property_address || item.property_address) || null,
      property_id: asString(hydrated.property_id || item.property_id) || null,
      master_owner_id: asString(hydrated.master_owner_id || item.master_owner_id) || null,
      prospect_id: asString(hydrated.prospect_id || item.prospect_id) || null,
      market: asString(hydrated.market || item.market) || null,
      market_id: asString(hydrated.market_id || item.market_id) || null,
      property_address_state: asString(hydrated.property_address_state || item.property_address_state) || null,
      thread_key: asString(hydrated.thread_key || item.thread_key) || null,
      from_phone_number: routingResult.from_phone_number,
      textgrid_number_id: routingResult.textgrid_number_id,
      routing_tier: routingResult.routing_tier,
      routing_reason: routingResult.routing_reason,
      guard_reason: null,
      metadata: {
        ...currentMetadata,
        seller_name: asString(hydrated.seller_name || item.seller_name) || null,
        property_address: asString(hydrated.property_address || item.property_address) || null,
        property_id: asString(hydrated.property_id || item.property_id) || null,
        market: asString(hydrated.market || item.market) || null,
        property_address_state: asString(hydrated.property_address_state || item.property_address_state) || null,
        thread_key: asString(hydrated.thread_key || item.thread_key) || null,
        route_input_state: routingResult.route_input_state || null,
        route_input_market: routingResult.route_input_market || null,
        route_input_property_id: routingResult.route_input_property_id || null,
        route_candidate_count: routingResult.route_candidate_count ?? null,
        route_rejected_reasons: routingResult.route_rejected_reasons ?? [],
      },
      updated_at: now,
    }

    const { error: updateError } = await updateWithTaxonomy(itemId, updatePayload, currentMetadata)
    if (updateError) {
      summary.failed++
      results.push({ itemId, status: 'failed', reason: updateError.message })
      continue
    }

    await logInboxActivity({
      event_type: 'message_sent',
      thread_key: threadKey,
      actor: 'Queue Command Center',
      title: 'Message Sent',
      description: `Successfully sent ${item.type || 'queue'} touch #${item.touch_number || 1}`,
      metadata: {
        queue_id: itemId,
        to: phone,
        from: routingResult.from_phone_number,
        message_body: item.message_body,
      },
      undo_payload: null,
    })

    await supabase.from('message_events').insert({
      thread_id: null,
      direction: 'outbound',
      phone: phoneE164,
      from_phone_number: routingResult.from_phone_number,
      to_phone_number: phoneE164,
      body: item.message_body,
      status: 'sent',
      created_at: now,
      master_owner_id: item.master_owner_id,
      property_id: item.property_id,
      prospect_id: item.prospect_id,
      queue_id: itemId,
      metadata: {
        source: 'queue_command_center',
        textgrid_number_id: routingResult.textgrid_number_id,
      },
    })

    summary.sent++
    sentPerNumber.set(phoneE164, (sentPerNumber.get(phoneE164) ?? 0) + 1)
    sentPerMarket.set(market, (sentPerMarket.get(market) ?? 0) + 1)
    results.push({ itemId, status: 'sent', to: phone, from: routingResult.from_phone_number })
  }

  return { ok: true, summary, results }
}
