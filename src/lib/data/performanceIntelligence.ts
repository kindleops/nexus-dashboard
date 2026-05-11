import { useState, useEffect, useCallback } from 'react'
import { getSupabaseClient } from '../supabaseClient'

export type TimeWindow = 'today' | '24h' | '7d' | '30d' | 'all_time'

export interface TemplatePerformance {
  template_key: string
  time_window: TimeWindow
  sends: number
  delivered: number
  failed: number
  replies_attributed: number
  positive_replies: number
  opt_outs: number
  wrong_numbers: number
  avg_response_hours: number | null
  median_response_hours: number | null
  reply_rate_pct: number
  positive_rate_pct: number
  opt_out_rate_pct: number
  wrong_number_rate_pct: number
  delivery_rate_pct: number
  failure_rate_pct: number
  sample_size: number
  confidence_bucket: 'insufficient_data' | 'low_confidence' | 'medium_confidence' | 'high_confidence'
  performance_label: 'winner' | 'rising' | 'stable' | 'watch' | 'risky' | 'pause_candidate' | 'insufficient_data'
}

export interface NumberPerformance {
  textgrid_number_key: string
  time_window: TimeWindow
  sends: number
  delivered: number
  failed: number
  replies_attributed: number
  positive_replies: number
  opt_outs: number
  wrong_numbers: number
  avg_response_hours: number | null
  reply_rate_pct: number
  positive_rate_pct: number
  opt_out_rate_pct: number
  wrong_number_rate_pct: number
  delivery_rate_pct: number
  failure_rate_pct: number
  health_score: number
  health_label: 'healthy' | 'watch' | 'risky' | 'burned' | 'insufficient_data'
  market: string | null
  friendly_name: string | null
  textgrid_status: string | null
}

export interface ComboPerformance {
  template_key: string
  textgrid_number_key: string
  market: string | null
  language: string | null
  time_window: TimeWindow
  sends: number
  delivered: number
  replies: number
  positives: number
  opt_outs: number
  failure_rate_pct: number
  reply_rate_pct: number
  positive_rate_pct: number
  opt_out_rate_pct: number
  combo_label: 'high_performer' | 'high_opt_out' | 'high_failure' | 'normal'
}

export const fetchTemplatePerformance = async (window: TimeWindow = '7d'): Promise<TemplatePerformance[]> => {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('template_performance_kpis_v')
    .select('*')
    .eq('time_window', window)
    .order('sends', { ascending: false })

  if (error) throw error
  return data || []
}

export const fetchNumberPerformance = async (window: TimeWindow = '7d'): Promise<NumberPerformance[]> => {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('number_performance_kpis_v')
    .select('*')
    .eq('time_window', window)
    .order('sends', { ascending: false })

  if (error) throw error
  return data || []
}

export const fetchTemplateNumberCombos = async (window: TimeWindow = '7d'): Promise<ComboPerformance[]> => {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('template_number_combo_kpis_v')
    .select('*')
    .eq('time_window', window)
    .order('sends', { ascending: false })

  if (error) throw error
  return data || []
}

export const fetchPerformanceOutliers = async (window: TimeWindow = '7d') => {
  const templates = await fetchTemplatePerformance(window)
  const numbers = await fetchNumberPerformance(window)
  const combos = await fetchTemplateNumberCombos(window)

  return {
    bestTemplate: templates.find(t => t.performance_label === 'winner') || templates.sort((a, b) => b.positive_rate_pct - a.positive_rate_pct)[0],
    riskiestTemplate: templates.find(t => t.performance_label === 'pause_candidate' || t.performance_label === 'risky') || templates.sort((a, b) => b.opt_out_rate_pct - a.opt_out_rate_pct)[0],
    bestNumber: numbers.find(n => n.health_label === 'healthy') || numbers.sort((a, b) => b.health_score - a.health_score)[0],
    riskiestNumber: numbers.find(n => n.health_label === 'burned' || n.health_label === 'risky') || numbers.sort((a, b) => a.health_score - b.health_score)[0],
    bestCombo: combos.find(c => c.combo_label === 'high_performer') || combos.sort((a, b) => b.positive_rate_pct - a.positive_rate_pct)[0]
  }
}

export const fetchAttributionCoverage = async (window: TimeWindow = 'all_time') => {
  const supabase = getSupabaseClient()
  
  // Simple check on raw counts from the view
  const { data, error } = await supabase
    .from('message_attribution_events_v')
    .select('template_key')
    .eq('direction', 'outbound')

  if (error) throw error
  
  const total = data.length
  const known = data.filter(d => d.template_key !== 'unknown').length
  
  return {
    total,
    known,
    coverage_pct: total > 0 ? (known / total) * 100 : 0
  }
}

export const usePerformanceIntelligence = (window: TimeWindow = '7d') => {
  const [outliers, setOutliers] = useState<any>(null)
  const [coverage, setCoverage] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [o, c] = await Promise.all([
        fetchPerformanceOutliers(window),
        fetchAttributionCoverage('all_time')
      ])
      setOutliers(o)
      setCoverage(c)
    } catch (err) {
      console.error('[Performance Hook] Failed:', err)
    } finally {
      setIsLoading(false)
    }
  }, [window])

  useEffect(() => {
    load()
  }, [load])

  return { outliers, coverage, isLoading, refresh: load }
}
