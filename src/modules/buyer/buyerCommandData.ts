import { useEffect, useMemo, useState } from 'react'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import { getSupabaseClient } from '../../lib/supabaseClient'

export type BuyerMapFilters = {
  buyerType: string
  buyerTier: string
  activityWindowDays: 30 | 90 | 180 | 365
  radiusMiles: 1 | 3 | 5 | 10
  market: string
  state: string
  zip: string
  propertyType: string
  minPurchaseCount: number
  minMatchScore: number
  minDispoPriorityScore: number
}

export const defaultBuyerMapFilters: BuyerMapFilters = {
  buyerType: '',
  buyerTier: '',
  activityWindowDays: 180,
  radiusMiles: 5,
  market: '',
  state: '',
  zip: '',
  propertyType: '',
  minPurchaseCount: 0,
  minMatchScore: 60,
  minDispoPriorityScore: 0,
}

export type BuyerCategory = 'institutional' | 'landlord' | 'flipper' | 'builder' | 'general'

export type BuyerProfileSummary = {
  buyerKey: string
  buyerName: string
  buyerType: string
  buyerTier: string
  marketsActive: string[]
  statesActive: string[]
  zipsActive: string[]
  propertyTypeFocus: string[]
  avgPurchasePrice: number | null
  medianPurchasePrice: number | null
  purchaseCountTotal: number | null
  purchaseCount6mo: number | null
  purchaseCount12mo: number | null
  lastPurchaseDate: string | null
  velocityScore: number | null
  marketFocusScore: number | null
  assetFitScore: number | null
  cashBuyerScore: number | null
  dispoPriorityScore: number | null
  confidenceScore: number | null
  buyerSummary: string
  recommendedAction: string
  buyerExitStrategy: string
  category: BuyerCategory
}

export type BuyerMatchSummary = {
  matchKey: string
  buyerKey: string
  buyerProfileId: string
  buyerName: string
  buyerTier: string
  propertyId: string
  masterOwnerId: string
  ownerKey: string
  propertyAddressFull: string
  propertyAddressCity: string
  propertyAddressState: string
  propertyAddressZip: string
  market: string
  propertyType: string
  targetPrice: number | null
  estimatedValue: number | null
  estimatedRepairCost: number | null
  potentialSpread: number | null
  matchScore: number | null
  marketFitScore: number | null
  priceFitScore: number | null
  assetFitScore: number | null
  velocityScore: number | null
  confidence: number | null
  reasonForMatch: string
  recommendedAction: string
  dispositionStrategy: string
  matchStatus: string
  category: BuyerCategory
}

export type BuyerRecentPurchase = {
  propertyId: string
  propertyAddressFull: string
  propertyAddressCity: string
  propertyAddressState: string
  propertyAddressZip: string
  market: string
  propertyType: string
  ownerName: string
  buyerName: string
  buyerNameClean: string
  buyerKey: string
  saleDate: string | null
  salePrice: number | null
  estimatedValue: number | null
  buildingSquareFeet: number | null
  unitsCount: number | null
  totalBedrooms: number | null
  totalBaths: number | null
  yearBuilt: number | null
  pricePerSqft: number | null
  pricePerUnit: number | null
  latitude: number
  longitude: number
  buyerEntityStrength: string
  buyerBuyBoxSignal: string
  buyerActivitySignal: string
  compQualityScore: number | null
  resaleMarginScore: number | null
  investorFitScore: number | null
  arvEstimate: number | null
  compConfidenceScore: number | null
  dealGrade: string
  category: BuyerCategory
  distanceMiles: number | null
}

export type BuyerProfilePoint = {
  buyerKey: string
  buyerName: string
  buyerType: string
  buyerTier: string
  category: BuyerCategory
  latitude: number
  longitude: number
  market: string
  state: string
  zip: string
  propertyTypes: string[]
  purchaseCount: number
  avgPurchasePrice: number | null
  recentPurchaseDate: string | null
  velocityScore: number | null
  dispoPriorityScore: number | null
  confidenceScore: number | null
}

