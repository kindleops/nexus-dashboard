import { getSupabaseClient } from '../supabaseClient'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InboxThread } from '../../modules/inbox/inbox.adapter'

interface MarketRoutingConfig {
  marketId: string
  tier: number
  reason: string
}

const MARKET_CONFIG: Record<string, MarketRoutingConfig> = {
  'm-austin': { marketId: 'm-austin', tier: 1, reason: 'Primary market' },
  'm-houston': { marketId: 'm-houston', tier: 1, reason: 'Primary market' },
  'm-dallas': { marketId: 'm-dallas', tier: 1, reason: 'Primary market' },
  'm-san-antonio': { marketId: 'm-san-antonio', tier: 1, reason: 'Primary market' },
}

const STATE_CLUSTERS: Record<string, MarketRoutingConfig> = {
  TX: { marketId: 'm-central-tx', tier: 2, reason: 'Texas state cluster' },
}

interface RoutingResult {
  ok: boolean
  from_phone_number: string | null
  textgrid_number_id: string | null
  market_id: string | null
  routing_tier?: number
  routing_reason?: string
  error?: string
}

const normalizePhone = (phone: string | null | undefined): string | null => {
  if (!phone) return null
  const cleaned = String(phone).replace(/\D/g, '')
  if (cleaned.length === 10) return `+1${cleaned}`
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}

const buildPhoneVariants = (phone: string | null): string[] => {
  if (!phone) return []
  const cleaned = normalizePhone(phone)
  if (!cleaned) return []
  return [cleaned, cleaned.replace('+1', '')].filter(Boolean) as string[]
}

const resolveTextgridNumberId = async (
  fromPhone: string | null,
  supabase: SupabaseClient,
): Promise<{ textgridNumberId: string | null; from_phone_number: string | null }> => {
  if (!fromPhone) return { textgridNumberId: null, from_phone_number: null }

  let textgridNumberId: string | null = null
  let resolvedFromPhone: string | null = fromPhone

  try {
    const { data: tgRows } = await supabase
      .from('textgrid_numbers')
      .select('id,phone_number')
      .in('phone_number', buildPhoneVariants(fromPhone))
      .eq('status', 'active')
      .limit(1)
      .single()

    if (tgRows) {
      textgridNumberId = tgRows.id
      resolvedFromPhone = normalizePhone(tgRows.phone_number) || fromPhone
    }
  } catch (error) {
    console.error('Error querying textgrid_numbers:', error)
  }

  return { textgridNumberId, from_phone_number: resolvedFromPhone }
}

export const resolveOutboundTextgridNumber = async (
  thread: Pick<InboxThread, 'marketId' | 'ourNumber' | 'phoneNumber' | 'textgridNumberId' | 'property_address_state'>,
  _allowEnvFallback = false,
): Promise<RoutingResult> => {
  const initialFromPhone = normalizePhone(thread.ourNumber ?? thread.phoneNumber ?? '') || null
  if (!initialFromPhone) {
    return { ok: false, from_phone_number: null, textgrid_number_id: null, market_id: null, error: 'Thread has no initial outbound number.' }
  }

  const supabase = getSupabaseClient()

  // Tier 1: Exact Market Match
  if (thread.marketId) {
    const marketConfig = MARKET_CONFIG[thread.marketId]
    if (marketConfig) {
      const { textgridNumberId, from_phone_number } = await resolveTextgridNumberId(initialFromPhone, supabase)
      if (textgridNumberId && from_phone_number) {
        return { ok: true, from_phone_number, textgrid_number_id: textgridNumberId, market_id: marketConfig.marketId, routing_tier: marketConfig.tier, routing_reason: marketConfig.reason }
      }
    }
  }

  // Tier 2: State Cluster Match
  const threadState = thread.property_address_state
  if (threadState) {
    const stateConfig = STATE_CLUSTERS[threadState]
    if (stateConfig) {
      const { textgridNumberId, from_phone_number } = await resolveTextgridNumberId(initialFromPhone, supabase)
      if (textgridNumberId && from_phone_number) {
        return { ok: true, from_phone_number, textgrid_number_id: textgridNumberId, market_id: stateConfig.marketId, routing_tier: stateConfig.tier, routing_reason: stateConfig.reason }
      }
    }
  }

  return { ok: false, from_phone_number: null, textgrid_number_id: null, market_id: null, error: 'No valid local outbound number available for this lead.' }
}
