import assert from "node:assert/strict"
import test from "node:test"
import { formatDate, formatDateTime, formatRelativeTime } from "../src/lib/format.ts"
import { formatWaitingAge } from "../src/lib/shipment-operations.ts"
import { deriveOverviewData } from "../src/lib/overview.ts"
import type { Shipment } from "../src/lib/api/types.ts"

test("UTC API timestamps keep the same age and display without an explicit offset", (t) => {
  const previousTimezone = process.env.TZ
  process.env.TZ = "Asia/Karachi"
  t.after(() => {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  })
  const now = new Date("2026-09-06T12:02:00Z")
  t.mock.method(Date, "now", () => now.getTime())

  assert.equal(formatRelativeTime("2026-09-06T12:00:00"), "2 minutes ago")
  assert.equal(formatDateTime("2026-09-06T12:00:00"), formatDateTime("2026-09-06T17:00:00+05:00"))
  assert.equal(formatWaitingAge("2026-09-06T12:00:00.000000", now), "2m")
  assert.equal(formatRelativeTime("invalid"), "invalid")
  assert.equal(formatWaitingAge("invalid", now), "—")

  const shipment = {
    id: 1, stage: "arrival", priority: "high", is_cancelled: false,
    is_at_risk: false, is_on_hold: false, updated_at: "2026-09-06T12:00:00",
    status_events: [],
  } as unknown as Shipment
  assert.equal(deriveOverviewData([shipment], [], [], [], now).attention[0].waitingMinutes, 2)
  shipment.status_events = [{ stage: "arrival", timestamp: "2026-09-06T12:01:00", is_stage_change: true }] as Shipment["status_events"]
  assert.equal(deriveOverviewData([shipment], [], [], [], now).attention[0].waitingMinutes, 1)

  process.env.TZ = "America/Los_Angeles"
  assert.equal(formatDate("2026-09-06"), "Sep 06, 2026")
  assert.equal(formatDate("2026-09-06T01:00:00"), "Sep 05, 2026")
})
