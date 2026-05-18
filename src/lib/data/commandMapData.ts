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
  
  units_count?: number | null
  lot_square_feet?: number | null
  lot_acreage?: number | null
  effective_year_built?: number | null
  
  sale_source?: string | null
  owner_type_label?: string | null
  buyer_type_label?: string | null
  buyer_type_confidence?: string | null
  is_institutional_buyer?: boolean | null
  institutional_match_name?: string | null
  institutional_match_method?: string | null
  institutional_match_confidence?: string | null
}

const INSTITUTIONAL_NAMES = [
  'INVITATION HOMES', 'IH6', 'IH5', 'IH4', 'STARWOOD', 'TRICON', 'FIRSTKEY',
  'AMHERST', 'PROGRESS RESIDENTIAL', 'PRETIUM', 'MAIN STREET RENEWAL',
  'MAYMONT HOMES', 'SECOND AVENUE', 'HOME PARTNERS OF AMERICA', 'OPENDOOR',
  'OFFERPAD', 'AMERICAN HOMES 4 RENT', 'AH4R', 'ROOFSTOCK', 'RESICAP',
  'CERBERUS', 'BLACKSTONE', 'SFR3', 'VINEBROOK', 'WEDGEWOOD', 'SUNDAE',
  'ENTERA', 'MYND', 'DIVVY', 'REALPHA', 'SYLVAN HOMES', 'RENU PROPERTY MANAGEMENT',
  'FRONT YARD RESIDENTIAL', 'ALTISOURCE', 'TRANSCENDENT ELECTRA', 'TIBER CAPITAL',
  'CONREX', 'AMHERST RESIDENTIAL', 'SREIT', 'TRICON RESIDENTIAL'
];

const INSTITUTIONAL_KEYWORDS = [
  'FUND', 'REIT', 'PORTFOLIO', 'TRUST', 'CAPITAL', 'INVESTMENT', 'HOLDING', 
  'PARTNER', 'MANAGEMENT', 'CORPORATION', 'OPPORTUNITY FUND', 'SINGLE FAMILY RENTAL',
  'EQUITY', 'VENTURE', 'ADVISOR'
];

const BUILDER_KEYWORDS = [
  'BUILDER', 'DEVELOP', 'CONSTRUCTION', 'HOMES', 'LIVABLE', 'NEIGHBORHOOD',
  'CUSTOM HOME', 'LAND', 'CONTRACTOR'
];

const OPERATOR_KEYWORDS = [
  'APARTMENT', 'LIVING', 'RESIDENCE', 'COMMUNITY', 'SUITES', 'LOFTS',
  'VILLAS', 'MANOR', 'OPERATOR', 'REALTY'
];

function enrichSoldComp(comp: RecentSoldComp): RecentSoldComp {
  // Compute sale source if not returned from DB
  if (!comp.sale_source) {
    if (comp.mls_sold_price || comp.mls_sold_date) {
      comp.sale_source = 'MLS Sold'
    } else if (comp.sale_price || comp.sale_date) {
      comp.sale_source = 'Public Record Sold'
    } else {
      comp.sale_source = 'Unknown'
    }
  }

  // Compute owner type if not returned
  if (!comp.owner_type_label) {
    if (comp.is_corporate_owner) {
      comp.owner_type_label = 'Corporate Owner'
    } else if (comp.is_corporate_owner === false && comp.owner_name) {
      comp.owner_type_label = 'Individual Owner'
    } else {
      comp.owner_type_label = 'Unknown Owner Type'
    }
  }

  const ownerNameUpper = (comp.owner_name || '').toUpperCase()
  let isInst = false
  let matchName = null
  let matchMethod = null
  let matchConfidence = null
  let buyerLabel = 'Unknown Buyer Type'

  if (ownerNameUpper) {
    // 1. Institutional / Hedge Fund Check
    for (const name of INSTITUTIONAL_NAMES) {
      if (ownerNameUpper.includes(name)) {
        isInst = true
        matchName = name
        matchMethod = 'name_match'
        matchConfidence = 'Confirmed'
        break
      }
    }

    if (!isInst) {
      for (const kw of INSTITUTIONAL_KEYWORDS) {
        if (ownerNameUpper.includes(kw)) {
          if (comp.is_corporate_owner !== false) {
            isInst = true
            matchName = kw
            matchMethod = 'keyword_match'
            matchConfidence = 'High'
            break
          }
        }
      }
    }

    if (isInst) {
      buyerLabel = 'Hedge Fund / Institutional'
      comp.is_institutional_buyer = true
    } 
    // 2. Builder / Developer Check
    else if (BUILDER_KEYWORDS.some(kw => ownerNameUpper.includes(kw)) && comp.is_corporate_owner !== false) {
      buyerLabel = 'Builder / Developer'
      comp.is_institutional_buyer = false
    }
    // 3. Apartment Operator / Investor Check (LLC + Multifamily context)
    else if ((OPERATOR_KEYWORDS.some(kw => ownerNameUpper.includes(kw)) || (ownerNameUpper.includes('LLC') && (comp.units_count ?? 0) >= 5)) && comp.is_corporate_owner !== false) {
      buyerLabel = 'Apartment Operator'
      comp.is_institutional_buyer = false
    }
    // 4. Local Investor / LLC
    else if (ownerNameUpper.includes('LLC') || ownerNameUpper.includes('LP') || ownerNameUpper.includes('TRUST')) {
      buyerLabel = 'Local Investor / LLC'
      comp.is_institutional_buyer = false
    }
    // 5. General Corporate
    else if (comp.is_corporate_owner || ownerNameUpper.includes('INC') || ownerNameUpper.includes('CORP')) {
      buyerLabel = 'Corporate Buyer'
      comp.is_institutional_buyer = false
    }
    // 6. Individual
    else {
      buyerLabel = 'Individual Buyer'
      comp.is_institutional_buyer = false
    }
  } else {
    // Fallback if no owner name
    if (comp.is_corporate_owner) buyerLabel = 'Corporate Buyer'
    else if (comp.is_corporate_owner === false) buyerLabel = 'Individual Buyer'
  }

  comp.institutional_match_name = matchName
  comp.institutional_match_method = matchMethod
  comp.institutional_match_confidence = matchConfidence

  if (!comp.buyer_type_label || comp.buyer_type_label === 'Unknown Buyer Type') {
    comp.buyer_type_label = buyerLabel
  }

  return comp
}

