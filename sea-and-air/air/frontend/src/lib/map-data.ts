export type Coordinates = [longitude: number, latitude: number]

export interface RouteFeature {
  type: "Feature"
  properties: { kind: "route" }
  geometry: { type: "LineString"; coordinates: Coordinates[] }
}

export function normalizePlace(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

export function parseCoordinates(longitude: string | number | undefined, latitude: string | number | undefined): Coordinates | null {
  if (longitude === undefined || latitude === undefined || longitude === null || latitude === null || String(longitude).trim() === "" || String(latitude).trim() === "") return null
  const lng = Number(longitude)
  const lat = Number(latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  return [lng, lat]
}

export function buildRouteFeature(origin: Coordinates, destination: Coordinates): RouteFeature {
  return {
    type: "Feature",
    properties: { kind: "route" },
    geometry: { type: "LineString", coordinates: [origin, destination] },
  }
}
