'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'
import { initializeMap, createMapApi } from './mapSetup'
import { setupClickHandler } from './clickHandler'
import { setupTouchHandler } from './touchHandler'
import type { MapApi } from './types'

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

  const selectPoint = useNarrationStore((s) => s.selectPoint)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = initializeMap(containerRef.current)
    mapRef.current = map

    // Emit initial zoom level
    const emitZoom = () => onZoomEnd?.(map.getZoom())
    map.on('zoomend', emitZoom)
    emitZoom()

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

    // Provide API to parent
    onReady?.(createMapApi(map))

    const currentMarkerRef = markerRef.current

    return () => {
      map.off('zoomend', emitZoom)
      cleanupClick()
      cleanupTouch()
      currentMarkerRef?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onReady, onPreview, onZoomEnd, selectPoint])

  return <div ref={containerRef} className="h-full w-full" />
}
