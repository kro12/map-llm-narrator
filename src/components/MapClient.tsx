'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

// Reasonable “home” view for first load
const HOME_VIEW = {
  center: [-4.5, 54.5] as [number, number], // UK/Ireland-ish
  zoom: 5,
}

export default function MapClient() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)

  const selectPoint = useNarrationStore((s) => s.selectPoint)
  const startNarration = useNarrationStore((s) => s.startNarration)
  const status = useNarrationStore((s) => s.status)

  // --- helpers ----------------------------------------------------

  const clearPopup = () => {
    popupRef.current?.remove()
    popupRef.current = null
  }

  const setMarker = (lng: number, lat: number, map: maplibregl.Map) => {
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#0f172a' })
        .setLngLat([lng, lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([lng, lat])
    }
  }

  // --- init map ---------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Left click: select only
    map.on('click', (e) => {
      clearPopup()
      const { lng, lat } = e.lngLat
      selectPoint({ lon: lng, lat })
      setMarker(lng, lat, map)
    })

    // Right click: confirm narration
    map.on('contextmenu', (e) => {
      e.preventDefault()
      clearPopup()

      const { lng, lat } = e.lngLat
      selectPoint({ lon: lng, lat })
      setMarker(lng, lat, map)

      const el = document.createElement('div')
      el.className = 'text-sm text-slate-900'
      el.innerHTML = `
        <div style="min-width: 180px">
          <div style="font-weight: 600; margin-bottom: 6px;">Generate narration?</div>
          <div style="opacity: 0.75; margin-bottom: 10px;">
            This may take some time.
          </div>
          <button
            id="go"
            style="
              width: 100%;
              padding: 8px 10px;
              border-radius: 8px;
              background: #0f172a;
              color: white;
              font-weight: 600;
              cursor: pointer;
            "
          >
            Generate
          </button>
        </div>
      `

      el.querySelector('#go')?.addEventListener('click', () => {
        clearPopup()
        void startNarration()
      })

      popupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
      })
        .setLngLat([lng, lat])
        .setDOMContent(el)
        .addTo(map)
    })

    mapRef.current = map

    return () => {
      clearPopup()
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [selectPoint, startNarration])

  // --- react to narration start (recenter map) --------------------

  useEffect(() => {
    if (!mapRef.current) return
    if (status !== 'streaming') return

    const map = mapRef.current
    const center = map.getCenter()

    // Shift center left ~25% of viewport width
    const pxShift = map.getCanvas().clientWidth * 0.25
    const newCenter = map.unproject([map.project(center).x + pxShift, map.project(center).y])

    map.easeTo({
      center: newCenter,
      duration: 500,
    })
  }, [status])

  return <div ref={containerRef} className="h-full w-full" />
}
