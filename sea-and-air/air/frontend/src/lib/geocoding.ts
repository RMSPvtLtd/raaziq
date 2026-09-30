import { normalizePlace, parseCoordinates, type Coordinates } from "./map-data"

const STORAGE_PREFIX = "raaziq.geocode.v2:"
// City centroids from GeoNames, verified 2026-09-05. These are route endpoints,
// never airports, terminals, or vehicle positions. See MAPPING.md for provenance.
const BUILTIN_PLACES: Record<string, Coordinates> = {
  lhe: [74.350713, 31.557996],
  dxb: [55.309275, 25.07725],
  khi: [67.0104, 24.8608],
  lhr: [-0.12574, 51.50853],
  lahore: [74.350713, 31.557996],
  "lahore, pakistan": [74.350713, 31.557996],
  dubai: [55.309275, 25.07725],
  "dubai, united arab emirates": [55.309275, 25.07725],
  karachi: [67.0104, 24.8608],
  "karachi, pakistan": [67.0104, 24.8608],
  london: [-0.12574, 51.50853],
  "london, united kingdom": [-0.12574, 51.50853],
}

function readCache(key: string): Coordinates | null {
  try {
    const value = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    if (!value) return null
    const [longitude, latitude] = JSON.parse(value) as [number, number]
    return parseCoordinates(longitude, latitude)
  } catch {
    return null
  }
}

function writeCache(key: string, value: Coordinates) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in privacy mode; the map still works for this view.
  }
}

export async function geocodePlace(place: string, signal?: AbortSignal): Promise<Coordinates | null> {
  const key = normalizePlace(place)
  if (!key) return null
  const builtIn = Object.hasOwn(BUILTIN_PLACES, key) ? BUILTIN_PLACES[key] : null
  if (builtIn) return builtIn
  const cached = readCache(key)
  if (cached) return cached

  const endpoint = import.meta.env.VITE_GEOCODER_URL as string | undefined
  if (!endpoint) return null
  const url = new URL(endpoint)
  url.searchParams.set("name", place.trim())
  url.searchParams.set("count", "1")
  const apiKey = import.meta.env.VITE_GEOCODER_API_KEY as string | undefined
  if (apiKey) url.searchParams.set("apikey", apiKey)

  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) })
  if (!response.ok) return null
  const payload = await response.json() as { results?: { longitude?: number; latitude?: number }[] }
  const coordinates = parseCoordinates(payload.results?.[0]?.longitude, payload.results?.[0]?.latitude)
  if (coordinates) writeCache(key, coordinates)
  return coordinates
}
