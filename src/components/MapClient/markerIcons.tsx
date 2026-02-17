import type { Poi } from '@/lib/shared/types'

/**
 * Marker SVGs (string form) for MapLibre markers.
 * Uses currentColor so we can set el.style.color per POI.
 */

const svgBase = `width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"`

export const MarkerSvgs = {
  // Food & Drink
  restaurant: `
    <svg ${svgBase}>
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
  `,

  cafe: `
    <svg ${svgBase}>
      <path
        d="M6 9h10v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V9Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path
        d="M16 11h1a2 2 0 0 1 0 4h-1"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path
        d="M6 9V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2M5 19h14"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,

  pub: `
  <svg ${svgBase}>
    <!-- Glass -->
    <path
      d="M7 5l5 7v4M17 5l-5 7"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <!-- Base -->
    <path
      d="M9 20h6"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <!-- Rim line -->
    <path
      d="M7 5h10"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <!-- Olive -->
    <circle cx="12" cy="8" r="1" fill="currentColor" />
  </svg>
`,

  bar: `
  <svg ${svgBase}>
    <!-- Mug body -->
    <rect
      x="8" y="7" width="7" height="10" rx="1"
      stroke="currentColor"
      stroke-width="1.5"
      fill="none"
    />
    <!-- Handle -->
    <path
      d="M15 9h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"
      stroke="currentColor"
      stroke-width="1.5"
      fill="none"
    />
    <!-- Foam -->
    <path
      d="M8 7c0-.5.5-1 1-1h5c.5 0 1 .5 1 1"
      stroke="currentColor"
      stroke-width="1.5"
      fill="none"
    />
  </svg>
`,

  // Attractions
  museum: `
    <svg ${svgBase}>
      <path
        d="M4 21h16M4 12h16M12 3l-8 5h16l-8-5Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M4 12v9M20 12v9M8 12v5M12 12v5M16 12v5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,

  castle: `
    <svg ${svgBase}>
      <path
        d="M3 21h18M5 9h14M5 21V9M19 21V9M5 9V5h2v2h2V5h2v2h2V5h2v2h2V5h2v4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M9 14v7h6v-7a3 3 0 0 0-6 0Z" stroke="currentColor" stroke-width="1.5" />
    </svg>
  `,

  monument: `
    <svg ${svgBase}>
      <path d="M12 3l4 10H8l4-10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M8 13l-2 5h12l-2-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <path
        d="M6 18h12v2H6v-2ZM6 20h12"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,

  viewpoint: `
    <svg ${svgBase}>
      <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.5" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,

  park: `
    <svg ${svgBase}>
      <path d="M12 3v18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="8" cy="10" r="3.5" stroke="currentColor" stroke-width="1.5" />
      <circle cx="16" cy="10" r="3.5" stroke="currentColor" stroke-width="1.5" />
      <circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5" />
    </svg>
  `,

  landmark: `
    <svg ${svgBase}>
      <path
        d="M12 2l-8 6v13h16V8l-8-6Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M9 21v-6a3 3 0 0 1 6 0v6"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,
} as const

export function getMarkerColor(poi: Poi): string {
  // Matches your MUI slate theme: primary/main ~ #0f172a
  if (poi.category === 'food') return '#0f172a' // slate-900
  return '#334155' // slate-700
}

export function getMarkerSvg(poi: Poi): string {
  if (poi.category === 'food') {
    switch (poi.foodKind) {
      case 'restaurant':
        return MarkerSvgs.restaurant
      case 'cafe':
        return MarkerSvgs.cafe
      case 'pub':
        return MarkerSvgs.pub
      case 'bar':
        return MarkerSvgs.bar
      default:
        return MarkerSvgs.restaurant
    }
  }

  switch (poi.bucket) {
    case 'culture':
      return MarkerSvgs.museum
    case 'history':
      return MarkerSvgs.castle
    case 'scenic':
      return MarkerSvgs.viewpoint
    case 'park':
      return MarkerSvgs.park
    default:
      return MarkerSvgs.landmark
  }
}
