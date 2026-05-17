// src/lib/data/censusData.ts

export interface CensusData {
  census_tract?: string;
  zip?: string;
  state?: string;
  county?: string;
  population?: number;
  population_density?: number;
  households?: number;
  housing_units?: number;
  vacant_units?: number;
  vacancy_rate?: number;
  owner_occupied_units?: number;
  owner_occupied_percent?: number;
  renter_occupied_units?: number;
  renter_occupied_percent?: number;
  median_household_income?: number;
  median_home_value?: number;
  median_gross_rent?: number;
  median_age?: number;
  poverty_rate?: number;
  education_bachelor_plus_percent?: number;
  language_non_english_percent?: number;
  investor_opportunity_score?: number;
  investor_signal_summary?: string;
}

export interface InvestorOpportunityResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'Watchlist';
  summary: string;
}

export function calculateInvestorOpportunityScore(data: Partial<CensusData>): InvestorOpportunityResult {
  let score = 50; // Base score
  const reasons: string[] = [];

  const vacancy = data.vacancy_rate ?? 0;
  const renterPercent = data.renter_occupied_percent ?? 0;
  const medianHomeValue = data.median_home_value ?? 0;
  const medianIncome = data.median_household_income ?? 0;
  const popDensity = data.population_density ?? 0;
  const poverty = data.poverty_rate ?? 0;

  // vacancy_rate high but not extreme = positive
  if (vacancy >= 8 && vacancy <= 15) {
    score += 15;
    reasons.push("Healthy transitional vacancy");
  } else if (vacancy > 15) {
    score -= 10;
    reasons.push("High vacancy risk");
  }

  // renter_occupied_percent high = rental demand signal
  if (renterPercent > 45) {
    score += 15;
    reasons.push("Strong rental demand");
  }

  // median_home_value below market average = opportunity signal
  if (medianHomeValue > 0 && medianHomeValue < 300000) {
    score += 10;
    reasons.push("Accessible entry price");
  } else if (medianHomeValue > 500000) {
    score -= 5;
    reasons.push("High capital requirement");
  }

  // median_income stable/moderate = buyer/renter strength
  if (medianIncome >= 45000 && medianIncome <= 90000) {
    score += 10;
    reasons.push("Stable middle-income base");
  }

  // population_density moderate/high = liquidity
  if (popDensity > 2000) {
    score += 10;
    reasons.push("High density liquidity");
  }

  // poverty_rate extreme = risk penalty
  if (poverty > 25) {
    score -= 20;
    reasons.push("Elevated economic risk");
  }

  score = Math.max(0, Math.min(100, score));

  let grade: 'A' | 'B' | 'C' | 'Watchlist' = 'Watchlist';
  if (score >= 80) grade = 'A';
  else if (score >= 60) grade = 'B';
  else if (score >= 40) grade = 'C';

  const summary = reasons.length > 0 
    ? `Rated ${grade} (${score}/100) due to: ${reasons.join(', ')}.`
    : `Rated ${grade} (${score}/100). No strong signals detected.`;

  return { score, grade, summary };
}

// TODO: Connect to real Supabase/Census API table
export async function loadCensusForProperty(property: any): Promise<CensusData | null> {
  // Return mock Census data shaped exactly like production data
  const mockData: CensusData = {
    census_tract: "1234567890",
    zip: property?.structure?.zip || "Unknown",
    state: property?.structure?.state || "Unknown",
    county: "Mock County",
    population: 34500,
    population_density: 3200,
    households: 12000,
    housing_units: 13500,
    vacant_units: 1500,
    vacancy_rate: 11.1,
    owner_occupied_units: 6000,
    owner_occupied_percent: 50,
    renter_occupied_units: 6000,
    renter_occupied_percent: 50,
    median_household_income: 62000,
    median_home_value: 285000,
    median_gross_rent: 1450,
    median_age: 34,
    poverty_rate: 14.5,
    education_bachelor_plus_percent: 28.4,
    language_non_english_percent: 12.1,
  };

  const { score, summary } = calculateInvestorOpportunityScore(mockData);
  mockData.investor_opportunity_score = score;
  mockData.investor_signal_summary = summary;

  return mockData;
}

// ── Extended metric type (all 9 layers) ───────────────────────────────────────
export type CensusMetricExtended =
  | 'income_heat'
  | 'vacancy_heat'
  | 'renter_density'
  | 'housing_age'
  | 'acquisition_pressure'
  | 'owner_occupancy'
  | 'median_home_value'
  | 'median_rent'
  | 'investor_opportunity'
  | 'census_heatmap'

export interface CensusMockPoint {
  id: string
  layer: 'census'
  label: string
  lat: number
  lng: number
  value: number
  score: number
  metric: CensusMetricExtended
  geo_level: string
  geo_key: string
  metadata: Record<string, number | null>
}

