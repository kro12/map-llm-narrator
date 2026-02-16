import type { Poi } from '@/lib/shared/types'

/**
 * Minimal SVG marker icons matching the clean UI aesthetic.
 * All icons are 20x20 with 1.5px stroke weight for consistency.
 */

const iconStyle = {
  width: '20px',
  height: '20px',
  display: 'block',
}

export const MarkerIcons = {
  // Food & Drink
  restaurant: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.5 8.64V15.5a.5.5 0 0 0 1 0V9.14a1.5 1.5 0 0 0 1.5-1.5V4.5a.5.5 0 0 0-1 0v3.14a.5.5 0 0 1-1 0V4.5a.5.5 0 0 0-1 0v3.14a.5.5 0 0 1-1 0V4.5a.5.5 0 0 0-1 0v3.14a1.5 1.5 0 0 0 1.5 1.5v6.86a.5.5 0 0 0 1 0V8.64Z"
        fill="currentColor"
      />
      <path
        d="M13 4.5a.5.5 0 0 1 1 0V8a2 2 0 0 0 2 2v5.5a.5.5 0 0 1-1 0v-5h-2V15.5a.5.5 0 0 1-1 0V4.5h1Z"
        fill="currentColor"
      />
      <rect x="7" y="17" width="10" height="1" rx=".5" fill="currentColor" />
    </svg>
  ),

  cafe: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6 9h10v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 11h1a2 2 0 0 1 0 4h-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M6 9V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2M5 19h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),

  pub: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M9 3v2m6-2v2M9 5h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M6 8h12M6 13h12M12 19v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),

  bar: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6 9h12l-2 6H8L6 9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 15v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-4M5 9l2-5h10l2 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),

  // Attractions
  museum: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 21h16M4 12h16M12 3l-8 5h16l-8-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12v9M20 12v9M8 12v5M12 12v5M16 12v5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),

  castle: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 21h18M5 9h14M5 21V9M19 21V9M5 9V5h2v2h2V5h2v2h2V5h2v2h2V5h2v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 14v7h6v-7a3 3 0 0 0-6 0Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),

  monument: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3l4 10H8l4-10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 13l-2 5h12l-2-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path
        d="M6 18h12v2H6v-2ZM6 20h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),

  viewpoint: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),

  park: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3v18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),

  landmark: (
    <svg style={iconStyle} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2l-8 6v13h16V8l-8-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 21v-6a3 3 0 0 1 6 0v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
}

/**
 * Get marker color based on POI category.
 * Using neutral, minimal palette matching the UI.
 */
export function getMarkerColor(poi: Poi): string {
  if (poi.category === 'food') {
    return '#18181b' // zinc-900 - dark for food
  }
  // Attractions - slightly lighter
  return '#3f3f46' // zinc-700
}

/**
 * Get the appropriate SVG icon for a POI.
 */
export function getMarkerIcon(poi: Poi): React.ReactNode {
  if (poi.category === 'food') {
    switch (poi.foodKind) {
      case 'restaurant':
        return MarkerIcons.restaurant
      case 'cafe':
        return MarkerIcons.cafe
      case 'pub':
        return MarkerIcons.pub
      case 'bar':
        return MarkerIcons.bar
      default:
        return MarkerIcons.restaurant
    }
  }

  // Attractions
  switch (poi.bucket) {
    case 'culture':
      return MarkerIcons.museum
    case 'history':
      return MarkerIcons.castle
    case 'scenic':
      return MarkerIcons.viewpoint
    case 'park':
      return MarkerIcons.park
    default:
      return MarkerIcons.landmark
  }
}
