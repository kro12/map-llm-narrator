import maplibregl from 'maplibre-gl'
import type { MapApi } from './types'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

export const HOME_VIEW = {
  center: [-4.5, 54.5] as [number, number],
  zoom: 5,
}

/**
 * Initialize MapLibre map with standard config.
 */
export function initializeMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: HOME_VIEW.center,
    zoom: HOME_VIEW.zoom,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })

  map.addControl(new maplibregl.NavigationControl(), 'top-right')

  return map
}

/**
 * Create public API for map control.
 */
export function createMapApi(map: maplibregl.Map): MapApi {
  return {
    resetView: () => {
      map.flyTo({
        center: HOME_VIEW.center,
        zoom: HOME_VIEW.zoom,
        duration: 700,
      })
    },

    fitToPois: (coords) => {
      if (!coords.length) return

      const first = coords[0]
      const bounds = coords.reduce(
        (b, c) => b.extend([c.lon, c.lat] as [number, number]),
        new maplibregl.LngLatBounds([first.lon, first.lat], [first.lon, first.lat]),
      )

      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 80, right: 460 },
        duration: 800,
      })
    },
  }
}
