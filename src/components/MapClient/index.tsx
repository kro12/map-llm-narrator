'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'
import { initializeMap, createMapApi } from '@/components/MapClient/mapSetup'
import { setupClickHandler } from '@/components/MapClient/clickHandler'
import { setupTouchHandler } from '@/components/MapClient/touchHandler'
import type { MapApi } from '@/components/MapClient/types'
import type { Poi } from '@/lib/shared/types'
import { getMarkerColor, getMarkerSvg } from '@/components/MapClient/markerIcons'

export type { MapApi }

export default function MapClient({
  onReady,
  onPreview,
  onZoomEnd,
}: {
  onReady?: (api: MapApi) => void
  onPreview?: (dataUrl: string) => void
  onZoomEnd?: (zoom: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  // Callback refs (prevents re-init on prop changes)
  const onReadyRef = useRef(onReady)
  const onPreviewRef = useRef(onPreview)
  const onZoomEndRef = useRef(onZoomEnd)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    onPreviewRef.current = onPreview
  }, [onPreview])

  useEffect(() => {
    onZoomEndRef.current = onZoomEnd
  }, [onZoomEnd])

  // INIT MAP ONCE
  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return

    const map = initializeMap(containerRef.current)
    mapRef.current = map

    // Zoom handler
    const emitZoom = () => onZoomEndRef.current?.(map.getZoom())
    map.on('zoomend', emitZoom)
    emitZoom()

    // Click handler (map selection)
    const selectPoint = useNarrationStore.getState().selectPoint
    const cleanupClick = setupClickHandler({
      map,
      markerRef,
      selectPoint,
      onPreview: (dataUrl) => onPreviewRef.current?.(dataUrl),
    })

    // Touch handler (long-press)
    const cleanupTouch = setupTouchHandler({
      map,
      markerRef,
      selectPoint,
      onPreview: (dataUrl) => onPreviewRef.current?.(dataUrl),
    })

    // Provide API to parent
    const api = createMapApi(map)
    onReadyRef.current?.(api)

    // POI markers (imperative, no React render)
    const poiMarkersRef: maplibregl.Marker[] = []
    let markersVisible = false
    let lastKey = ''

    const removeAll = () => {
      if (!markersVisible && poiMarkersRef.length === 0) return
      poiMarkersRef.forEach((m) => m.remove())
      poiMarkersRef.length = 0
      markersVisible = false
      lastKey = ''
    }

    const buildKey = (pois: Poi[]) =>
      pois
        .map(
          (p) =>
            `${p.name}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}|${p.category}|${p.bucket}|${p.foodKind ?? ''}`,
        )
        .join(';;')

    const updatePOIMarkers = () => {
      const state = useNarrationStore.getState()

      // Only show POIs when guide is ready (prevents “previous POIs” lingering during new runs)
      const curated = state.meta?.curatedPOIs
      const shouldShow = state.status === 'done' && !!curated

      if (!shouldShow) {
        removeAll()
        return
      }

      const attractions = curated!.selectedAttractions ?? []
      const eateries = curated!.selectedEateries ?? []
      const pois: Poi[] = [...attractions, ...eateries]

      const key = buildKey(pois)
      if (key === lastKey) {
        markersVisible = true
        return
      }
      lastKey = key

      removeAll()

      pois.forEach((poi) => {
        const el = document.createElement('div')
        el.className = `poi-badge ${poi.category === 'food' ? 'poi-food' : 'poi-attraction'}`
        el.style.color = getMarkerColor(poi)
        el.title = poi.name

        // Centered SVG, uses currentColor
        el.innerHTML = getMarkerSvg(poi)

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([poi.lon, poi.lat])
          .addTo(map)

        poiMarkersRef.push(marker)
      })

      markersVisible = true
    }

    const unsub = useNarrationStore.subscribe(updatePOIMarkers)
    updatePOIMarkers()

    return () => {
      map.off('zoomend', emitZoom)
      cleanupClick()
      cleanupTouch()
      poiMarkersRef.forEach((m) => m.remove())
      markerRef.current?.remove()
      markerRef.current = null
      unsub()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="h-full w-full" />
}
