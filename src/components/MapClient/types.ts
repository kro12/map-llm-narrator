export type MapApi = {
  resetView: () => void
  fitToPois: (coords: Array<{ lon: number; lat: number }>) => void

  // POI hover affordance (desktop): pop a marker by id
  popPoi: (poiId: string) => void
  clearPoiPop: () => void
}

export type MarkerManager = {
  ensureMarker: () => maplibregl.Marker
  setMarker: (lng: number, lat: number) => void
}
