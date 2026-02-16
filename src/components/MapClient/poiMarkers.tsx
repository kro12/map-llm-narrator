'use client'

import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { PoiMarker } from './poiMarker'
import type { Poi } from '@/lib/shared/types'

type PoiMarkersProps = {
  map: maplibregl.Map | null
  attractions: Poi[]
  eateries: Poi[]
}

/**
 * Inject animation keyframes if not already present.
 */
function injectAnimationStyles() {
  if (typeof document === 'undefined') return
  
  const styleId = 'poi-marker-animations'
  if (document.getElementById(styleId)) return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    @keyframes poi-marker-drop {
      0% {
        opacity: 0;
        transform: scale(0);
      }
      50% {
        opacity: 1;
        transform: scale(1.2);
      }
      70% {
        transform: scale(0.9);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }
  `
  document.head.appendChild(style)
}

/**
 * Container component that renders all POI markers.
 */
export function PoiMarkers({ map, attractions, eateries }: PoiMarkersProps) {
  useEffect(() => {
    injectAnimationStyles()
  }, [])

  if (!map) return null

  const allPois = [...attractions, ...eateries]

  return (
    <>
      {allPois.map((poi, index) => (
        <PoiMarker
          key={`${poi.category}-${poi.lat}-${poi.lon}-${poi.name}`}
          poi={poi}
          map={map}
          animationDelay={index * 80}
        />
      ))}
    </>
  )
}