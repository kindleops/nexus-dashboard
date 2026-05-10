import { getSupabaseClient } from '../supabaseClient'
import { asNumber, type AnyRecord } from './shared'

export interface OperationalKpi {
  id: string
  label: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
  status?: 'good' | 'warning' | 'critical' | 'neutral'
  description?: string
  category: 'messaging' | 'quality' | 'automation' | 'pipeline' | 'financial'
  timeWindow: 'today' | '24h' | '7d' | '30d'
  isAvailable: boolean
}

export interface OperationalKpis {
  messaging: OperationalKpi[]
  quality: OperationalKpi[]
  automation: OperationalKpi[]
  pipeline: OperationalKpi[]
  financial: OperationalKpi[]
  lastUpdated: string
}

const POSITIVE_INTENTS = ['seller_interested', 'asking_price_provided', 'asks_offer', 'ownership_confirmed', 'price_anchor']

export const fetchOperationalKpis = async (timeWindow: OperationalKpi['timeWindow'] = '24h'): Promise<OperationalKpis> => {
  const supabase = getSupabaseClient()
  const now = new Date()
  let startDate = new Date()
  
  if (timeWindow === 'today') {
    startDate.setHours(0, 0, 0, 0)
  } else if (timeWindow === '24h') {
    startDate.setHours(now.getHours() - 24)
  } else if (timeWindow === '7d') {
    startDate.setDate(now.getDate() - 7)
  } else if (timeWindow === '30d') {
    startDate.setDate(now.getDate() - 30)
  }

  const startIso = startDate.toISOString()

  try {
    // Messaging Performance
    const { data: msgData, error: msgError } = await supabase
      .from('message_events')
      .select('direction, delivery_status, detected_intent, is_opt_out, is_final_failure')
      .gte('created_at', startIso)

    const messaging: OperationalKpi[] = []
    if (msgError) {
      console.error('[KPI] Messaging fetch error:', msgError)
    } else if (msgData) {
      const inbound = msgData.filter((m: AnyRecord) => m.direction === 'inbound')
      const outbound = msgData.filter((m: AnyRecord) => m.direction === 'outbound')
      const delivered = outbound.filter((m: AnyRecord) => m.delivery_status === 'delivered')
      const failed = outbound.filter((m: AnyRecord) => m.delivery_status === 'failed' || m.is_final_failure)
      const optOuts = msgData.filter((m: AnyRecord) => m.is_opt_out || String(m.detected_intent) === 'opt_out')
      const positive = inbound.filter((m: AnyRecord) => POSITIVE_INTENTS.includes(String(m.detected_intent)))
      const wrongNumber = inbound.filter((m: AnyRecord) => String(m.detected_intent) === 'wrong_number')

      const replyRate = delivered.length > 0 ? (inbound.length / delivered.length) * 100 : 0
      const posRate = inbound.length > 0 ? (positive.length / inbound.length) * 100 : 0
      const optOutRate = delivered.length > 0 ? (optOuts.length / delivered.length) * 100 : 0
      const wrongNumRate = inbound.length > 0 ? (wrongNumber.length / inbound.length) * 100 : 0
      const deliveryRate = outbound.length > 0 ? (delivered.length / outbound.length) * 100 : 0
      const failRate = outbound.length > 0 ? (failed.length / outbound.length) * 100 : 0

      messaging.push(
        { id: 'reply-rate', label: 'Reply Rate', value: replyRate.toFixed(1), unit: '%', category: 'messaging', timeWindow, isAvailable: true, status: replyRate > 10 ? 'good' : 'neutral' },
        { id: 'pos-reply-rate', label: 'Positive Rate', value: posRate.toFixed(1), unit: '%', category: 'messaging', timeWindow, isAvailable: true, status: posRate > 5 ? 'good' : 'neutral' },
        { id: 'opt-out-rate', label: 'Opt-Out Rate', value: optOutRate.toFixed(1), unit: '%', category: 'messaging', timeWindow, isAvailable: true, status: optOutRate < 3 ? 'good' : 'warning' },
        { id: 'wrong-num-rate', label: 'Wrong # Rate', value: wrongNumRate.toFixed(1), unit: '%', category: 'messaging', timeWindow, isAvailable: true },
        { id: 'delivery-rate', label: 'Delivery Rate', value: deliveryRate.toFixed(1), unit: '%', category: 'messaging', timeWindow, isAvailable: true, status: deliveryRate > 95 ? 'good' : 'warning' },
        { id: 'failure-rate', label: 'Failure Rate', value: failRate.toFixed(1), unit: '%', category: 'messaging', timeWindow, isAvailable: true, status: failRate < 5 ? 'good' : 'critical' }
      )
    }

    // Pipeline & Quality
    const pipeline: OperationalKpi[] = [
      { id: 'underwrites-today', label: 'Underwrites Today', value: '—', category: 'pipeline', timeWindow, isAvailable: false },
      { id: 'offers-ready', label: 'Offers Ready', value: '—', category: 'pipeline', timeWindow, isAvailable: false }
    ]

    // Financial
    const { data: propData, error: propError } = await supabase
      .from('properties')
      .select('estimated_value, cash_offer, equity_amount')
      .not('cash_offer', 'is', null)
      .limit(100)

    const financial: OperationalKpi[] = []
    if (propError) {
      console.error('[KPI] Property fetch error:', propError)
    } else if (propData && propData.length > 0) {
      const avgArv = propData.reduce((sum: number, p: AnyRecord) => sum + asNumber(p.estimated_value, 0), 0) / propData.length
      const avgOffer = propData.reduce((sum: number, p: AnyRecord) => sum + asNumber(p.cash_offer, 0), 0) / propData.length
      
      financial.push(
        { id: 'avg-arv', label: 'Avg ARV', value: Math.round(avgArv).toLocaleString(), unit: '$', category: 'financial', timeWindow, isAvailable: true },
        { id: 'avg-offer', label: 'Avg Offer', value: Math.round(avgOffer).toLocaleString(), unit: '$', category: 'financial', timeWindow, isAvailable: true }
      )
    }

    return {
      messaging,
      quality: [],
      automation: [],
      pipeline,
      financial,
      lastUpdated: new Date().toISOString()
    }
  } catch (err) {
    console.error('[KPI] Unexpected error:', err)
    return {
      messaging: [],
      quality: [],
      automation: [],
      pipeline: [],
      financial: [],
      lastUpdated: new Date().toISOString()
    }
  }
}