export type BuyerDemandSummary = {
  activeBuyerMatches: number
  topBuyerMatch: string
  averageMatchScore: number | null
  recentPurchasesNearby: number
  buyerDemandScore: number
  demandLabel: 'Limited' | 'Moderate' | 'Strong'
  strongestBuyerType: string
  likelyExitStrategy: string
  dispoConfidence: number
  recommendedAction: string
}

export type BuyerCommandData = {
  profiles: BuyerProfileSummary[]
  matches: BuyerMatchSummary[]
  recentPurchases: BuyerRecentPurchase[]
  profilePoints: BuyerProfilePoint[]
  summary: BuyerDemandSummary | null
  loading: boolean
  error: string | null
  hasLiveProfiles: boolean
  hasLiveMatches: boolean
}

type PropertyContext = {
  propertyId: string
  masterOwnerId: string
  market: string
  state: string
  zip: string
  propertyType: string
  lat: number | null
  lng: number | null
}

const asText = (value: unknown, fallback = ''): string => {
  const text = String(value ?? '').trim()
  return text || fallback
}

const asNumber = (value: unknown): number | null => {
  const next = Number(String(value ?? '').replace(/[,$\s]/g, ''))
  return Number.isFinite(next) ? next : null
}

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean)
  const text = asText(value)
  if (!text) return []
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

const lower = (value: unknown): string => asText(value).toLowerCase()

const categoryFromSignals = (...values: Array<unknown>): BuyerCategory => {
  const haystack = values.map((value) => lower(value)).join(' ')
  if (haystack.includes('hedge') || haystack.includes('institution') || haystack.includes('fund')) return 'institutional'
  if (haystack.includes('builder') || haystack.includes('new construction') || haystack.includes('build')) return 'builder'
  if (haystack.includes('flip') || haystack.includes('rehab') || haystack.includes('wholesale')) return 'flipper'
  if (haystack.includes('rental') || haystack.includes('landlord') || haystack.includes('hold') || haystack.includes('buy and hold')) return 'landlord'
  return 'general'
}

const haversineMiles = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusMiles = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const propertyContextFromThread = (thread: InboxWorkflowThread | null): PropertyContext | null => {
  if (!thread) return null
  const row = thread as unknown as Record<string, unknown>
  const lat = asNumber(row.lat ?? row.latitude)
  const lng = asNumber(row.lng ?? row.longitude)
  return {
    propertyId: asText(row.propertyId ?? row.property_id),
    masterOwnerId: asText(row.ownerId ?? row.master_owner_id),
    market: asText(row.market ?? row.marketName ?? row.marketId),
    state: asText(row.property_address_state ?? row.state),
    zip: asText(row.property_address_zip ?? row.zip),
    propertyType: asText(row.propertyType ?? row.property_type),
    lat,
    lng,
  }
}

const supportsQuery = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code
  return code !== '42P01' && code !== '42703'
}

const fetchFirstAvailable = async <T,>(
  tables: string[],
  run: (table: string) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; table: string | null; error: string | null }> => {
  for (const table of tables) {
    const { data, error } = await run(table)
    if (!error) return { rows: data ?? [], table, error: null }
    if (!supportsQuery(error)) continue
    return { rows: [], table, error: error instanceof Error ? error.message : String(error) }
  }
  return { rows: [], table: null, error: null }
}

const toBuyerProfile = (row: Record<string, unknown>): BuyerProfileSummary => ({
  buyerKey: asText(row.buyer_key, 'buyer'),
  buyerName: asText(row.buyer_name, asText(row.buyer_key, 'Property Buyer')),
  buyerType: asText(row.buyer_type, 'Unknown'),
  buyerTier: asText(row.buyer_tier, 'Unknown'),
  marketsActive: asStringArray(row.markets_active),
  statesActive: asStringArray(row.states_active),
  zipsActive: asStringArray(row.zips_active),
  propertyTypeFocus: asStringArray(row.property_type_focus),
  avgPurchasePrice: asNumber(row.avg_purchase_price),
  medianPurchasePrice: asNumber(row.median_purchase_price),
  purchaseCountTotal: asNumber(row.purchase_count_total),
  purchaseCount6mo: asNumber(row.purchase_count_6mo),
  purchaseCount12mo: asNumber(row.purchase_count_12mo),
  lastPurchaseDate: asText(row.last_purchase_date) || null,
  velocityScore: asNumber(row.velocity_score),
  marketFocusScore: asNumber(row.market_focus_score),
  assetFitScore: asNumber(row.asset_fit_score),
  cashBuyerScore: asNumber(row.cash_buyer_score),
  dispoPriorityScore: asNumber(row.dispo_priority_score),
  confidenceScore: asNumber(row.confidence_score),
  buyerSummary: asText(row.buyer_summary, 'Buyer profile live data is still populating.'),
  recommendedAction: asText(row.recommended_action, 'Review buyer fit.'),
  buyerExitStrategy: asText(row.buyer_exit_strategy, 'Unknown'),
  category: categoryFromSignals(row.buyer_type, row.buyer_summary, row.buyer_exit_strategy),
})

