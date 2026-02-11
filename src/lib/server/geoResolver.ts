import { timed, debug } from '@/lib/server/debug'
import { withCacheJSON } from '@/lib/server/cache'
import type { LatLon } from '@/lib/shared/types'

type NominatimReverseResponse = {
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  address?: {
    // very local fields (often "too specific" for main UI label)
    neighbourhood?: string
    suburb?: string
    hamlet?: string
    locality?: string
    quarter?: string
    croft?: string
    isolated_dwelling?: string

    // settlement/admin fields
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

  /**
   * Backward-compat "short name".
   * We align this with `label` so UI stays settlement-level.
   */
  shortName: string

  /**
   * UI label: prefer settlement-level names (e.g. "Mousehole")
   * rather than ultra-local localities (e.g. "Raginnis").
   */
  label: string

  /**
   * Optional finer-grain locality (e.g. neighbourhood/hamlet/locality).
   * Useful for "near X" copy or extra context if you want it later.
   */
  fineLabel?: string

  /**
   * Broader context string designed to be stable and readable.
   * Example: "Penzance • England • United Kingdom"
   */
  context?: string

  countryCode?: string
  country?: string
  region?: string
}

/**
 * Choose a settlement-level label for display.
 *
 * Priority:
 * village → town → city → municipality → (then fall back to finer-grain fields)
 *
 * This prevents “too-local” labels (like a neighbourhood/locality) from
 * becoming the primary label when the user expects the nearby settlement.
 */
function labelFromAddress(addr?: NominatimReverseResponse['address']) {
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
 * We keep it separate so the UI can stay “human expected” while
 * still having a local hint available.
 */
function fineLabelFromAddress(addr?: NominatimReverseResponse['address']) {
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
function contextFromAddress(addr?: NominatimReverseResponse['address']) {
  const settlement = addr?.town || addr?.city || addr?.village || addr?.municipality
  const region = addr?.state || addr?.county
  const country = addr?.country

  const parts = [settlement, region, country].filter(Boolean)
  return parts.length ? parts.join(' • ') : undefined
}

function shortNameFromAddress(addr?: NominatimReverseResponse['address']) {
  const label = labelFromAddress(addr)
  const region = addr?.state ? `, ${addr.state}` : ''
  return `${label}${region}`
}

export async function reverseGeocode(
  point: LatLon,
): Promise<{ geo: GeoResult; cacheHit: boolean }> {
  // round coords so cache keys are stable for nearby clicks
  const lat = Number(point.lat.toFixed(5))
  const lon = Number(point.lon.toFixed(5))

  // IMPORTANT: bump cache version when label logic changes
  const key = `geo:v2:rev:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 * 7 // 7 days

  return await timed('nominatim.reverse', async () => {
    const { value, cacheHit } = await withCacheJSON<GeoResult>(key, ttlSeconds, async () => {
      const url = new URL('https://nominatim.openstreetmap.org/reverse')
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('lat', String(lat))
      url.searchParams.set('lon', String(lon))

      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          // NOTE: Some platforms may drop this header; fine to include anyway.
          'User-Agent': 'map-llm-narrator-demo/1.0 (github demo)',
        },
      })

      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

      const data = (await res.json()) as NominatimReverseResponse

      const displayName = data.display_name || data.name || shortNameFromAddress(data.address)

      const label = labelFromAddress(data.address)
      const fineLabel = fineLabelFromAddress(data.address)
      const shortName = shortNameFromAddress(data.address)

      const geo: GeoResult = {
        displayName,
        shortName,
        label,
        fineLabel,
        context: contextFromAddress(data.address),
        countryCode: data.address?.country_code?.toUpperCase(),
        country: data.address?.country,
        region: data.address?.state || data.address?.county,
      }

      return geo
    })

    debug('geoResolver', `cacheHit=${cacheHit}`, value)
    return { geo: value, cacheHit }
  })
}
