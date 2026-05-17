import { getSupabaseClient } from '../supabaseClient'

export type SoldCompFilters = {
  monthsBack?: number
  assetClass?: string
  minSalePrice?: number
  maxSalePrice?: number
  beds?: number
  baths?: number
  sqftRange?: [number, number]
  yearBuiltBucket?: string
  selectedMarket?: string
  selectedState?: string
  selectedZip?: string
  limit?: number
}

export type RecentSoldComp = {
  property_id: string
  property_address_full: string
  property_address_city: string
  property_address_state: string
  property_address_zip: string
  latitude: number
  longitude: number
  mls_sold_price: number | null
  mls_sold_date: string | null
  sale_price: number | null
  sale_date: string | null
  owner_name: string | null
  is_corporate_owner: boolean | null
  property_type: string | null
  normalized_asset_class: string | null
  building_condition: string | null
  construction_type: string | null
  property_class: string | null
  total_bedrooms: number | null
  total_baths: number | null
  building_square_feet: number | null
  year_built: number | null
  renovation_level_classification: string | null
  comp_search_profile_hash: string | null
  comp_confidence_score: number | null
  deal_grade: string | null
  streetview_image: string | null
  satellite_image: string | null
  arv_estimate: number | null
  arv_ppsf: number | null
  potential_spread: number | null
  target_margin_percent: number | null
  computed_ppsf: number | null
  property_flags_text?: string | null
}

export const loadSoldCompsInBounds = async (
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  filters?: SoldCompFilters
): Promise<RecentSoldComp[]> => {
  const supabase = getSupabaseClient()
  
  const limit = filters?.limit ?? 1000

  // Query the view directly to ensure we get all the rich columns required by the UI
  let query = supabase
    .from('v_recent_sold_comps')
    .select('*')
    .gte('latitude', bounds.minLat)
    .lte('latitude', bounds.maxLat)
    .gte('longitude', bounds.minLng)
    .lte('longitude', bounds.maxLng)
    .limit(limit)

  if (filters?.assetClass) {
    query = query.eq('normalized_asset_class', filters.assetClass)
  }
  if (filters?.selectedMarket) {
    query = query.eq('market', filters.selectedMarket)
  }
  if (filters?.selectedState) {
    query = query.eq('property_address_state', filters.selectedState)
  }
  if (filters?.selectedZip) {
    query = query.eq('property_address_zip', filters.selectedZip)
  }

  const { data, error } = await query

  if (error || !data) {
    console.error('Failed to load sold comps', error)
    return []
  }

  let comps = data as RecentSoldComp[]

  // Client-side filtering for complex fields
  comps = comps.filter((comp) => {
    if (filters?.beds && comp.total_bedrooms !== filters.beds) return false
    if (filters?.baths && comp.total_baths !== filters.baths) return false
    
    if (filters?.sqftRange) {
      const sqft = comp.building_square_feet ?? 0
      if (sqft < filters.sqftRange[0] || sqft > filters.sqftRange[1]) return false
    }

    if (filters?.minSalePrice || filters?.maxSalePrice) {
      const price = comp.mls_sold_price || comp.sale_price || 0
      if (filters.minSalePrice && price < filters.minSalePrice) return false
      if (filters.maxSalePrice && price > filters.maxSalePrice) return false
    }

    return true
  })

  return comps
}
