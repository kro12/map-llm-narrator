import maplibregl from 'maplibre-gl'
import { setMarker, capturePreview } from './markerUtils'

const MIN_ZOOM_TO_ENABLE = 13
const LONG_PRESS_DURATION_MS = 600
const MOVEMENT_THRESHOLD_PX = 10

export function setupTouchHandler({
  map,
  markerRef,
  selectPoint,
  onPreview,
}: {
  map: maplibregl.Map
  markerRef: React.MutableRefObject<maplibregl.Marker | null>
  selectPoint: (point: { lon: number; lat: number }) => void
  onPreview?: (dataUrl: string) => void
}): () => void {
  const canvas = map.getCanvasContainer()
  const canSelect = () => map.getZoom() >= MIN_ZOOM_TO_ENABLE

  let pressTimer: number | null = null
  let pressStart: { x: number; y: number } | null = null

  const clearPress = () => {
    if (pressTimer) window.clearTimeout(pressTimer)
    pressTimer = null
    pressStart = null
  }

  const onTouchStart = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) return

    pressStart = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }

    clearPress()
    pressTimer = window.setTimeout(() => {
      if (!pressStart || !canSelect()) {
        clearPress()
        return
      }

      const rect = canvas.getBoundingClientRect()
      const point = {
        x: pressStart.x - rect.left,
        y: pressStart.y - rect.top,
      }

      const lngLat = map.unproject([point.x, point.y])
      selectPoint({ lon: lngLat.lng, lat: lngLat.lat })
      setMarker(markerRef, map, lngLat.lng, lngLat.lat)
      capturePreview(map, onPreview)
      clearPress()
    }, LONG_PRESS_DURATION_MS)
  }

  const onTouchMove = (ev: TouchEvent) => {
    if (!pressStart || ev.touches.length !== 1) return

    const t = ev.touches[0]
    const dx = Math.abs(t.clientX - pressStart.x)
    const dy = Math.abs(t.clientY - pressStart.y)

    // Cancel long-press if finger moves too much
    if (dx > MOVEMENT_THRESHOLD_PX || dy > MOVEMENT_THRESHOLD_PX) {
      clearPress()
    }
  }

  const onTouchEnd = () => clearPress()
  const onTouchCancel = () => clearPress()

  canvas.addEventListener('touchstart', onTouchStart, { passive: true })
  canvas.addEventListener('touchmove', onTouchMove, { passive: true })
  canvas.addEventListener('touchend', onTouchEnd)
  canvas.addEventListener('touchcancel', onTouchCancel)

  return () => {
    clearPress()
    canvas.removeEventListener('touchstart', onTouchStart)
    canvas.removeEventListener('touchmove', onTouchMove)
    canvas.removeEventListener('touchend', onTouchEnd)
    canvas.removeEventListener('touchcancel', onTouchCancel)
  }
}