const toBuyerMatch = (row: Record<string, unknown>): BuyerMatchSummary => ({
  matchKey: asText(row.match_key, asText(row.id, crypto.randomUUID?.() ?? 'match')),
  buyerKey: asText(row.buyer_key, 'buyer'),
  buyerProfileId: asText(row.buyer_profile_id),
  buyerName: asText(row.buyer_name, asText(row.buyer_key, 'Property Buyer')),
  buyerTier: asText(row.buyer_tier, 'Unknown'),
  propertyId: asText(row.property_id),
  masterOwnerId: asText(row.master_owner_id),
  ownerKey: asText(row.owner_key),
  propertyAddressFull: asText(row.property_address_full, 'Property Unknown'),
  propertyAddressCity: asText(row.property_address_city),
  propertyAddressState: asText(row.property_address_state),
  propertyAddressZip: asText(row.property_address_zip),
  market: asText(row.market, 'Market Unknown'),
  propertyType: asText(row.property_type, 'Unknown'),
  targetPrice: asNumber(row.target_price),
  estimatedValue: asNumber(row.estimated_value),
  estimatedRepairCost: asNumber(row.estimated_repair_cost),
  potentialSpread: asNumber(row.potential_spread),
  matchScore: asNumber(row.match_score),
  marketFitScore: asNumber(row.market_fit_score),
  priceFitScore: asNumber(row.price_fit_score),
  assetFitScore: asNumber(row.asset_fit_score),
  velocityScore: asNumber(row.velocity_score),
  confidence: asNumber(row.confidence),
  reasonForMatch: asText(row.reason_for_match, 'Market and price fit are still being computed.'),
  recommendedAction: asText(row.recommended_action, 'Review buyer disposition fit.'),
  dispositionStrategy: asText(row.disposition_strategy, 'Unknown'),
  matchStatus: asText(row.match_status, 'pending'),
  category: categoryFromSignals(row.buyer_name, row.disposition_strategy, row.reason_for_match, row.buy_box_summary),
})

