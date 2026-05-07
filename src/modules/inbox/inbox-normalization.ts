import { asString } from '../../lib/data/shared'
import type { ThreadMessage, ThreadIntelligenceRecord } from '../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'

const GOOGLE_MAPS_API_KEY = (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_MAPS_API_KEY

export interface NormalizedPropertySnapshot {
  fullAddress: string
  city: string
  state: string
  zip: string
  market: string
  propertyType: string
  propertyClass: string
  propertyStyle: string
  beds: string
  baths: string
  sqft: string
  yearBuilt: string
  effectiveYear: string
  estimatedValue: string
  repairCost: string
  cashOffer: string
  finalScore: string
  streetViewUrl: string | null
  aerialViewUrl: string | null
  unitCount: string
  lotSize: string
  lotSizeAcres: string
  occupancy: string
  ownerType: string
  zoning: string
  floodZone: string
  equityPercent: string
  equityAmount: string
  ownershipYears: string
}


export interface ExternalLinks {
  zillow: string | null
  realtor: string | null
  googleSearch: string | null
  streetView: string | null
}

/**
 * Build consistent external links for a property address.
 */
export const buildPropertyExternalLinks = (address: string | null): ExternalLinks => {
  if (!address || address.length < 5) {
    return { zillow: null, realtor: null, googleSearch: null, streetView: null }
  }
  const encoded = encodeURIComponent(address)
  return {
    zillow: `https://www.zillow.com/homes/${encoded}_rb/`,
    realtor: `https://www.realtor.com/realestateandhomes-search/${encoded}`,
    googleSearch: `https://www.google.com/search?q=${encoded}`,
    streetView: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  }
}

/**
 * Build Google Street View API URL for an address.
 */
export const buildStreetViewUrl = (address: string | null): string | null => {
  if (!address) return null
  const apiKey = GOOGLE_MAPS_API_KEY || 'AIzaSyAhOk7KZkduU4qywmrlq5ZqSOtgktHYiFk'
  return `https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${encodeURIComponent(address)}&fov=70&key=${apiKey}`
}

export const buildAerialViewUrl = (address: string | null): string | null => {
  if (!address) return null
  const apiKey = GOOGLE_MAPS_API_KEY || 'AIzaSyAhOk7KZkduU4qywmrlq5ZqSOtgktHYiFk'
  return `https://maps.googleapis.com/maps/api/staticmap?size=600x300&maptype=satellite&scale=2&zoom=19&center=${encodeURIComponent(address)}&key=${apiKey}`
}

/**
 * Normalize raw intelligence data into a structured property snapshot.
 */
export const normalizePropertySnapshot = (
  intelligence: ThreadIntelligenceRecord | null,
  thread: InboxWorkflowThread | null
): NormalizedPropertySnapshot => {
  const get = (key: string) => asString(intelligence?.[key] ?? (thread as any)?.[key], '').trim()
  const threadAddress = thread?.propertyAddressFull || thread?.propertyAddress || thread?.subject
  const intelligenceAddress = get('property_address_full') || get('address')
  const ownerAddressFallback = get('owner_mailing_address') || get('mailing_address') || get('owner_address')
  
  const address = (threadAddress || intelligenceAddress || ownerAddressFallback || '').trim()
  
  return {
    fullAddress: address,
    city: get('property_address_city') || get('property_city'),
    state: get('property_address_state') || get('property_state'),
    zip: get('property_address_zip') || get('property_zip'),
    market: get('market') || thread?.market || '',
    propertyType: get('property_type') || (thread as any)?.propertyType || '',
    propertyClass: get('property_class') || (thread as any)?.propertyClass || '',
    propertyStyle: get('property_style') || (thread as any)?.propertyStyle || '',
    beds: get('beds') || (thread as any)?.beds || '',
    baths: get('baths') || (thread as any)?.baths || '',
    sqft: get('sqft') || (thread as any)?.sqft || '',
    yearBuilt: get('year_built') || (thread as any)?.yearBuilt || '',
    effectiveYear: get('effective_year_built') || (thread as any)?.effectiveYear || '',
    estimatedValue: get('estimated_value') || (thread as any)?.estimatedValue || '',
    repairCost: get('estimated_repair_cost') || (thread as any)?.estimatedRepairCost || '',
    cashOffer: get('cash_offer') || (thread as any)?.cashOffer || '',
    finalScore: get('final_acquisition_score') || (thread as any)?.finalAcquisitionScore || '',
    streetViewUrl: buildStreetViewUrl(address),
    aerialViewUrl: buildAerialViewUrl(address),
    unitCount: get('units') || get('number_of_units') || get('unit_count') || '',
    lotSize: get('lot_size_square_feet') || get('lot_size_sqft') || '',
    lotSizeAcres: get('lot_size_acres') || '',
    occupancy: get('occupancy'),
    ownerType: get('owner_type'),
    zoning: get('zoning'),
    floodZone: get('flood_zone'),
    equityPercent: get('equity_percent') || (thread as any)?.equityPercent || '',
    equityAmount: get('estimated_equity_amount') || (thread as any)?.equityAmount || '',
    ownershipYears: get('ownership_years') || '',
  }
}


/**
 * Normalizes a thread message, ensuring delivery status and direction are canonical.
 */
export const normalizeThreadMessage = (message: ThreadMessage): ThreadMessage => {
  const status = String(message.deliveryStatus || message.rawStatus || 'unknown').toLowerCase()
  
  // Map various provider statuses to our canonical set: queued, pending, sent, delivered, failed
  let deliveryStatus = 'pending'
  if (status.includes('deliver')) deliveryStatus = 'delivered'
  else if (status.includes('sent') || status === 'success') deliveryStatus = 'sent'
  else if (status.includes('fail') || status.includes('undeliv')) deliveryStatus = 'failed'
  else if (status.includes('queue')) deliveryStatus = 'queued'
  else if (status === 'pending') deliveryStatus = 'pending'

  return {
    ...message,
    deliveryStatus
  }
}
