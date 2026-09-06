import assert from "node:assert/strict"
import test from "node:test"

import { attentionText, customerJourneyState, formatWaitingAge, journeyRail, needsAttention, quickViewCounts, stageEnteredAt, withShipmentSearch } from "../src/lib/shipment-operations.ts"

test("quick views count real shipment states", () => {
  const counts = quickViewCounts([
    { stage: "arrival", is_at_risk: true, is_on_hold: false, is_cancelled: false, priority: "high" },
    { stage: "arrival", is_at_risk: false, is_on_hold: true, is_cancelled: false, priority: "medium" },
    { stage: "arrival", is_at_risk: false, is_on_hold: false, is_cancelled: true, priority: "medium" },
    { stage: "invoice_to_customer", is_at_risk: false, is_on_hold: false, is_cancelled: false, priority: "medium" },
    { stage: "departure", is_at_risk: false, is_on_hold: true, is_cancelled: false, priority: "low" },
  ])

  assert.deepEqual(counts, {
    all: 5,
    attention: 3,
    atRisk: 1,
    onHold: 2,
    highPriority: 1,
    readyToInvoice: 1,
    completed: 1,
  })
})

test("cancelled customer journeys expose no future progression", () => {
  const checklist = [
    { stage: "pickup", status: "completed" },
    { stage: "airport", status: "current" },
    { stage: "departure", status: "upcoming" },
  ] as const

  assert.deepEqual(customerJourneyState(checklist, true), { items: checklist.slice(0, 2), next: undefined })
  assert.deepEqual(customerJourneyState(checklist, false), { items: checklist, next: checklist[2] })
})

test("waiting age uses the latest current-stage entry only", () => {
  const enteredAt = stageEnteredAt(
    "customs_clearance",
    [
      { stage: "customs_clearance", timestamp: "2026-09-01T08:00:00Z", is_stage_change: true },
      { stage: "customs_clearance", timestamp: "2026-09-01T09:00:00Z", is_stage_change: false },
      { stage: "departure", timestamp: "2026-09-01T10:00:00Z", is_stage_change: true },
    ],
  )

  assert.equal(enteredAt, "2026-09-01T08:00:00Z")
  assert.equal(formatWaitingAge(enteredAt, new Date("2026-09-01T10:31:00Z")), "2h 31m")
})

test("journey rail condenses consecutive stage groups while preserving the current group", () => {
  const rail = journeyRail(
    [
      { stage: "inquiry", label: "Inquiry", group: "Booked" },
      { stage: "quotation", label: "Quotation", group: "Booked" },
      { stage: "customs_clearance", label: "Customs clearance", group: "Customs" },
      { stage: "departure", label: "Departure", group: "Transit" },
    ],
    "customs_clearance",
  )

  assert.deepEqual(rail, [
    { label: "Booked", state: "completed" },
    { label: "Customs", state: "current" },
    { label: "Transit", state: "upcoming" },
  ])
})

test("attention text names risk, holds, and high priority", () => {
  assert.equal(attentionText({ is_at_risk: true, is_on_hold: true }), "On hold · At risk")
  assert.equal(attentionText({ is_at_risk: false, is_on_hold: false }), null)
  assert.equal(attentionText({ is_at_risk: false, is_on_hold: false, priority: "high" }), "High priority")
  assert.equal(attentionText({ is_at_risk: true, is_on_hold: true, priority: "high" }), "On hold · At risk · High priority")
})

test("attention is one shared risk, hold, or high-priority rule", () => {
  assert.equal(needsAttention({ is_at_risk: false, is_on_hold: false, priority: "high" }), true)
  assert.equal(needsAttention({ is_at_risk: true, is_on_hold: false, priority: "low" }), true)
  assert.equal(needsAttention({ is_at_risk: false, is_on_hold: true, priority: "low" }), true)
  assert.equal(needsAttention({ is_at_risk: false, is_on_hold: false, priority: "medium" }), false)
})

test("shipment search updates preserve multiword drafts and existing URL filters", () => {
  const params = withShipmentSearch(new URLSearchParams("at_risk=true&mode=air"), "Hamid Motors")

  assert.equal(params.get("search"), "Hamid Motors")
  assert.equal(params.get("at_risk"), "true")
  assert.equal(params.get("mode"), "air")
})