const toRecentPurchase = (row: Record<string, unknown>, context: PropertyContext | null): BuyerRecentPurchase | null => {
  const latitude = asNumber(row.latitude)
  const longitude = asNumber(row.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const distanceMiles =
    context?.lat != null && context?.lng != null
      ? haversineMiles(context.lat, context.lng, latitude as number, longitude as number)
      : null
  return {
    propertyId: asText(row.property_id, asText(row.id)),
    propertyAddressFull: asText(row.property_address_full, 'Property Unknown'),
    propertyAddressCity: asText(row.property_address_city),
    propertyAddressState: asText(row.property_address_state),
    propertyAddressZip: asText(row.property_address_zip),
    market: asText(row.market, 'Market Unknown'),
    propertyType: asText(row.property_type, 'Unknown'),
    ownerName: asText(row.owner_name),
    buyerName: asText(row.buyer_name, 'Property Buyer'),
    buyerNameClean: asText(row.buyer_name_clean, asText(row.buyer_name, 'Property Buyer')),
    buyerKey: asText(row.buyer_key, asText(row.buyer_name_clean, asText(row.buyer_name, 'buyer'))),
    saleDate: asText(row.sale_date) || null,
    salePrice: asNumber(row.sale_price),
    estimatedValue: asNumber(row.estimated_value),
    buildingSquareFeet: asNumber(row.building_square_feet),
    unitsCount: asNumber(row.units_count),
    totalBedrooms: asNumber(row.total_bedrooms),
    totalBaths: asNumber(row.total_baths),
    yearBuilt: asNumber(row.year_built),
    pricePerSqft: asNumber(row.price_per_sqft),
    pricePerUnit: asNumber(row.price_per_unit),
    latitude: latitude as number,
    longitude: longitude as number,
    buyerEntityStrength: asText(row.buyer_entity_strength, 'Unknown'),
    buyerBuyBoxSignal: asText(row.buyer_buy_box_signal),
    buyerActivitySignal: asText(row.buyer_activity_signal),
    compQualityScore: asNumber(row.comp_quality_score),
    resaleMarginScore: asNumber(row.resale_margin_score),
    investorFitScore: asNumber(row.investor_fit_score),
    arvEstimate: asNumber(row.arv_estimate),
    compConfidenceScore: asNumber(row.comp_confidence_score),
    dealGrade: asText(row.deal_grade),
    category: categoryFromSignals(row.buyer_name, row.buyer_entity_strength, row.buyer_buy_box_signal, row.buyer_activity_signal),
    distanceMiles,
  }
}

const buildProfilePoints = (profiles: BuyerProfileSummary[], purchases: BuyerRecentPurchase[]): BuyerProfilePoint[] => {
  const profilesByBuyer = new Map(profiles.map((profile) => [profile.buyerKey, profile]))
  const grouped = new Map<string, BuyerRecentPurchase[]>()

  purchases.forEach((purchase) => {
    const key = purchase.buyerKey || purchase.buyerName
    if (!key) return
    const bucket = grouped.get(key) ?? []
    bucket.push(purchase)
    grouped.set(key, bucket)
  })

  return Array.from(grouped.entries()).map(([buyerKey, items]) => {
    const latest = [...items].sort((left, right) => new Date(right.saleDate || 0).getTime() - new Date(left.saleDate || 0).getTime())[0]
    const profile = profilesByBuyer.get(buyerKey)
    const avgPurchasePrice = items.length > 0
      ? items.reduce((sum, item) => sum + (item.salePrice ?? 0), 0) / items.filter((item) => item.salePrice != null).length
      : null

    return {
      buyerKey,
      buyerName: latest?.buyerName || profile?.buyerName || buyerKey,
      buyerType: profile?.buyerType || 'Unknown',
      buyerTier: profile?.buyerTier || 'Unknown',
      category: profile?.category || latest?.category || 'general',
      latitude: latest?.latitude ?? 0,
      longitude: latest?.longitude ?? 0,
      market: latest?.market || '',
      state: latest?.propertyAddressState || '',
      zip: latest?.propertyAddressZip || '',
      propertyTypes: Array.from(new Set(items.map((item) => item.propertyType).filter(Boolean))),
      purchaseCount: items.length,
      avgPurchasePrice: Number.isFinite(avgPurchasePrice ?? NaN) ? Math.round(avgPurchasePrice as number) : profile?.avgPurchasePrice ?? null,
      recentPurchaseDate: latest?.saleDate ?? profile?.lastPurchaseDate ?? null,
      velocityScore: profile?.velocityScore ?? null,
      dispoPriorityScore: profile?.dispoPriorityScore ?? null,
      confidenceScore: profile?.confidenceScore ?? latest?.compConfidenceScore ?? null,
    }
  }).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude !== 0 && point.longitude !== 0)
}

