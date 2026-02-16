'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import * as Popover from '@radix-ui/react-popover'
import type { Poi } from '@/lib/shared/types'

type PoiMarkerProps = {
  poi: Poi
  map: maplibregl.Map
  animationDelay: number
}

/**
 * Get marker style based on POI category.
 */
function getMarkerStyle(poi: Poi): { color: string; icon: string } {
  if (poi.category === 'food') {
    switch (poi.foodKind) {
      case 'restaurant':
        return { color: '#ef4444', icon: '🍽️' }
      case 'cafe':
        return { color: '#f59e0b', icon: '☕' }
      case 'pub':
        return { color: '#f97316', icon: '🍺' }
      case 'bar':
        return { color: '#ec4899', icon: '🍸' }
      default:
        return { color: '#ef4444', icon: '🍴' }
    }
  }

  // Attractions
  switch (poi.bucket) {
    case 'culture':
      return { color: '#8b5cf6', icon: '🎨' }
    case 'history':
      return { color: '#6366f1', icon: '🏛️' }
    case 'scenic':
      return { color: '#06b6d4', icon: '🌄' }
    case 'park':
      return { color: '#10b981', icon: '🌳' }
    default:
      return { color: '#3b82f6', icon: '📍' }
  }
}

/**
 * React component for a single POI marker with popover.
 */
export function PoiMarker({ poi, map, animationDelay }: PoiMarkerProps) {
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  const { color, icon } = getMarkerStyle(poi)
  const categoryLabel = poi.category === 'food' ? poi.foodKind : poi.bucket
  const distanceText =
    poi.distanceKm < 1
      ? `${Math.round(poi.distanceKm * 1000)}m away`
      : `${poi.distanceKm.toFixed(1)}km away`

  useEffect(() => {
    if (!containerRef.current) return

    // Create MapLibre marker
    const marker = new maplibregl.Marker({
      element: containerRef.current,
      anchor: 'center',
    })
      .setLngLat([poi.lon, poi.lat])
      .addTo(map)

    markerRef.current = marker

    return () => {
      marker.remove()
      markerRef.current = null
    }
  }, [map, poi.lon, poi.lat])

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <div
          ref={containerRef}
          className="poi-marker-container"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          <div
            className="poi-marker-inner"
            style={{
              width: '40px',
              height: '40px',
              backgroundColor: color,
              border: '3px solid white',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              cursor: 'pointer',
              boxShadow:
                '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              animation: `poi-marker-drop 0.6s ease-out ${animationDelay}ms both`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.15)'
              e.currentTarget.style.boxShadow =
                '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow =
                '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)'
            }}
          >
            {icon}
          </div>
        </div>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="poi-popover-content"
          sideOffset={8}
          side="top"
          align="center"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '12px',
            minWidth: '200px',
            boxShadow:
              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            zIndex: 1000,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px', color: '#1f2937' }}>
            {poi.name}
          </div>
          <div
            style={{
              fontSize: '13px',
              color: '#6b7280',
              textTransform: 'capitalize',
              marginBottom: '4px',
            }}
          >
            {categoryLabel}
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
            {distanceText}
          </div>
          {poi.osmUrl && (
            <a
              href={poi.osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                padding: '4px 8px',
                backgroundColor: '#3b82f6',
                color: 'white',
                fontSize: '12px',
                textDecoration: 'none',
                borderRadius: '4px',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#3b82f6'
              }}
            >
              View on OpenStreetMap →
            </a>
          )}
          <Popover.Arrow
            className="poi-popover-arrow"
            style={{ fill: 'white' }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}