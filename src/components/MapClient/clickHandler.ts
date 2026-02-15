import maplibregl from 'maplibre-gl'
import { setMarker, capturePreview } from './markerUtils'

const MIN_ZOOM_TO_ENABLE = 13

export function setupClickHandler({
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
  const canSelect = () => map.getZoom() >= MIN_ZOOM_TO_ENABLE

  // const onClick = (e: maplibregl.MapMouseEvent) => {
  //   // Block marker placement until user zooms in
  //   if (!canSelect()) return

  //   const { lng, lat } = e.lngLat
  //   selectPoint({ lon: lng, lat })
  //   setMarker(markerRef, map, lng, lat)
  //   capturePreview(map, onPreview)
  // }

  // Block context menu (using floating panel UX instead)
  const onContextMenu = (e: maplibregl.MapMouseEvent) => {
    // Block marker placement until user zooms in
    if (!canSelect()) return

    const { lng, lat } = e.lngLat
    selectPoint({ lon: lng, lat })
    setMarker(markerRef, map, lng, lat)
    capturePreview(map, onPreview)
    // e.preventDefault()
  }

  // map.on('click', onClick)
  map.on('contextmenu', onContextMenu)

  return () => {
    // map.off('click', onClick)
    map.off('contextmenu', onContextMenu)
  }
}
