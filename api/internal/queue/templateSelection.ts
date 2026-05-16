import { getSupabaseClient } from '../../../src/lib/supabaseClient'

export interface SelectedTemplate {
  template_id: string
  template_text: string
  score: number
  recommendation: string
  bucket: string
  reason: string
  language?: string
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

  // 1. Fetch performance stats for ownership_check
  let { data: stats, error } = await supabase.rpc('get_ownership_check_template_stats_v2', {
    p_market: params.market || null,
    p_language: reqLang,
    p_min_sent: 0
  })

  if (error || !stats || stats.length === 0) {
    console.warn('[TemplateSelection] No stats found or error:', error)
    return null
  }

  // 1b. Fetch active rotation control
  const { data: controls, error: controlError } = await supabase
    .from('v_ownership_template_rotation_control')
    .select('*')
    .in('rotation_status', ['scale', 'testing'])
    .gt('traffic_weight', 0)

  if (controlError || !controls || controls.length === 0) {
    console.warn('[TemplateSelection] No active rotation controls found or error:', controlError)
    return null
  }

  const controlMap = new Map(controls.map((c: any) => [c.template_id, c]))

  // Ensure strict language filtering and rotation control check before bucketing
  stats = stats.filter((s: any) => {
    const control = controlMap.get(s.template_id)
    if (!control) return false

    if ((control.language || 'English') !== reqLang) return false
    
    const assetScope = control.asset_scope || 'all'
    if (assetScope !== 'all' && assetScope !== params.assetClass) return false

    if (s.template_id === '213857' && params.assetClass !== 'multifamily' && params.assetClass !== 'apartment') {
      return false
    }

    s.traffic_weight = control.traffic_weight
    return true
  })

  if (stats.length === 0) {
    console.warn('[TemplateSelection] No stats found after language and rotation control filter')
    return null
  }

  // 2. Group by recommendation bucket
  const buckets = {
    SCALE: stats.filter((s: any) => s.recommendation === 'SCALE'),
    TESTING: stats.filter((s: any) => s.recommendation === 'TESTING'),
    LOW_DATA: stats.filter((s: any) => s.recommendation === 'LOW_DATA'),
  }

  // 3. Selection logic
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
    // Fallback: Pick from whatever is available that isn't RISKY or PAUSE
    pool = stats.filter((s: any) => s.recommendation !== 'RISKY' && s.recommendation !== 'PAUSE')
    selectedBucket = pool.length > 0 ? 'FALLBACK' : ''
  }

  if (pool.length === 0) {
    console.error('[TemplateSelection] No safe templates available in any bucket.')
    return null
  }

  // 4. Randomly select from the chosen pool using traffic_weight
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
    language: template.language || 'English'
  }
}
