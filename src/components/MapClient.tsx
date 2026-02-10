'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useNarrationStore } from '@/lib/store/narrationStore'

export default function MapClient() {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const selectPoint = useNarrationStore((s) => s.selectPoint)
  const startNarration = useNarrationStore((s) => s.startNarration)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-9.556158844499288, 52.0059965744475],
      zoom: 10,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }))

    map.on('click', (e) => {
      const lon = e.lngLat.lng
      const lat = e.lngLat.lat

      selectPoint({ lat, lon })
      void startNarration()
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [selectPoint, startNarration])

  return <div ref={containerRef} className="h-[520px] w-full rounded border" />
}
