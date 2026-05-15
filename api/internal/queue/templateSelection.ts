import { getSupabaseClient } from '../../../src/lib/supabaseClient'

export interface SelectedTemplate {
  template_id: string
  template_text: string
  score: number
  recommendation: string
  bucket: string
  reason: string
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
  language?: string
}): Promise<SelectedTemplate | null> {
  const supabase = getSupabaseClient()
  
  // 1. Fetch performance stats for ownership_check
  const { data: stats, error } = await supabase.rpc('get_ownership_check_template_stats_v2', {
    p_market: params.market || null,
    p_language: params.language || 'English'
  })

  if (error || !stats || stats.length === 0) {
    console.warn('[TemplateSelection] No stats found or error:', error)
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

  // 4. Randomly select from the chosen pool (to prevent one template from dominating)
  const template = pool[Math.floor(Math.random() * pool.length)]

  return {
    template_id: template.template_id,
    template_text: template.template_text,
    score: template.overall_score,
    recommendation: template.recommendation,
    bucket: selectedBucket,
    reason: `Selected via ${selectedBucket} bucket (roll: ${roll.toFixed(1)})`
  }
}
