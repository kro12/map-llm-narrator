export type MapApi = {
  resetView: () => void
  fitToPois: (coords: Array<{ lon: number; lat: number }>) => void
}

export type MarkerManager = {
  ensureMarker: () => maplibregl.Marker
  setMarker: (lng: number, lat: number) => void
}
