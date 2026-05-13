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
  const supabase = getSupabaseClient()

  // 1. If we already have a textgridNumberId, validate it
  if (thread.textgridNumberId) {
    const { data: tgRow } = await supabase
      .from('textgrid_numbers')
      .select('id, phone_number, market')
      .eq('id', thread.textgridNumberId)
      .eq('status', 'active')
      .limit(1)
      .single()

    if (tgRow) {
      return {
        ok: true,
        from_phone_number: normalizePhone(tgRow.phone_number),
        textgrid_number_id: tgRow.id,
        market_id: tgRow.market,
        routing_tier: 0,
        routing_reason: 'Direct assignment'
      }
    }
  }

  // 2. If we have a from_phone_number (ourNumber), resolve its ID
  if (thread.ourNumber) {
    const { textgridNumberId, from_phone_number } = await resolveTextgridNumberId(thread.ourNumber, supabase)
    if (textgridNumberId && from_phone_number) {
      return {
        ok: true,
        from_phone_number,
        textgrid_number_id: textgridNumberId,
        market_id: null,
        routing_tier: 1,
        routing_reason: 'Resolved from existing number'
      }
    }
  }

  // 3. Dynamic Resolution - Tier 1: Market Match
  const rawMarket = thread.marketId
  if (rawMarket) {
    // Try exact match or fuzzy match (e.g. 'm-dallas' -> 'Dallas, TX')
    // For now, let's assume the table has markets that might need mapping or direct match
    const { data: marketNumbers } = await supabase
      .from('textgrid_numbers')
      .select('id, phone_number, market')
      .ilike('market', `%${rawMarket.replace('m-', '')}%`)
      .eq('status', 'active')
      .lt('messages_sent_today', 150)
      .order('messages_sent_today', { ascending: true })
      .limit(1)

    if (marketNumbers && marketNumbers.length > 0) {
      return {
        ok: true,
        from_phone_number: normalizePhone(marketNumbers[0].phone_number),
        textgrid_number_id: marketNumbers[0].id,
        market_id: marketNumbers[0].market,
        routing_tier: 2,
        routing_reason: `Market match: ${rawMarket}`
      }
    }
  }

  // 4. Dynamic Resolution - Tier 2: State Match
  const stateCode = thread.property_address_state
  if (stateCode) {
    const { data: stateNumbers } = await supabase
      .from('textgrid_numbers')
      .select('id, phone_number, market')
      .ilike('market', `%${stateCode}%`) // Most markets are 'City, ST'
      .eq('status', 'active')
      .lt('messages_sent_today', 150)
      .order('messages_sent_today', { ascending: true })
      .limit(1)

    if (stateNumbers && stateNumbers.length > 0) {
      return {
        ok: true,
        from_phone_number: normalizePhone(stateNumbers[0].phone_number),
        textgrid_number_id: stateNumbers[0].id,
        market_id: stateNumbers[0].market,
        routing_tier: 3,
        routing_reason: `State match: ${stateCode}`
      }
    }
  }

  // 5. Fallback - General Inventory
  const { data: fallbackNumbers } = await supabase
    .from('textgrid_numbers')
    .select('id, phone_number, market')
    .eq('status', 'active')
    .lt('messages_sent_today', 150)
    .order('messages_sent_today', { ascending: true })
    .limit(1)

  if (fallbackNumbers && fallbackNumbers.length > 0) {
    return {
      ok: true,
      from_phone_number: normalizePhone(fallbackNumbers[0].phone_number),
      textgrid_number_id: fallbackNumbers[0].id,
      market_id: fallbackNumbers[0].market,
      routing_tier: 4,
      routing_reason: 'Fallback from inventory'
    }
  }

  return { 
    ok: false, 
    from_phone_number: null, 
    textgrid_number_id: null, 
    market_id: null, 
    error: 'NO_VALID_LOCAL_TEXTGRID_NUMBER' 
  }
}
