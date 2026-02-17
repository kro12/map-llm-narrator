import maplibregl from 'maplibre-gl'

/**
 * Set marker position with animation. Creates marker on first call.
 */
export function setMarker(
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
  map: maplibregl.Map,
  lng: number,
  lat: number,
): void {
  if (!markerRef.current) {
    // FIRST CLICK - Create marker, defer adding to map
    const el = document.createElement('div')
    el.className = 'ml-marker'

    markerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([
      lng,
      lat,
    ])

    // Add to map on next frame to avoid flash
    requestAnimationFrame(() => {
      if (markerRef.current) {
        markerRef.current.addTo(map)
      }
    })

    return
  }

  // SUBSEQUENT CLICKS - Just update position, no animation
  markerRef.current.setLngLat([lng, lat])
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
