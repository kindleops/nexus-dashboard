import { getSupabaseClient } from '../../../src/lib/supabaseClient'
import { checkSuppression, generateDedupeKey, scheduleWithWindow, checkExistingQueue, renderMessage } from './utils'
import { asString, normalizeStatus, asNumber } from '../../../src/lib/data/shared'
import { fetchSmsTemplates } from '../../../src/lib/data/templateData'

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

  try {
    // 1. Find candidates for first touch
    const { data: contacts, error: fetchError } = await supabase
      .from('v_sms_ready_contacts')
      .select('*')
      .eq('sms_eligible', true)
      .limit(50)

    if (fetchError) throw fetchError

    // 2. Fetch templates for first touch
    const templates = await fetchSmsTemplates({ useCase: 'ownership_check', limit: 10 })
    const template = templates.find(t => t.active) || templates[0]

    if (!template) {
      res.status(500).json({ error: 'No active first-touch template found' })
      return
    }

    for (const contact of (contacts || [])) {
      const phone = asString(contact.canonical_e164 || contact.phone || '')
      const prospectId = asString(contact.canonical_prospect_id || contact.prospect_id || '')
      const propertyId = asString(contact.property_id || '')
      const threadKey = `new:${prospectId}:${propertyId}`

      // 3. Suppression Gate
      const suppression = await checkSuppression({
        phone,
        masterOwnerId: contact.master_owner_id,
        prospectId
      })

      if (suppression.blocked) {
        results.push({ prospectId, status: 'blocked', reason: suppression.reason })
        continue
      }

      // 4. Dedupe Check
      const dedupeKey = generateDedupeKey({
        threadKey,
        phone,
        queueType: 'first_touch',
        stageCode: 'ownership_check',
        touchNumber: 1
      })

      if (await checkExistingQueue(dedupeKey)) {
        results.push({ prospectId, status: 'skipped', reason: 'Duplicate already exists' })
        continue
      }

      // 5. Message Rendering
      const context = {
        seller_first_name: asString(contact.prospect_first_name || contact.display_name?.split(' ')[0] || 'there'),
        property_address: asString(contact.property_address_full || ''),
        market: asString(contact.market || ''),
        agent_name: 'Nexus'
      }
      const rendered = renderMessage(template, context)
      
      if (!rendered.ok) {
        results.push({ prospectId, status: 'blocked', reason: rendered.reason })
        continue
      }

      // 6. Scheduling
      const scheduledAt = scheduleWithWindow(new Date(), contact.timezone || 'America/Chicago')

      // 7. Queue the Outbound
      const payload = {
        queue_key: `outbound:${prospectId}:${Date.now()}`,
        dedupe_key: dedupeKey,
        queue_status: 'scheduled',
        to_phone_number: phone,
        from_phone_number: null, // Runner will resolve this via textgridRouting
        message_body: rendered.text,
        message_text: rendered.text,
        scheduled_for: scheduledAt.toISOString(),
        scheduled_for_utc: scheduledAt.toISOString(),
        send_priority: 5,
        type: 'first_touch',
        current_stage: 'ownership_check',
        touch_number: 1,
        master_owner_id: contact.master_owner_id,
        property_id: contact.property_id,
        prospect_id: prospectId,
        market: contact.market,
        property_address_state: asString(contact.property_address_state || ''),
        metadata: {
          template_id: template.id,
          source: 'outbound_builder'
        }
      }

      const { error: insertError } = await supabase.from('send_queue').insert(payload)
      if (insertError) {
        results.push({ prospectId, status: 'failed', reason: insertError.message })
      } else {
        results.push({ prospectId, status: 'queued', dedupeKey, scheduledAt: scheduledAt.toISOString() })
      }
    }

    res.status(200).json({ ok: true, processed: results.length, results })
  } catch (error) {
    console.error('[Build Outbound Error]:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build outbound' })
  }
}
