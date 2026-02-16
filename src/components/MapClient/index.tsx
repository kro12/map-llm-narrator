'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'
import { initializeMap, createMapApi } from '@/components/MapClient/mapSetup'
import { setupClickHandler } from '@/components/MapClient/clickHandler'
import { setupTouchHandler } from '@/components/MapClient/touchHandler'
import { PoiMarkers } from '@/components/MapClient/poiMarkers'
import type { MapApi } from '@/components/MapClient/types'
import type { Poi } from '@/lib/shared/types'

export type { MapApi }

const EMPTY_POIS: Poi[] = []

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
  const apiRef = useRef<MapApi | null>(null)

  // Track map initialization state for rendering PoiMarkers
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)

  const selectPoint = useNarrationStore((s) => s.selectPoint)

  // Get POI data directly from store
  const curated = useNarrationStore((s) => s.meta?.curatedPOIs)
  const selectedEateries = curated?.selectedEateries ?? EMPTY_POIS
  const selectedAttractions = curated?.selectedAttractions ?? EMPTY_POIS

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = initializeMap(containerRef.current)
    mapRef.current = map
    setMapInstance(map) // Store in state for PoiMarkers

    // Emit initial zoom level
    const emitZoom = () => onZoomEnd?.(map.getZoom())
    map.on('zoomend', emitZoom)
    emitZoom()

    // Capture marker ref at start of effect for cleanup
    const markerRefValue = markerRef

    // Setup click handler
    const cleanupClick = setupClickHandler({
      map,
      markerRef,
      selectPoint,
      onPreview,
    })

    // Setup touch handler (mobile long-press)
    const cleanupTouch = setupTouchHandler({
      map,
      markerRef,
      selectPoint,
      onPreview,
    })

    // Create and provide API to parent
    const api = createMapApi(map)
    apiRef.current = api
    onReady?.(api)

    return () => {
      // Use captured ref
      const marker = markerRefValue.current

      map.off('zoomend', emitZoom)
      cleanupClick()
      cleanupTouch()
      marker?.remove()
      map.remove()
      mapRef.current = null
      apiRef.current = null
      setMapInstance(null)
    }
  }, [onReady, onPreview, onZoomEnd, selectPoint])

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      <PoiMarkers map={mapInstance} attractions={selectedAttractions} eateries={selectedEateries} />
    </>
  )
}
