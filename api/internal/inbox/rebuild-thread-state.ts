import { getSupabaseClient } from '../../../src/lib/supabaseClient'

type ApiRequest = {
  method?: string
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
}

const parsePayload = (body: unknown): any => {
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return {}
    }
  }
  if (typeof body === 'object') {
    return body
  }
  return {}
}

function processThread(threadKey: string, events: any[], queue: any[], suppressionData?: any) {
  // Sort events oldest to newest
  events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  
  let latestInbound = null
  let latestOutbound = null
  let latestMessage = null
  let latestIntent = null
  let latestStageAfter = null
  
  let hasOptOut = false
  let hasHostile = false
  let hasNotInterested = false
  let positiveSignalAfterNotInterested = false
  let unreadInboundCount = 0
  
  let maxPositiveLevel = 0 // 0=none, 1=warm, 2=hot, 3=very_hot
  let latestPositiveLevel = 0

  for (const ev of events) {
    latestMessage = ev
    if (ev.direction === 'inbound') {
      latestInbound = ev
      if (!ev.is_read) unreadInboundCount++
      
      const intent = ev.detected_intent
      if (intent) latestIntent = intent
      if (ev.stage_after) latestStageAfter = ev.stage_after

      if (ev.is_opt_out || ev.safety_status === 'suppressed' || intent === 'opt_out' || intent === 'wrong_number' || intent === 'legal_threat') {
        hasOptOut = true
      }
      if (intent === 'hostile' || intent === 'hostile_or_legal' || intent === 'legal_threat') {
        hasHostile = true
      }

      if (intent === 'not_interested' || intent === 'no') {
        hasNotInterested = true
        positiveSignalAfterNotInterested = false
      } else if (['ownership_confirmed', 'asks_offer', 'asking_price_provided', 'needs_call', 'seller_interested', 'price_given', 'yes', 'condition_details_provided'].includes(intent)) {
        if (hasNotInterested) positiveSignalAfterNotInterested = true
        
        let level = 1
        if (['ownership_confirmed', 'seller_interested', 'yes'].includes(intent)) level = 2
        if (['asks_offer', 'asking_price_provided', 'needs_call', 'price_given'].includes(intent)) level = 3
        
        latestPositiveLevel = level
        if (level > maxPositiveLevel) maxPositiveLevel = level
      } else if (intent === 'unclear' || intent === 'unknown' || intent === 'ambiguous') {
        if (maxPositiveLevel < 1) maxPositiveLevel = 1
      }
    } else {
      latestOutbound = ev
      if (new Date(ev.created_at) > new Date(latestInbound?.created_at || 0)) {
        unreadInboundCount = 0 
      }
    }
  }

  // Suppression from external data (e.g., prospects table)
  if (suppressionData?.is_opt_out || suppressionData?.is_dnc || suppressionData?.do_not_contact) {
    hasOptOut = true
  }

  // Queue events
  const pendingQueue = queue.filter(q => ['pending', 'scheduled', 'queued'].includes(q.status))
  const failedQueue = queue.filter(q => ['failed', 'blocked'].includes(q.status))

  // Base State Rules
  let status = 'active'
  let bucket = 'automated'
  let stage = latestStageAfter || 'ownership_check'
  let temperature = 'warm'
  let autoStatus = 'auto_eligible'
  let nextAction = 'No action'
  
  const isSuppressed = hasOptOut || hasHostile

  // Advanced Stage Mapping based on intent overrides (Ownership confirmed shouldn't stay in ownership_check if higher intent exists)
  if (maxPositiveLevel === 3 && stage === 'ownership_check') {
    stage = 'price_discovery'
  } else if (maxPositiveLevel === 2 && stage === 'ownership_check' && latestIntent === 'seller_interested') {
    stage = 'interest_probe'
  }

  if (isSuppressed) {
    status = 'suppressed'
    bucket = 'suppressed'
    temperature = 'suppressed'
    stage = 'dead'
    autoStatus = 'suppressed'
    nextAction = 'Suppressed — do not contact'
  } else if (hasNotInterested && !positiveSignalAfterNotInterested) {
    status = 'dead'
    bucket = 'dead'
    temperature = 'cold'
    stage = 'dead'
    autoStatus = 'paused'
    nextAction = 'No action'
  } else {
    // Temperature Mapping
    if (maxPositiveLevel === 3) temperature = 'very_hot'
    else if (maxPositiveLevel === 2) temperature = 'hot'
    else if (maxPositiveLevel === 1) temperature = 'warm'
    else temperature = 'cold'

    // Canonical Status & Bucket Mapping
    if (latestInbound && ['hostile', 'ambiguous', 'legal_threat'].includes(latestInbound.detected_intent) && !hasOptOut && unreadInboundCount > 0) {
      status = 'needs_review'
      bucket = 'needs_review'
      autoStatus = 'manual_review'
      nextAction = 'Review inbound and reply'
    } else if (latestMessage?.direction === 'inbound' && unreadInboundCount > 0) {
      status = 'new_reply'
      bucket = maxPositiveLevel >= 2 ? 'priority' : 'new_replies'
      autoStatus = 'manual_review'
      nextAction = 'Review inbound and reply'
    } else if (latestMessage?.direction === 'outbound' && pendingQueue.length === 0) {
      status = 'waiting'
      bucket = 'waiting_on_seller'
      autoStatus = 'waiting'
      nextAction = 'Waiting on seller'
    } else if (pendingQueue.length > 0) {
      status = 'queued'
      bucket = 'automated'
      autoStatus = 'auto_eligible'
      nextAction = 'Send follow-up'
    } else {
      status = 'autopilot'
      bucket = 'automated'
      autoStatus = 'auto_eligible'
      nextAction = 'Automated'
    }
  }

  // Safety override for bucket logic
  if (status === 'active' || status === 'autopilot') {
    if (pendingQueue.length === 0 && unreadInboundCount === 0 && latestMessage?.direction !== 'outbound') {
       // if it's somehow floating with no action, put it in needs_review to not lose it
       bucket = 'needs_review'
       status = 'needs_review'
       autoStatus = 'manual_review'
       nextAction = 'Review inbound and reply'
    }
  }

  return {
    status,
    stage,
    bucket,
    temperature,
    automationStatus: autoStatus,
    nextAction,
    latestIntent,
    isSuppressed,
    pendingCount: pendingQueue.length,
    failedCount: failedQueue.length
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getSupabaseClient()
  const payload = parsePayload(req.body)
  
  const apply = payload.apply === true
  const dry_run = payload.dry_run !== false && !apply // default true unless apply=true
  const isDryRun = dry_run
  const only_inconsistent = payload.only_inconsistent !== false // default true
  const include_suppressed = payload.include_suppressed === true
  const limit = typeof payload.limit === 'number' ? payload.limit : 1000
  const start_date = payload.start_date
  const end_date = payload.end_date
  const thread_key = payload.thread_key

  let query = supabase.from('message_events').select('thread_key').order('created_at', { ascending: false })
  
  if (thread_key) {
    query = query.eq('thread_key', thread_key)
  } else {
    if (start_date) query = query.gte('created_at', start_date)
    if (end_date) query = query.lte('created_at', end_date)
  }

  const { data: threadKeyRows, error: keyError } = await query.limit(limit * 5)
  if (keyError || !threadKeyRows) {
    return res.status(500).json({ error: keyError?.message || 'Failed to fetch thread keys' })
  }

  let uniqueKeys = Array.from(new Set(threadKeyRows.map(r => r.thread_key))).filter(Boolean)
  if (limit && uniqueKeys.length > limit) {
    uniqueKeys = uniqueKeys.slice(0, limit)
  }

  const results = {
    inspected_threads: uniqueKeys.length,
    updated_threads: 0,
    skipped_threads: 0,
    bucket_changes: 0,
    status_changes: 0,
    stage_changes: 0,
    temperature_changes: 0,
    automation_changes: 0,
    examples: [] as any[],
    errors: [] as any[]
  }

  for (const tk of uniqueKeys) {
    const { data: events } = await supabase.from('message_events').select('*').eq('thread_key', tk)
    const { data: queue } = await supabase.from('send_queue').select('*').eq('thread_key', tk)
    const { data: stateRows } = await supabase.from('inbox_thread_state').select('*').eq('thread_key', tk).limit(1)
    
    if (!events || events.length === 0) continue

    const state = stateRows?.[0]
    
    // Check prospect suppression
    let suppressionData = null
    const firstEv = events[0]
    if (firstEv?.prospect_id) {
       const { data: prospects } = await supabase.from('prospects').select('is_opt_out, is_dnc, do_not_contact').eq('id', firstEv.prospect_id).limit(1)
       if (prospects?.[0]) suppressionData = prospects[0]
    }

    if (!include_suppressed && state?.is_suppressed) {
      results.skipped_threads++
      continue
    }

    const computed = processThread(tk, events, queue || [], suppressionData)
    
    const existingMetadata = state?.metadata || {}
    const existingBucket = existingMetadata.inbox_bucket || existingMetadata.bucket
    const existingTemp = existingMetadata.temperature

    const isDifferent = 
      state?.status !== computed.status || 
      state?.stage !== computed.stage || 
      state?.automation_status !== computed.automationStatus ||
      state?.next_action !== computed.nextAction ||
      existingBucket !== computed.bucket ||
      existingTemp !== computed.temperature ||
      state?.pending_queue_count !== computed.pendingCount ||
      state?.failed_queue_count !== computed.failedCount ||
      state?.last_intent !== computed.latestIntent ||
      state?.is_suppressed !== computed.isSuppressed

    if (only_inconsistent && !isDifferent && state) {
      results.skipped_threads++
      continue
    }

    const updates: any = {
      thread_key: tk,
      status: computed.status,
      stage: computed.stage,
      last_intent: computed.latestIntent,
      is_suppressed: computed.isSuppressed,
      automation_status: computed.automationStatus,
      next_action: computed.nextAction,
      pending_queue_count: computed.pendingCount,
      failed_queue_count: computed.failedCount,
      metadata: {
        ...existingMetadata,
        inbox_bucket: computed.bucket,
        temperature: computed.temperature
      }
    }
    
    // Default properties for new state records
    if (!state) {
      updates.seller_phone = firstEv.seller_phone || ''
      updates.canonical_e164 = firstEv.canonical_e164 || ''
      updates.our_number = firstEv.our_number || ''
      updates.master_owner_id = firstEv.master_owner_id
      updates.prospect_id = firstEv.prospect_id
      updates.property_id = firstEv.property_id
    }

    if (isDifferent || !state) {
      if (state?.status !== computed.status) results.status_changes++
      if (state?.stage !== computed.stage) results.stage_changes++
      if (existingBucket !== computed.bucket) results.bucket_changes++
      if (existingTemp !== computed.temperature) results.temperature_changes++
      if (state?.automation_status !== computed.automationStatus) results.automation_changes++

      results.updated_threads++
      if (results.examples.length < 25) {
        results.examples.push({
          thread_key: tk,
          old_status: state?.status,
          new_status: computed.status,
          old_bucket: existingBucket,
          new_bucket: computed.bucket,
          old_stage: state?.stage,
          new_stage: computed.stage,
          temperature: computed.temperature
        })
      }

      if (!isDryRun) {
        let err
        if (state) {
          const res = await supabase.from('inbox_thread_state').update(updates).eq('id', state.id)
          err = res.error
        } else {
          const res = await supabase.from('inbox_thread_state').insert(updates)
          err = res.error
        }
        if (err) results.errors.push(`Thread ${tk}: ${err.message}`)
      }
    } else {
      results.skipped_threads++
    }
  }

  res.status(200).json(results)
}