const computeDemandSummary = (
  profiles: BuyerProfileSummary[],
  matches: BuyerMatchSummary[],
  purchases: BuyerRecentPurchase[],
): BuyerDemandSummary | null => {
  if (profiles.length === 0 && matches.length === 0 && purchases.length === 0) return null
  const topMatch = [...matches].sort((left, right) => (right.matchScore ?? 0) - (left.matchScore ?? 0))[0] ?? null
  const nearbyPurchases = purchases.filter((purchase) => purchase.distanceMiles == null || purchase.distanceMiles <= 5)
  const avgMatchScore = matches.length > 0
    ? Math.round(matches.reduce((sum, item) => sum + (item.matchScore ?? 0), 0) / matches.length)
    : null
  const avgInvestorFit = purchases.length > 0
    ? purchases.reduce((sum, purchase) => sum + (purchase.investorFitScore ?? 0), 0) / purchases.length
    : 0
  const avgConfidence = matches.length > 0
    ? matches.reduce((sum, item) => sum + (item.confidence ?? 0), 0) / matches.length
    : purchases.length > 0
      ? purchases.reduce((sum, item) => sum + (item.compConfidenceScore ?? 0), 0) / purchases.length
      : profiles.length > 0
        ? profiles.reduce((sum, item) => sum + (item.confidenceScore ?? 0), 0) / profiles.length
        : 0
  const categoryPool = [
    ...profiles.map((item) => item.buyerType).filter(Boolean),
    ...matches.map((item) => item.dispositionStrategy).filter(Boolean),
    ...purchases.map((item) => item.category),
  ]
  const strongestBuyerType = categoryPool.sort((left, right) =>
    categoryPool.filter((item) => item === right).length - categoryPool.filter((item) => item === left).length
  )[0] || 'Investor'
  const likelyExitStrategy =
    topMatch?.dispositionStrategy ||
    profiles.find((profile) => profile.buyerExitStrategy)?.buyerExitStrategy ||
    (strongestBuyerType.toLowerCase().includes('flipper') ? 'Light Rehab' : strongestBuyerType.toLowerCase().includes('landlord') ? 'Rental Hold' : 'Wholesale / Light Rehab')
  const demandScore = Math.max(0, Math.min(100,
    Math.round(
      (avgMatchScore ?? 55) * 0.46 +
      Math.min(nearbyPurchases.length, 25) * 1.2 +
      avgInvestorFit * 0.18 +
      avgConfidence * 0.16,
    ),
  ))
  const demandLabel: BuyerDemandSummary['demandLabel'] =
    demandScore >= 78 ? 'Strong' : demandScore >= 58 ? 'Moderate' : 'Limited'
  const recommendedAction =
    topMatch?.recommendedAction ||
    (demandScore >= 78
      ? 'Prepare buyer blast and generate dispo packet.'
      : demandScore >= 58
        ? 'Review top buyer pool and tighten pricing.'
        : 'Expand radius or relax buyer filters before blasting.')

  return {
    activeBuyerMatches: matches.length,
    topBuyerMatch: topMatch?.buyerName || purchases[0]?.buyerName || profiles[0]?.buyerName || 'No live buyer yet',
    averageMatchScore: avgMatchScore,
    recentPurchasesNearby: nearbyPurchases.length,
    buyerDemandScore: demandScore,
    demandLabel,
    strongestBuyerType,
    likelyExitStrategy,
    dispoConfidence: Math.max(0, Math.min(100, Math.round(avgConfidence))),
    recommendedAction,
  }
}

