import assert from "node:assert/strict"
import test from "node:test"
import { copyRateForToday, rateCardMatchesView } from "../src/lib/rate-card-views.ts"

const today = "2026-09-04"

test("daily rate copies preserve prior prices and isolate editable charges", () => {
  const original = { origin: "LHE", destination: "DXB", carrier: "EMIRATES", mode: "air" as const,
    currency: "USD", minimum_charge: "50", valid_from: "2026-09-03", valid_until: "2026-09-03",
    breaks: [{ min_weight: "0", max_weight: null, min_volume: null, max_volume: null,
      unit: "per_kg" as const, rate: "5", description: "FREIGHT" }],
    charges: [{ kind: "handling" as const, description: "HANDLING", amount: "20", basis: "flat" as const }] }
  const copy = copyRateForToday(original, today)
  assert.equal(copy.valid_from, today)
  assert.equal(copy.valid_until, today)
  copy.breaks[0].rate = "7"
  copy.charges[0].amount = "30"
  assert.equal(original.breaks[0].rate, "5")
  assert.equal(original.charges[0].amount, "20")
  assert.equal(original.valid_until, "2026-09-03")
})

test("rate-card views use an inclusive fourteen-day expiry window", () => {
  const current = { valid_from: "2026-09-01", valid_until: "2026-09-18" }
  assert.equal(rateCardMatchesView(current, "active", today), true)
  assert.equal(rateCardMatchesView(current, "expiring", today), true)
  assert.equal(rateCardMatchesView({ ...current, valid_until: "2026-09-19" }, "expiring", today), false)
  assert.equal(rateCardMatchesView({ ...current, valid_until: "2026-09-03" }, "expired", today), true)
  assert.equal(rateCardMatchesView({ ...current, valid_from: "2026-09-05" }, "active", today), false)
})
