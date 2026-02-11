'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

const HOME_VIEW = {
  center: [-4.5, 54.5] as [number, number],
  zoom: 5,
}

export type MapApi = {
  resetView: () => void
  fitToPois: (coords: Array<{ lon: number; lat: number }>) => void
}

export default function MapClient({
  onReady,
  onPreview,
}: {
  onReady?: (api: MapApi) => void
  onPreview?: (dataUrl: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)

  const selectPoint = useNarrationStore((s) => s.selectPoint)
  const startNarration = useNarrationStore((s) => s.startNarration)
  const status = useNarrationStore((s) => s.status)

  // init map + event wiring (run once)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    /**
     * Keep all map-specific helpers inside this effect so:
     * - ESLint doesn't require them as dependencies
     * - their closures always reference the correct `map`
     * - we avoid function identity changes across renders
     */
    const clearPopup = () => {
      popupRef.current?.remove()
      popupRef.current = null
    }

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

      // Retrigger pop animation
      const el = marker.getElement()
      el.classList.remove('ml-marker-pop')
      void el.offsetWidth // force reflow
      el.classList.add('ml-marker-pop')
    }

    const openConfirmPopup = (lng: number, lat: number) => {
      clearPopup()

      const el = document.createElement('div')
      el.className = 'popup-card'
      el.innerHTML = `
        <div class="popup-title">Generate narration?</div>
        <div class="popup-subtitle">This may take some time.</div>
        <button id="go" class="popup-btn">Generate</button>
      `

      el.querySelector('#go')?.addEventListener('click', () => {
        clearPopup()

        // Capture a quick map snapshot for the drawer (best-effort)
        try {
          const dataUrl = map.getCanvas().toDataURL('image/png')
          onPreview?.(dataUrl)
        } catch {
          // Ignore snapshot errors (e.g. tainted canvas)
        }

        void startNarration()
      })

      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat([lng, lat])
        .setDOMContent(el)
        .addTo(map)
    }

    // expose API to parent (header "Reset view", fit-to-POIs, etc.)
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
          padding: { top: 80, bottom: 80, left: 80, right: 460 }, // allow for drawer
          duration: 800,
        })
      },
    })

    // left click selects (no narration)
    const onClick = (e: maplibregl.MapMouseEvent) => {
      clearPopup()
      const { lng, lat } = e.lngLat
      selectPoint({ lon: lng, lat })
      setMarker(lng, lat)
    }

    // right click (desktop) opens confirm popup
    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault()
      const { lng, lat } = e.lngLat
      selectPoint({ lon: lng, lat })
      setMarker(lng, lat)
      openConfirmPopup(lng, lat)
    }

    map.on('click', onClick)
    map.on('contextmenu', onContextMenu)

    // long-press confirm (mobile)
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
      const t = ev.touches[0]
      pressStart = { x: t.clientX, y: t.clientY }

      pressTimer = window.setTimeout(() => {
        if (!pressStart) return
        const rect = canvas.getBoundingClientRect()
        const point = { x: pressStart.x - rect.left, y: pressStart.y - rect.top }
        const lngLat = map.unproject([point.x, point.y])

        const lng = lngLat.lng
        const lat = lngLat.lat

        selectPoint({ lon: lng, lat })
        setMarker(lng, lat)
        openConfirmPopup(lng, lat)
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

      clearPopup()
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onReady, onPreview, selectPoint, startNarration])

  // recenter when streaming starts (accounts for drawer)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (status !== 'streaming') return

    const center = map.getCenter()
    const pxShift = map.getCanvas().clientWidth * 0.25
    const newCenter = map.unproject([map.project(center).x + pxShift, map.project(center).y])

    map.easeTo({ center: newCenter, duration: 500 })
  }, [status])

  return <div ref={containerRef} className="h-full w-full" />
}