export const useBuyerCommandData = (
  selectedThread: InboxWorkflowThread | null,
  filters: BuyerMapFilters,
): BuyerCommandData => {
  const [state, setState] = useState<BuyerCommandData>({
    profiles: [],
    matches: [],
    recentPurchases: [],
    profilePoints: [],
    summary: null,
    loading: false,
    error: null,
    hasLiveProfiles: false,
    hasLiveMatches: false,
  })

  const context = useMemo(() => propertyContextFromThread(selectedThread), [selectedThread])

  useEffect(() => {
    if (!context) {
      setState((current) => ({
        ...current,
        profiles: [],
        matches: [],
        recentPurchases: [],
        profilePoints: [],
        summary: null,
        loading: false,
        error: null,
      }))
      return
    }

    let active = true
    setState((current) => ({ ...current, loading: true, error: null }))

    const load = async () => {
      const supabase = getSupabaseClient()

      const profileResult = await fetchFirstAvailable<Record<string, unknown>>(
        ['top_buyer_profiles', 'buyer_profiles_computed', 'buyer_profiles'],
        async (table) => {
          const query = supabase
            .from(table)
            .select('*')
            .order('dispo_priority_score', { ascending: false, nullsFirst: false })
            .limit(100)

          return await query
        },
      )

      const matchResult = await fetchFirstAvailable<Record<string, unknown>>(
        ['top_buyer_property_matches', 'buyer_property_matches_computed', 'buyer_property_matches'],
        async (table) => {
          let query = supabase
            .from(table)
            .select('*')
            .order('match_score', { ascending: false, nullsFirst: false })
            .limit(80)

          if (context.propertyId) query = query.eq('property_id', context.propertyId)
          else if (context.masterOwnerId) query = query.eq('master_owner_id', context.masterOwnerId)

          return await query
        },
      )

      const purchaseResult = await fetchFirstAvailable<Record<string, unknown>>(
        ['recently_sold_properties_computed', 'recently_sold_properties'],
        async (table) => {
          let query = supabase
            .from(table)
            .select('*')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .order('sale_date', { ascending: false, nullsFirst: false })
            .limit(300)

          const market = filters.market || context.market
          const state = filters.state || context.state
          const propertyType = filters.propertyType || context.propertyType

          if (market) query = query.eq('market', market)
          else if (state) query = query.eq('property_address_state', state)
          if (propertyType) query = query.eq('property_type', propertyType)

          return await query
        },
      )

      if (!active) return

      const profiles = profileResult.rows.map(toBuyerProfile).filter((profile) => {
        const market = filters.market || context.market
        const state = filters.state || context.state
        const zip = filters.zip || context.zip
        const propertyType = filters.propertyType || context.propertyType
        if (filters.buyerType && lower(profile.buyerType) !== lower(filters.buyerType)) return false
        if (filters.buyerTier && lower(profile.buyerTier) !== lower(filters.buyerTier)) return false
        if ((profile.purchaseCount12mo ?? 0) < filters.minPurchaseCount) return false
        if ((profile.dispoPriorityScore ?? 0) < filters.minDispoPriorityScore) return false
        if (market && profile.marketsActive.length > 0 && !profile.marketsActive.some((value) => lower(value) === lower(market))) return false
        if (!market && state && profile.statesActive.length > 0 && !profile.statesActive.some((value) => lower(value) === lower(state))) return false
        if (zip && profile.zipsActive.length > 0 && !profile.zipsActive.includes(zip)) return false
        if (propertyType && profile.propertyTypeFocus.length > 0 && !profile.propertyTypeFocus.some((value) => lower(value) === lower(propertyType))) return false
        return true
      })

      const matches = matchResult.rows.map(toBuyerMatch).filter((match) => {
        if ((match.matchScore ?? 0) < filters.minMatchScore) return false
        if (filters.buyerType && lower(match.category) !== lower(filters.buyerType)) return false
        if (filters.propertyType && lower(match.propertyType) !== lower(filters.propertyType)) return false
        return true
      })

      const cutoff = Date.now() - filters.activityWindowDays * 86400_000
      const recentPurchases = purchaseResult.rows
        .map((row) => toRecentPurchase(row, context))
        .filter((purchase): purchase is BuyerRecentPurchase => Boolean(purchase))
        .filter((purchase) => {
          const saleTs = new Date(purchase.saleDate || 0).getTime()
          if (Number.isFinite(saleTs) && saleTs < cutoff) return false
          const zip = filters.zip || context.zip
          const market = filters.market || context.market
          const state = filters.state || context.state
          const propertyType = filters.propertyType || context.propertyType
          if (zip && purchase.propertyAddressZip && purchase.propertyAddressZip !== zip) return false
          if (market && purchase.market && lower(purchase.market) !== lower(market)) return false
          if (!market && state && purchase.propertyAddressState && lower(purchase.propertyAddressState) !== lower(state)) return false
          if (propertyType && purchase.propertyType && lower(purchase.propertyType) !== lower(propertyType)) return false
          if (context.lat != null && context.lng != null && purchase.distanceMiles != null && purchase.distanceMiles > filters.radiusMiles) return false
          return true
        })

      const profilePoints = buildProfilePoints(profiles, recentPurchases).filter((point) => point.purchaseCount >= filters.minPurchaseCount)
      const summary = computeDemandSummary(profiles, matches, recentPurchases)

      setState({
        profiles,
        matches,
        recentPurchases,
        profilePoints,
        summary,
        loading: false,
        error: profileResult.error || matchResult.error || purchaseResult.error,
        hasLiveProfiles: profiles.length > 0,
        hasLiveMatches: matches.length > 0,
      })
    }

    void load()
    return () => {
      active = false
    }
  }, [context, filters])

  return state
}
