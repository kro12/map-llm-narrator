import type { MutableRefObject } from 'react'
import maplibregl from 'maplibre-gl'

/**
 * Set marker position. Creates the marker on first call.
 */
export function setMarker(
  markerRef: MutableRefObject<maplibregl.Marker | null>,
  map: maplibregl.Map,
  lng: number,
  lat: number,
): void {
  if (markerRef.current) {
    markerRef.current.setLngLat([lng, lat])
    return
  }

  const element = document.createElement('div')
  element.className = 'ml-location-marker'
  element.setAttribute('aria-label', 'Selected location')

  const core = document.createElement('span')
  core.className = 'ml-location-marker__core'
  element.appendChild(core)

  markerRef.current = new maplibregl.Marker({
    element,
    anchor: 'center',
  })
    .setLngLat([lng, lat])
    .addTo(map)
}

/**
 * Capture map preview as data URL (async, non-blocking).
 */
export function capturePreview(map: maplibregl.Map, onPreview?: (dataUrl: string) => void): void {
  if (!onPreview) return

  // Defer to next frame to avoid blocking click handler
  requestAnimationFrame(() => {
    try {
      const dataUrl = map.getCanvas().toDataURL('image/png')
      onPreview(dataUrl)
    } catch {
      // Ignore snapshot errors
    }
  })
}
