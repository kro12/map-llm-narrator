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

  // POI marker refs
  const poiMarkersRef = useRef<maplibregl.Marker[]>([])
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const activeMarkerRef = useRef<HTMLElement | null>(null)
  const lastAutoFitKeyRef = useRef<string>('') // one-shot per POI key
  const poiMarkerByIdRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const activePopPoiIdRef = useRef<string | null>(null)

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

    const clearPop = () => {
      console.log('[MapClient] clearPoiPop')

      const prev = activePopPoiIdRef.current
      if (prev) poiMarkerByIdRef.current.get(prev)?.removeClassName('poi-pop') // MapLibre Marker API [web:137]
      activePopPoiIdRef.current = null
    }

    const popPoi = (poiId: string) => {
      console.log('[MapClient] popPoi', poiId)
      console.log('[MapClient] known ids', poiMarkerByIdRef.current.size)
      console.log('[MapClient] has?', poiMarkerByIdRef.current.has(poiId))
      if (!poiId) return
      if (activePopPoiIdRef.current === poiId) return
      clearPop()
      poiMarkerByIdRef.current.get(poiId)?.addClassName('poi-pop') // MapLibre Marker API [web:137]
      activePopPoiIdRef.current = poiId
    }

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
    const api = createMapApi(map, { popPoi, clearPoiPop: clearPop })
    onReadyRef.current?.(api)

    // POI markers (imperative, no React render)
    let markersVisible = false
    let lastKey = ''
    let closeTimeout: number | null = null

    const removeAll = () => {
      if (!markersVisible && poiMarkersRef.current.length === 0) return
      poiMarkersRef.current.forEach((m) => m.remove())
      poiMarkersRef.current = []
      markersVisible = false
      lastKey = ''
      poiMarkerByIdRef.current.clear()
      clearPop()
    }

    const fitToPoisOnce = (pois: Poi[], key: string) => {
      if (!pois.length) return
      if (lastAutoFitKeyRef.current === key) return
      lastAutoFitKeyRef.current = key

      const bounds = new maplibregl.LngLatBounds()
      pois.forEach((p) => bounds.extend([p.lon, p.lat])) // extend supports LngLatLike [web:117]

      // If all points are identical, fitBounds can feel odd; give it a tiny radius.
      if (bounds.getSouthWest().toArray().join(',') === bounds.getNorthEast().toArray().join(',')) {
        const [lon, lat] = [pois[0].lon, pois[0].lat]
        bounds.extend([lon - 0.001, lat - 0.001])
        bounds.extend([lon + 0.001, lat + 0.001])
      }

      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 60, right: 460 }, // room for drawer
        maxZoom: 15,
        duration: 900,
        linear: true, // true => easeTo, false => flyTo [web:99]
      }) // fitBounds pans/zooms to contain bounds [web:102]
    }

    const buildKey = (pois: Poi[]) =>
      pois
        .map(
          (p) =>
            `${p.name}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}|${p.category}|${p.bucket}|${p.foodKind ?? ''}`,
        )
        .join(';;')

    const hidePopover = () => {
      if (!popoverRef.current) return
      popoverRef.current.style.opacity = '0'
      popoverRef.current.style.pointerEvents = 'none'
      if (activeMarkerRef.current) {
        activeMarkerRef.current.style.transform = 'scale(1)'
        activeMarkerRef.current.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.12)'
      }
      activeMarkerRef.current = null
    }

    const cancelClose = () => {
      if (closeTimeout) {
        window.clearTimeout(closeTimeout)
        closeTimeout = null
      }
    }

    const scheduleClose = () => {
      cancelClose()
      closeTimeout = window.setTimeout(() => {
        hidePopover()
        closeTimeout = null
      }, 300)
    }

    const showPopover = (poi: Poi, markerEl: HTMLElement) => {
      if (!popoverRef.current) return
      cancelClose()

      activeMarkerRef.current = markerEl

      const categoryLabel = poi.category === 'food' ? poi.foodKind : poi.bucket
      const distanceText =
        poi.distanceKm < 1
          ? `${Math.round(poi.distanceKm * 1000)}m away`
          : `${poi.distanceKm.toFixed(1)}km away`

      popoverRef.current.innerHTML = `
        <div class="poi-popover-arrow"></div>
        <div class="poi-popover-name">${poi.name}</div>
        <div class="poi-popover-category">${categoryLabel || 'attraction'}</div>
        <div class="poi-popover-distance">${distanceText}</div>
        ${
          poi.osmUrl
            ? `<a href="${poi.osmUrl}" target="_blank" rel="noopener noreferrer" class="poi-popover-link">
                 View on OpenStreetMap →
               </a>`
            : ''
        }
      `

      const rect = markerEl.getBoundingClientRect()
      const popover = popoverRef.current
      const mapContainer = map.getContainer().getBoundingClientRect()

      popover.style.left = `${rect.left + rect.width / 2 - mapContainer.left}px`
      popover.style.top = `${rect.top - mapContainer.top - 12}px`
      popover.style.transform = 'translate(-50%, -100%)'
      popover.style.opacity = '1'
      popover.style.pointerEvents = 'auto'
    }

    const updatePOIMarkers = () => {
      const state = useNarrationStore.getState()
      const curated = state.meta?.curatedPOIs
      // show POIs to user as soon as values arrive - distraction whilst LLM computes, but better than showing nothing and then suddenly appearing markers later. Can iterate on this UX.
      const shouldShow = !!curated

      if (!shouldShow) {
        removeAll()
        hidePopover()
        return
      }

      const attractions = curated!.selectedAttractions ?? []
      const eateries = curated!.selectedEateries ?? []
      const pois: Poi[] = [...attractions, ...eateries]

      const key = buildKey(pois)
      // centre map on our returned POI locations, but only the first time we see this exact set of POIs (key)
      fitToPoisOnce(pois, key)

      if (key === lastKey) {
        markersVisible = true
        return
      }
      lastKey = key

      removeAll()

      if (!popoverRef.current) {
        const popover = document.createElement('div')
        popover.className = 'poi-popover-portal'
        popover.style.cssText = `
          position: absolute;
          z-index: 1000;
          opacity: 0;
          pointer-events: none;
          transition: opacity 150ms ease;
        `
        popover.addEventListener('mouseenter', cancelClose)
        popover.addEventListener('mouseleave', scheduleClose)
        map.getContainer().appendChild(popover)
        popoverRef.current = popover
      }

      pois.forEach((poi, index) => {
        const el = document.createElement('div')
        el.className = 'poi-marker-container'

        const inner = document.createElement('div')
        inner.className = 'poi-marker-inner'
        inner.style.cssText = `
          width: 36px;
          height: 36px;
          background-color: white;
          border: 1.5px solid ${getMarkerColor(poi)};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${getMarkerColor(poi)};
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
          transition: all 0.2s ease;
          animation: poi-marker-drop 0.6s ease-out ${index * 80}ms both;
        `
        inner.innerHTML = getMarkerSvg(poi)

        inner.addEventListener('mouseenter', () => {
          cancelClose()
          inner.style.transform = 'scale(1.1)'
          inner.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.16)'
          showPopover(poi, inner)
        })

        inner.addEventListener('mouseleave', () => {
          inner.style.transform = 'scale(1)'
          inner.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.12)'
          scheduleClose()
        })

        el.appendChild(inner)

        const poiId = `${poi.name}|${poi.lat.toFixed(5)}|${poi.lon.toFixed(5)}`
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([poi.lon, poi.lat])
          .addTo(map)

        poiMarkersRef.current.push(marker)
        poiMarkerByIdRef.current.set(poiId, marker)

        poiMarkersRef.current.push(marker)
      })

      markersVisible = true
    }

    const unsub = useNarrationStore.subscribe(updatePOIMarkers)
    updatePOIMarkers()

    return () => {
      map.off('zoomend', emitZoom)
      cleanupClick()
      cleanupTouch()
      poiMarkersRef.current.forEach((m) => m.remove())
      poiMarkersRef.current = []
      markerRef.current?.remove()
      markerRef.current = null
      unsub()
      if (popoverRef.current) popoverRef.current.remove()
      popoverRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="h-full w-full" />
}