// ── Market clusters with demographic variance ─────────────────────────────────
const MOCK_CLUSTERS: Array<{ lat: number; lng: number; city: string; state: string; zip: string }> = [
  // Dallas-Fort Worth
  { lat: 32.776, lng: -96.797, city: 'Dallas', state: 'TX', zip: '75201' },
  { lat: 32.925, lng: -97.028, city: 'Fort Worth', state: 'TX', zip: '76101' },
  { lat: 32.684, lng: -97.108, city: 'Arlington', state: 'TX', zip: '76010' },
  // Atlanta
  { lat: 33.749, lng: -84.388, city: 'Atlanta', state: 'GA', zip: '30303' },
  { lat: 33.879, lng: -84.463, city: 'Marietta', state: 'GA', zip: '30060' },
  { lat: 33.638, lng: -84.434, city: 'College Park', state: 'GA', zip: '30337' },
  // Houston
  { lat: 29.760, lng: -95.369, city: 'Houston', state: 'TX', zip: '77002' },
  { lat: 29.708, lng: -95.415, city: 'Bellaire', state: 'TX', zip: '77401' },
  { lat: 29.923, lng: -95.575, city: 'Spring', state: 'TX', zip: '77373' },
  // Phoenix
  { lat: 33.448, lng: -112.074, city: 'Phoenix', state: 'AZ', zip: '85004' },
  { lat: 33.415, lng: -111.831, city: 'Mesa', state: 'AZ', zip: '85201' },
  { lat: 33.509, lng: -112.126, city: 'Glendale', state: 'AZ', zip: '85301' },
  // Charlotte
  { lat: 35.227, lng: -80.843, city: 'Charlotte', state: 'NC', zip: '28202' },
  { lat: 35.112, lng: -80.876, city: 'Pineville', state: 'NC', zip: '28134' },
  // Jacksonville
  { lat: 30.332, lng: -81.655, city: 'Jacksonville', state: 'FL', zip: '32202' },
  { lat: 30.238, lng: -81.548, city: 'Ponte Vedra', state: 'FL', zip: '32082' },
  // Kansas City
  { lat: 39.099, lng: -94.578, city: 'Kansas City', state: 'MO', zip: '64106' },
  { lat: 39.029, lng: -94.477, city: 'Independence', state: 'MO', zip: '64050' },
  // Memphis
  { lat: 35.149, lng: -90.048, city: 'Memphis', state: 'TN', zip: '38103' },
  { lat: 35.044, lng: -89.823, city: 'Germantown', state: 'TN', zip: '38138' },
]

// Seed-based deterministic jitter for stable mock positions
const jitter = (seed: number, range: number): number => {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return ((x - Math.floor(x)) - 0.5) * range
}

// Per-metric score distribution (simulates realistic data spread)
const METRIC_SCORE_RANGES: Record<CensusMetricExtended, [number, number]> = {
  income_heat:          [20, 85],
  vacancy_heat:         [10, 90],
  renter_density:       [25, 80],
  housing_age:          [30, 95],
  acquisition_pressure: [15, 90],
  owner_occupancy:      [20, 75],
  median_home_value:    [30, 80],
  median_rent:          [25, 85],
  investor_opportunity: [20, 95],
  census_heatmap:       [10, 100],
}

export function loadCensusMockPoints(metric: CensusMetricExtended): CensusMockPoint[] {
  const [minScore, maxScore] = METRIC_SCORE_RANGES[metric]
  const points: CensusMockPoint[] = []

  MOCK_CLUSTERS.forEach((cluster, clusterIdx) => {
    // 2–3 points per cluster with slight positional variation
    const pointCount = clusterIdx % 3 === 0 ? 3 : 2
    for (let i = 0; i < pointCount; i++) {
      const seed = clusterIdx * 17 + i * 7
      const lat = cluster.lat + jitter(seed, 0.08)
      const lng = cluster.lng + jitter(seed + 1, 0.10)
      const score = Math.round(minScore + ((seed * 13 % (maxScore - minScore + 1))))
      const value = deriveValueFromScore(metric, score)

      points.push({
        id: `mock-census-${metric}-${clusterIdx}-${i}`,
        layer: 'census',
        label: `${cluster.city}, ${cluster.state} ${cluster.zip}`,
        lat,
        lng,
        value,
        score,
        metric,
        geo_level: 'zcta',
        geo_key: cluster.zip,
        metadata: {
          income_heat_score: metric === 'income_heat' ? score : Math.round(30 + seed % 40),
          vacancy_heat_score: metric === 'vacancy_heat' ? score : Math.round(20 + seed % 50),
          renter_density_score: metric === 'renter_density' ? score : Math.round(25 + seed % 45),
          housing_age_score: metric === 'housing_age' ? score : Math.round(35 + seed % 40),
          acquisition_pressure_score: metric === 'acquisition_pressure' ? score : Math.round(20 + seed % 55),
          median_household_income: 35000 + (seed % 80) * 800,
          vacancy_rate: 6 + (seed % 12),
          renter_rate: 30 + (seed % 40),
          housing_age: 10 + (seed % 60),
        },
      })
    }
  })

  return points
}

function deriveValueFromScore(metric: CensusMetricExtended, score: number): number {
  switch (metric) {
    case 'income_heat':         return 25000 + score * 1800
    case 'vacancy_heat':        return score * 0.18
    case 'renter_density':      return score * 0.75
    case 'housing_age':         return score * 0.55
    case 'acquisition_pressure': return score
    case 'owner_occupancy':     return 100 - score * 0.6
    case 'median_home_value':   return 80000 + score * 3500
    case 'median_rent':         return 600 + score * 12
    case 'investor_opportunity': return score
    case 'census_heatmap':      return score
    default:                    return score
  }
}

export async function loadCensusForBounds(bounds: any): Promise<CensusData[]> {
  // Returns mock data for bounds — swap for real API call when census_geo_metrics is populated
  return [await loadCensusForProperty(bounds)] as CensusData[]
}
