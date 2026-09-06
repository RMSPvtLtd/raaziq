import assert from "node:assert/strict"
import test from "node:test"
import { rateCardMatchesView } from "../src/lib/rate-card-views.ts"

const today = "2026-09-04"

test("rate-card views use an inclusive fourteen-day expiry window", () => {
  const current = { valid_from: "2026-09-01", valid_until: "2026-09-18" }
  assert.equal(rateCardMatchesView(current, "active", today), true)
  assert.equal(rateCardMatchesView(current, "expiring", today), true)
  assert.equal(rateCardMatchesView({ ...current, valid_until: "2026-09-19" }, "expiring", today), false)
  assert.equal(rateCardMatchesView({ ...current, valid_until: "2026-09-03" }, "expired", today), true)
  assert.equal(rateCardMatchesView({ ...current, valid_from: "2026-09-05" }, "active", today), false)
})
