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
  if (!address || !GOOGLE_MAPS_API_KEY) return null
  return `https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${encodeURIComponent(address)}&fov=70&key=${GOOGLE_MAPS_API_KEY}`
}

/**
 * Normalize raw intelligence data into a structured property snapshot.
 */
export const normalizePropertySnapshot = (
  intelligence: ThreadIntelligenceRecord | null,
  thread: InboxWorkflowThread | null
): NormalizedPropertySnapshot => {
  const get = (key: string) => asString(intelligence?.[key], '').trim()
  const threadAddress = thread?.propertyAddress || thread?.subject
  const intelligenceAddress = get('property_address_full') || get('address')
  const ownerAddressFallback = get('owner_mailing_address') || get('mailing_address') || get('owner_address')
  
  const address = (threadAddress || intelligenceAddress || ownerAddressFallback || '').trim()
  
  return {
    fullAddress: address,
    city: get('property_city'),
    state: get('property_state'),
    zip: get('property_zip'),
    market: get('market') || thread?.market || '',
    propertyType: get('property_type') || (thread as any).propertyType || '',
    beds: (thread as any).beds || get('beds'),
    baths: (thread as any).baths || get('baths'),
    sqft: (thread as any).sqft || get('sqft'),
    yearBuilt: (thread as any).yearBuilt || get('year_built'),
    effectiveYear: get('effective_year_built'),
    estimatedValue: (thread as any).estimatedValue || get('estimated_value'),
    repairCost: (thread as any).estimatedRepairCost || get('estimated_repair_cost'),
    cashOffer: (thread as any).cashOffer || get('cash_offer'),
    finalScore: (thread as any).finalAcquisitionScore || get('final_acquisition_score'),
    streetViewUrl: buildStreetViewUrl(address)
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
