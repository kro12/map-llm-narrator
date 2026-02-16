'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import * as Popover from '@radix-ui/react-popover'
import type { Poi } from '@/lib/shared/types'
import { getMarkerIcon, getMarkerColor } from './markerIcons'

type PoiMarkerProps = {
  poi: Poi
  map: maplibregl.Map
  animationDelay: number
}

/**
 * React component for a single POI marker with popover.
 * Minimal design matching the clean UI aesthetic.
 */
export function PoiMarker({ poi, map, animationDelay }: PoiMarkerProps) {
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const closeTimeoutRef = useRef<number | null>(null)

  const icon = getMarkerIcon(poi)
  const color = getMarkerColor(poi)
  const categoryLabel = poi.category === 'food' ? poi.foodKind : poi.bucket
  const distanceText =
    poi.distanceKm < 1
      ? `${Math.round(poi.distanceKm * 1000)}m away`
      : `${poi.distanceKm.toFixed(1)}km away`

  // Clear any pending close timeout
  const cancelClose = () => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  // Schedule closing the popover
  const scheduleClose = () => {
    cancelClose()
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false)
      closeTimeoutRef.current = null
    }, 300) // 300ms delay
  }

  // Handle marker hover
  const handleMarkerEnter = () => {
    cancelClose()
    setIsOpen(true)
  }

  const handleMarkerLeave = () => {
    scheduleClose()
  }

  // Handle popover hover
  const handlePopoverEnter = () => {
    cancelClose()
  }

  const handlePopoverLeave = () => {
    scheduleClose()
  }

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
      cancelClose()
    }
  }, [map, poi.lon, poi.lat])

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <div
          ref={containerRef}
          className="poi-marker-container"
          onMouseEnter={handleMarkerEnter}
          onMouseLeave={handleMarkerLeave}
        >
          <div
            className="poi-marker-inner"
            style={{
              width: '36px',
              height: '36px',
              backgroundColor: 'white',
              border: `1.5px solid ${color}`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
              transition: 'all 0.2s ease',
              animation: `poi-marker-drop 0.6s ease-out ${animationDelay}ms both`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.16)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.12)'
            }}
          >
            {icon}
          </div>
        </div>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="poi-popover-content"
          sideOffset={12}
          side="top"
          align="center"
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
          style={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px 14px',
            minWidth: '200px',
            maxWidth: '280px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              fontWeight: 500,
              fontSize: '14px',
              lineHeight: '1.4',
              marginBottom: '6px',
              color: '#18181b',
            }}
          >
            {poi.name}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#71717a',
              textTransform: 'capitalize',
              marginBottom: '2px',
            }}
          >
            {categoryLabel}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#a1a1aa',
              marginBottom: poi.osmUrl ? '10px' : '0',
            }}
          >
            {distanceText}
          </div>
          {poi.osmUrl && (
            <a
              href={poi.osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 10px',
                backgroundColor: 'white',
                color: '#18181b',
                fontSize: '12px',
                fontWeight: 500,
                textDecoration: 'none',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f9fafb'
                e.currentTarget.style.borderColor = '#d1d5db'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white'
                e.currentTarget.style.borderColor = '#e5e7eb'
              }}
            >
              View on OpenStreetMap →
            </a>
          )}
          <Popover.Arrow
            style={{ fill: 'white', filter: 'drop-shadow(0 -1px 1px rgba(0, 0, 0, 0.05))' }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
