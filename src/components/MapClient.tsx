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

  // init map + event wiring (run once)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,

      /**
       * Needed for reliable `canvas.toDataURL()` snapshots.
       * MapLibre types expose this via canvasContextAttributes.
       */
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

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

      // retrigger pop animation
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
        // ignore snapshot errors (tainted canvas etc.)
      }
    }

    const openConfirmPopup = (lng: number, lat: number) => {
      clearPopup()

      const el = document.createElement('div')
      el.className = 'popup-card'

      const isBusy = useNarrationStore.getState().status === 'streaming'

      el.innerHTML = `
        <div class="popup-title">Generate guide?</div>
        <div class="popup-subtitle">This may take some time.</div>
        <button id="go" class="popup-btn" ${isBusy ? 'disabled' : ''}>
          ${isBusy ? 'Generating…' : 'Generate'}
        </button>
      `

      el.querySelector('#go')?.addEventListener('click', () => {
        // Re-check at click time (avoid stale state)
        if (useNarrationStore.getState().status === 'streaming') return

        clearPopup()
        capturePreviewBestEffort()

        // startNarration already clears text/meta/error + bumps runId
        void startNarration()
      })

      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat([lng, lat])
        .setDOMContent(el)
        .addTo(map)
    }

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

    const onClick = (e: maplibregl.MapMouseEvent) => {
      clearPopup()
      const { lng, lat } = e.lngLat
      selectPoint({ lon: lng, lat })
      setMarker(lng, lat)
    }

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

  return <div ref={containerRef} className="h-full w-full" />
}
