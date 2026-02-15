import maplibregl from 'maplibre-gl'
import { HOME_VIEW } from './mapSetup'

/**
 * Ensure marker exists and return it.
 */
export function ensureMarker(
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
  map: maplibregl.Map,
): maplibregl.Marker {
  if (markerRef.current) return markerRef.current

  const el = document.createElement('div')
  el.className = 'ml-marker'

  markerRef.current = new maplibregl.Marker({ element: el })
    .setLngLat(HOME_VIEW.center)
    .addTo(map)

  return markerRef.current
}

/**
 * Set marker position with animation.
 */
export function setMarker(
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
  map: maplibregl.Map,
  lng: number,
  lat: number,
): void {
  const marker = ensureMarker(markerRef, map)
  marker.setLngLat([lng, lat])

  // Trigger CSS animation
  const el = marker.getElement()
  el.classList.remove('ml-marker-pop')
  void el.offsetWidth // Force reflow
  el.classList.add('ml-marker-pop')
}

/**
 * Capture map preview as data URL (best effort).
 */
export function capturePreview(map: maplibregl.Map, onPreview?: (dataUrl: string) => void): void {
  if (!onPreview) return

  try {
    const dataUrl = map.getCanvas().toDataURL('image/png')
    onPreview(dataUrl)
  } catch {
    // Ignore snapshot errors
  }
}
