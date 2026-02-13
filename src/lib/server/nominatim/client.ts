export type NominatimReverseResponse = {
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  address?: {
    // Very local fields (often "too specific" for main UI label)
    neighbourhood?: string
    suburb?: string
    hamlet?: string
    locality?: string
    quarter?: string
    croft?: string
    isolated_dwelling?: string

    // Settlement/admin fields
    village?: string
    town?: string
    city?: string
    municipality?: string
    county?: string
    state?: string

    country?: string
    country_code?: string
  }
}

export type GeoResult = {
  displayName: string
  shortName: string
  label: string
  fineLabel?: string
  context?: string
  countryCode?: string
  country?: string
  region?: string
}

/**
 * Fetch reverse geocoding data from Nominatim.
 */
export async function fetchNominatim(lat: number, lon: number): Promise<NominatimReverseResponse> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'map-llm-narrator-demo/1.0 (github demo)',
    },
  })

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

  return (await res.json()) as NominatimReverseResponse
}

/**
 * Build GeoResult from Nominatim response.
 */
export function buildGeoResult(data: NominatimReverseResponse): GeoResult {
  const label = labelFromAddress(data.address)
  const fineLabel = fineLabelFromAddress(data.address)
  const shortName = shortNameFromAddress(data.address)
  const displayName = data.display_name || data.name || shortName

  return {
    displayName,
    shortName,
    label,
    fineLabel,
    context: contextFromAddress(data.address),
    countryCode: data.address?.country_code?.toUpperCase(),
    country: data.address?.country,
    region: data.address?.state || data.address?.county,
  }
}

// ============================================================================
// Label extraction helpers
// ============================================================================

/**
 * Choose a settlement-level label for display.
 *
 * Priority: village → town → city → municipality → (then fall back to finer-grain fields)
 *
 * This prevents "too-local" labels (like a neighbourhood/locality) from
 * becoming the primary label when the user expects the nearby settlement.
 */
function labelFromAddress(addr?: NominatimReverseResponse['address']): string {
  return (
    addr?.village ||
    addr?.town ||
    addr?.city ||
    addr?.municipality ||
    addr?.suburb ||
    addr?.neighbourhood ||
    addr?.locality ||
    addr?.hamlet ||
    addr?.county ||
    'Unknown place'
  )
}

/**
 * Optional fine-grain label (more specific than `label` when available).
 * We keep it separate so the UI can stay "human expected" while
 * still having a local hint available.
 */
function fineLabelFromAddress(addr?: NominatimReverseResponse['address']): string | undefined {
  return (
    addr?.neighbourhood ||
    addr?.suburb ||
    addr?.locality ||
    addr?.quarter ||
    addr?.hamlet ||
    addr?.croft ||
    addr?.isolated_dwelling ||
    undefined
  )
}

/**
 * Context is broad + stable: nearby settlement, region, country.
 * We intentionally do NOT include the fineLabel here by default.
 */
function contextFromAddress(addr?: NominatimReverseResponse['address']): string | undefined {
  const settlement = addr?.town || addr?.city || addr?.village || addr?.municipality
  const region = addr?.state || addr?.county
  const country = addr?.country

  const parts = [settlement, region, country].filter(Boolean)
  return parts.length ? parts.join(' • ') : undefined
}

/**
 * Backward-compatible short name with optional state.
 */
function shortNameFromAddress(addr?: NominatimReverseResponse['address']): string {
  const label = labelFromAddress(addr)
  const region = addr?.state ? `, ${addr.state}` : ''
  return `${label}${region}`
}
