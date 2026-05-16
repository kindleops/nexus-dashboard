import { getSupabaseClient } from '../../../src/lib/supabaseClient'
import { checkSuppression, generateDedupeKey, scheduleWithWindow, checkExistingQueue, renderMessage, checkRepeatContactAndBlacklist } from './utils'
import { asString, normalizeStatus, asNumber } from '../../../src/lib/data/shared'
import { selectWeightedTemplate } from './templateSelection'

type ApiRequest = {
  method?: string
  body?: any
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: any) => void
}

function normalizeOutboundLanguage(raw: string): string {
  if (!raw) return 'English'
  const lower = raw.toLowerCase().trim()
  if (lower === 'english' || lower === 'en') return 'English'
  if (lower === 'spanish' || lower === 'es') return 'Spanish'
  return 'English'
}

function normalizeAssetClass(contact: any): string {
  const unitsCount = asNumber(contact.units_count) || 0
  if (unitsCount >= 5) return 'apartment'
  if (unitsCount >= 2 && unitsCount <= 4) return 'multifamily'

  const propType = asString(contact.property_type || '').toLowerCase()
  if (propType.includes('apartment')) return 'apartment'
  if (propType.includes('multi') || propType.includes('duplex') || propType.includes('triplex') || propType.includes('fourplex')) {
    return 'multifamily'
  }
  
  return 'single_family'
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabase = getSupabaseClient()
  const results: any[] = []

  try {
    const dryRun = req.body?.dry_run !== false && req.body?.apply !== true
    const apply = req.body?.apply === true && req.body?.dry_run === false
    const limit = Math.min(100, Number(req.body?.limit || 50))

    // 1. Check available columns to safely add filters
    const { data: colsCheck } = await supabase.from('v_sms_ready_contacts').select('*').limit(1)
    const availableCols = colsCheck && colsCheck[0] ? Object.keys(colsCheck[0]) : []

    let query = supabase.from('v_sms_ready_contacts').select('*').eq('sms_eligible', true)

    if (availableCols.includes('last_outbound_at')) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      query = query.or(`last_outbound_at.is.null,last_outbound_at.lt.${thirtyDaysAgo}`)
    }
    if (availableCols.includes('touch_number')) {
      query = query.or(`touch_number.is.null,touch_number.eq.0`)
    }
    if (availableCols.includes('current_stage')) {
      query = query.or(`current_stage.is.null,current_stage.eq.new`)
    }
    if (availableCols.includes('contact_status')) {
      query = query.not('contact_status', 'in', ['opted_out', 'dnc', 'wrong_number', 'suppressed'])
    }

    if (availableCols.includes('last_outbound_at')) {
      query = query.order('last_outbound_at', { ascending: true, nullsFirst: true })
    } else if (availableCols.includes('priority_tier')) {
      // Default to priority ordering if no last_outbound_at
      query = query.order('priority_tier', { ascending: true, nullsFirst: true })
    }

    // Fetch more than limit to allow for in-batch deduplication
    const fetchLimit = limit * 3
    const { data: contacts, error: fetchError } = await query.limit(fetchLimit)

    if (fetchError) throw fetchError

    const seenProspects = new Set<string>()
    const seenPhones = new Set<string>()
    const seenCombos = new Set<string>()

    let processedCount = 0

    for (const contact of (contacts || [])) {
      if (processedCount >= limit) break

      const phone = asString(contact.canonical_e164 || contact.phone || '')
      const prospectId = asString(contact.canonical_prospect_id || contact.prospect_id || '')
      const propertyId = asString(contact.property_id || '')
      const market = asString(contact.market || '')
      const threadKey = `new:${prospectId}:${propertyId}`
      const comboKey = `${propertyId}:${prospectId}`

      // Spread candidate selection / avoid hammering in the same batch
      if (seenProspects.has(prospectId) || seenPhones.has(phone) || seenCombos.has(comboKey)) {
        continue
      }
      
      const rawLanguage = asString(contact.language || '').trim()
      const language = normalizeOutboundLanguage(rawLanguage)
      const assetClass = normalizeAssetClass(contact)

      // 2. Weighted Template Selection
      let selected = await selectWeightedTemplate({
        market,
        language,
        assetClass
      })

      if (!selected) {
        results.push({ prospectId, status: 'blocked', reason: 'No suitable ownership_check template found' })
        continue
      }
      
      seenProspects.add(prospectId)
      seenPhones.add(phone)
      seenCombos.add(comboKey)
      processedCount++

      const requiresCity = selected.template_text.includes('{{city}}') && !contact.property_city;
      const requiresZip = selected.template_text.includes('{{zip}}') && !contact.property_zip;
      const requiresCounty = selected.template_text.includes('{{county}}') && !contact.property_county;
      const unsupportedLang = selected.language && selected.language !== language;

      if (requiresCity || requiresZip || requiresCounty || unsupportedLang) {
        selected = {
          template_id: 'fallback-safe',
          template_text: 'Hi {{seller_first_name}}, this is {{agent_name}}. Do you still own {{property_address}}?',
          score: 1,
          recommendation: 'SAFE_FALLBACK',
          bucket: 'FALLBACK',
          reason: 'Fallback triggered due to missing vars or unsupported language',
          language: language
        }
      }

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

      // 3.5 Repeat Contact and Blacklist Gate
      const repeatCheck = await checkRepeatContactAndBlacklist({
        phone,
        prospectId,
        masterOwnerId: contact.master_owner_id,
        stageCode: 'ownership_check'
      })

      if (!repeatCheck.safe) {
        results.push({ prospectId, status: 'blocked', reason: repeatCheck.reason })
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
        market,
        agent_name: 'Nexus',
        city: asString(contact.property_city || ''),
        zip: asString(contact.property_zip || ''),
        county: asString(contact.property_county || '')
      }
      
      // Creating a mock template object for rendering
      const mockTemplate = { templateText: selected.template_text } as any
      const rendered = renderMessage(mockTemplate, context)
      
      if (!rendered.ok) {
        results.push({ prospectId, status: 'blocked', reason: rendered.reason })
        continue
      }

      // 6. Scheduling
      const scheduledAt = scheduleWithWindow(new Date(), contact.timezone || 'America/Chicago')

      // 7. Queue the Outbound with selection metadata
      const payload = {
        queue_key: `outbound:${prospectId}:${Date.now()}`,
        dedupe_key: dedupeKey,
        queue_status: 'scheduled',
        to_phone_number: phone,
        from_phone_number: null,
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
        // Metadata for observability
        selected_template_score: selected.score,
        selected_template_recommendation: selected.recommendation,
        template_selection_reason: selected.reason,
        template_selection_bucket: selected.bucket,
        metadata: {
          template_id: selected.template_id,
          source: 'weighted_outbound_builder',
          selection_score: selected.score,
          selection_bucket: selected.bucket
        }
      }

      if (dryRun) {
        results.push({
          prospectId,
          status: 'would_queue',
          dedupeKey,
          template_id: selected.template_id,
          scheduledAt: scheduledAt.toISOString(),
          preview: rendered.text
        })
      } else if (apply) {
        const { error: insertError } = await supabase.from('send_queue').insert(payload)
        if (insertError) {
          results.push({ prospectId, status: 'failed', reason: insertError.message })
        } else {
          results.push({ prospectId, status: 'queued', dedupeKey, template_id: selected.template_id })
        }
      }
    }

    res.status(200).json({ ok: true, processed: results.length, results })
  } catch (error) {
    console.error('[Build Outbound Error]:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build outbound' })
  }
}

