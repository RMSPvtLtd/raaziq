import assert from "node:assert/strict"
import test from "node:test"

import { buildRouteFeature, normalizePlace, parseCoordinates } from "../src/lib/map-data.ts"

test("place normalization makes equivalent geocoder cache keys", () => {
  assert.equal(normalizePlace("  Jinnah   International Airport, Karachi "), "jinnah international airport, karachi")
  assert.equal(normalizePlace("LAHORE"), "lahore")
})

test("geocoder coordinates reject invalid or missing values", () => {
  assert.deepEqual(parseCoordinates("67.0099", "24.8615"), [67.0099, 24.8615])
  assert.equal(parseCoordinates("181", "24"), null)
  assert.equal(parseCoordinates("67", "91"), null)
  assert.equal(parseCoordinates(undefined, "24"), null)
})

test("air route geometry contains endpoints only and no live position", () => {
  const feature = buildRouteFeature([67.0099, 24.8615], [55.2708, 25.2048])

  assert.equal(feature.geometry.type, "LineString")
  assert.deepEqual(feature.geometry.coordinates, [[67.0099, 24.8615], [55.2708, 25.2048]])
  assert.deepEqual(Object.keys(feature.properties), ["kind"])
  assert.equal(feature.properties.kind, "route")
})
