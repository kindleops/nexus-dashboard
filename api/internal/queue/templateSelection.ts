import { getSupabaseClient } from '../../../src/lib/supabaseClient'

export interface SelectedTemplate {
  template_id: string
  template_text: string
  score: number
  recommendation: string
  bucket: string
  reason: string
  language?: string
  paired_with_agent_type?: string
}

const SAFE_AUTOPILOT = true; // Safety switch

/**
 * Weighted Template Selection for Ownership Check
 * 
 * SCALE: 65%
 * TESTING: 25%
 * LOW_DATA: 10%
 * RISKY/PAUSE: 0%
 */
export async function selectWeightedTemplate(params: {
  market?: string,
  language?: string,
  assetClass?: string
}): Promise<SelectedTemplate | null> {
  const supabase = getSupabaseClient()
  
  const reqLang = params.language || 'English'

  // TODO(Analytics): Do not count safety_hold/manual_cancel/data_hygiene as copy failures in future template scoring.
  // We need to update the `get_ownership_check_template_stats_v2` RPC or create a new adjusted metrics view
  // to filter out taxonomy metadata where `is_true_delivery_failure` is false.

  // 1. Fetch active rotation control (Source of Truth)
  const { data: controls, error: controlError } = await supabase
    .from('v_ownership_template_rotation_control')
    .select('*')
    .in('rotation_status', ['scale', 'testing'])
    .gt('traffic_weight', 0)

  if (controlError || !controls || controls.length === 0) {
    console.warn('[TemplateSelection] No active rotation controls found or error:', controlError)
    return null
  }

  // 2. Fetch template texts from sms_templates
  const templateIds = controls.map((c: any) => c.template_id)
  const { data: templates, error: tempError } = await supabase
    .from('sms_templates')
    .select('template_id, podio_template_id, template_body, template_name, agent_persona, language')
    .or(`template_id.in.(${templateIds.join(',')}),podio_template_id.in.(${templateIds.join(',')})`)

  if (tempError || !templates || templates.length === 0) {
    console.warn('[TemplateSelection] No templates found matching control ids:', tempError)
    return null
  }

  const templateMap = new Map(templates.map((t: any) => [t.template_id || t.podio_template_id, t]))

  // 3. Optional: fetch performance stats to decorate if available
  let { data: stats } = await supabase.rpc('get_ownership_check_template_stats_v2', {
    p_market: params.market || null,
    p_language: reqLang,
    p_min_sent: 0
  })
  const statsMap = new Map((stats || []).map((s: any) => [s.template_id, s]))

  // 4. Build eligible pool
  const eligible = controls.map((control: any) => {
    const tId = control.template_id
    const templateRow = templateMap.get(tId)
    if (!templateRow) return null

    if ((control.language || templateRow.language || 'English') !== reqLang) return null
    
    const assetScope = control.asset_scope || 'all'
    if (assetScope !== 'all' && assetScope !== params.assetClass) return null

    if (tId === '213857' && params.assetClass !== 'multifamily' && params.assetClass !== 'apartment') {
      return null
    }

    const stat = statsMap.get(tId)

    return {
      template_id: tId,
      template_text: templateRow.template_body,
      template_name: templateRow.template_name,
      agent_persona: templateRow.agent_persona,
      language: control.language || templateRow.language || 'English',
      traffic_weight: control.traffic_weight,
      rotation_status: control.rotation_status,
      // If stats exist use them, else default to TESTING/0
      recommendation: stat ? stat.recommendation : 'TESTING',
      overall_template_score: stat ? stat.overall_template_score : 0,
      bucket: stat ? stat.recommendation : 'CONTROL_TABLE_TESTING'
    }
  }).filter(Boolean)

  if (eligible.length === 0) {
    console.warn('[TemplateSelection] No eligible templates found after filters')
    return null
  }

  // 5. Group by bucket (using recommendation or control table testing)
  const buckets = {
    SCALE: eligible.filter((s: any) => s.bucket === 'SCALE'),
    TESTING: eligible.filter((s: any) => s.bucket === 'TESTING' || s.bucket === 'CONTROL_TABLE_TESTING'),
    LOW_DATA: eligible.filter((s: any) => s.bucket === 'LOW_DATA'),
  }

  // 6. Selection logic
  const roll = Math.random() * 100
  let selectedBucket: string = ''
  let pool: any[] = []

  if (roll < 65 && buckets.SCALE.length > 0) {
    selectedBucket = 'SCALE'
    pool = buckets.SCALE
  } else if (roll < 90 && buckets.TESTING.length > 0) {
    selectedBucket = 'TESTING'
    pool = buckets.TESTING
  } else if (buckets.LOW_DATA.length > 0) {
    selectedBucket = 'LOW_DATA'
    pool = buckets.LOW_DATA
  } else {
    pool = eligible.filter((s: any) => s.bucket !== 'RISKY' && s.bucket !== 'PAUSE')
    selectedBucket = pool.length > 0 ? 'FALLBACK_CONTROLLED' : ''
  }

  if (pool.length === 0) {
    console.error('[TemplateSelection] No safe templates available in any bucket.')
    return null
  }

  // 7. Randomly select from the chosen pool using traffic_weight
  const totalWeight = pool.reduce((sum, item) => sum + (item.traffic_weight || 1), 0)
  let weightRoll = Math.random() * totalWeight
  let template = pool[pool.length - 1]
  for (const item of pool) {
    weightRoll -= (item.traffic_weight || 1)
    if (weightRoll <= 0) {
      template = item
      break
    }
  }

  return {
    template_id: template.template_id,
    template_text: template.template_text,
    score: Number(template.overall_template_score ?? 0),
    recommendation: template.recommendation,
    bucket: selectedBucket,
    reason: `Selected via ${selectedBucket} bucket (roll: ${roll.toFixed(1)}) weight: ${template.traffic_weight}`,
    language: template.language || 'English',
    paired_with_agent_type: template.agent_persona
  }
}
