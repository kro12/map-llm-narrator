'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

const HOME_VIEW = {
  center: [-4.5, 54.5] as [number, number],
  zoom: 5,
}

const MIN_ZOOM_TO_ENABLE = 13

export type MapApi = {
  resetView: () => void
  fitToPois: (coords: Array<{ lon: number; lat: number }>) => void
}

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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    const emitZoom = () => onZoomEnd?.(map.getZoom())
    map.on('zoomend', emitZoom)

    // initial emit so UI is correct on load
    emitZoom()

    const ensureMarker = () => {
      if (markerRef.current) return markerRef.current
      const el = document.createElement('div')
      el.className = 'ml-marker'
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(HOME_VIEW.center)
        .addTo(map)
      return markerRef.current
    }

    const setMarker = (lng: number, lat: number) => {
      const marker = ensureMarker()
      marker.setLngLat([lng, lat])

      const el = marker.getElement()
      el.classList.remove('ml-marker-pop')
      void el.offsetWidth
      el.classList.add('ml-marker-pop')
    }

    const capturePreviewBestEffort = () => {
      try {
        const dataUrl = map.getCanvas().toDataURL('image/png')
        onPreview?.(dataUrl)
      } catch {
        // ignore snapshot errors
      }
    }

    const canSelect = () => map.getZoom() >= MIN_ZOOM_TO_ENABLE

    const onClick = (e: maplibregl.MapMouseEvent) => {
      // Block marker placement until user zooms in sufficiently
      if (!canSelect()) return

      const { lng, lat } = e.lngLat
      selectPoint({ lon: lng, lat })
      setMarker(lng, lat)

      // keep preview updated when marker moves
      capturePreviewBestEffort()
    }

    // Optional: block context menu entirely (we’re moving to the floating panel UX)
    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault()
    }

    map.on('click', onClick)
    map.on('contextmenu', onContextMenu)

    onReady?.({
      resetView: () => map.flyTo({ center: HOME_VIEW.center, zoom: HOME_VIEW.zoom, duration: 700 }),
      fitToPois: (coords) => {
        if (!coords.length) return
        const first = coords[0]
        const bounds = coords.reduce(
          (b, c) => b.extend([c.lon, c.lat] as [number, number]),
          new maplibregl.LngLatBounds([first.lon, first.lat], [first.lon, first.lat]),
        )

        map.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 460 },
          duration: 800,
        })
      },
    })

    // long-press selection (mobile) — also gated by zoom
    const canvas = map.getCanvasContainer()
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

      pressTimer = window.setTimeout(() => {
        if (!pressStart) return
        if (!canSelect()) {
          clearPress()
          return
        }

        const rect = canvas.getBoundingClientRect()
        const point = { x: pressStart.x - rect.left, y: pressStart.y - rect.top }
        const lngLat = map.unproject([point.x, point.y])

        const lng = lngLat.lng
        const lat = lngLat.lat

        selectPoint({ lon: lng, lat })
        setMarker(lng, lat)
        capturePreviewBestEffort()
        clearPress()
      }, 600)
    }

    const onTouchMove = (ev: TouchEvent) => {
      if (!pressStart || ev.touches.length !== 1) return
      const t = ev.touches[0]
      const dx = Math.abs(t.clientX - pressStart.x)
      const dy = Math.abs(t.clientY - pressStart.y)
      if (dx > 10 || dy > 10) clearPress()
    }

    const onTouchEnd = () => clearPress()
    const onTouchCancel = () => clearPress()

    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchmove', onTouchMove, { passive: true })
    canvas.addEventListener('touchend', onTouchEnd)
    canvas.addEventListener('touchcancel', onTouchCancel)

    mapRef.current = map

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchCancel)

      map.off('click', onClick)
      map.off('contextmenu', onContextMenu)
      map.off('zoomend', emitZoom)

      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onReady, onPreview, onZoomEnd, selectPoint])

  return <div ref={containerRef} className="h-full w-full" />
}