export const loadSubjectComps = async (propertyId: string, radiusMiles = 1.0, monthsBack = 12, limit = 50): Promise<RecentSoldComp[]> => {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('get_comp_candidates_for_subject', {
    p_subject_property_id: propertyId,
    p_radius_miles: radiusMiles,
    p_months_back: monthsBack,
    p_limit: limit
  })
  if (error || !data) {
    console.error('Failed to load subject comps', error)
    return []
  }
  return (data as RecentSoldComp[]).map(enrichSoldComp)
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
    .order('sale_date', { ascending: false, nullsFirst: false })
    .order('mls_sold_date', { ascending: false, nullsFirst: false })
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
    const price = comp.mls_sold_price ?? comp.sale_price ?? 0
    if (price <= 0) return false // Do not show comps with a $0 sale price

    if (filters?.beds && comp.total_bedrooms !== filters.beds) return false
    if (filters?.baths && comp.total_baths !== filters.baths) return false
    
    if (filters?.sqftRange) {
      const sqft = comp.building_square_feet ?? 0
      if (sqft < filters.sqftRange[0] || sqft > filters.sqftRange[1]) return false
    }

    if (filters?.minSalePrice || filters?.maxSalePrice) {
      if (filters.minSalePrice && price < filters.minSalePrice) return false
      if (filters.maxSalePrice && price > filters.maxSalePrice) return false
    }

    return true
  })

  return comps.map(enrichSoldComp)
}

export type CommandMapSellerPin = {
  property_id: string
  lat: number
  lng: number
  seller_name: string | null
  property_address_full: string | null
  owner_type: string | null
  property_type: string | null
  total_bedrooms: number | null
  total_baths: number | null
  building_square_feet: number | null
  units_count: number | null
  year_built: number | null
  estimated_value: number | null
  equity_percent: number | null
  estimated_repair_cost: number | null
  motivation_score: number | null
  property_tags_text: string | null
  property_tags_json: any | null
  latest_message_at: string | null
  latest_direction: string | null
  seller_state: string | null
  execution_state: string | null
  queued_count: number | null
  scheduled_count: number | null
  ready_count: number | null
  sent_count: number | null
  delivered_count: number | null
  next_scheduled_for: string | null
  pin_color: string | null
  pin_shape: string | null
  pulse_style: string | null
  execution_ring_color: string | null
  render_priority: number | null
}

export const loadCommandMapSellerPins = async (
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  zoomLevel: number,
  maxRows: number
): Promise<CommandMapSellerPin[]> => {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('get_command_map_seller_pins', {
    min_lat: bounds.minLat,
    min_lng: bounds.minLng,
    max_lat: bounds.maxLat,
    max_lng: bounds.maxLng,
    zoom_level: Math.floor(zoomLevel),
    max_rows: maxRows
  })
  if (error || !data) {
    console.error('Failed to load seller pins', error)
    return []
  }
  return data as CommandMapSellerPin[]
}

