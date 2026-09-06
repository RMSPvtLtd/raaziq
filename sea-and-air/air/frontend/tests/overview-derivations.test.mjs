import test from "node:test"
import assert from "node:assert/strict"
import { deriveOverviewData } from "../src/lib/overview.ts"

const stages = [
  { stage: "inquiry", label: "Inquiry", group: null },
  { stage: "quotation", label: "Quotation", group: null },
  { stage: "arrival", label: "Arrival", group: "Airline" },
  { stage: "invoice_to_customer", label: "Invoice to Customer", group: null },
]

const shipment = (overrides = {}) => ({
  id: 1,
  customer_id: 10,
  inquiry_id: 20,
  quote_id: null,
  job_number: "RQ-1001",
  stage: "arrival",
  is_at_risk: false,
  risk_reason: null,
  priority: "low",
  carrier: "Skyline",
  voyage_flight_number: null,
  is_cancelled: false,
  cancelled_reason: null,
  customer_cancellation_note: null,
  cancelled_by: null,
  cancelled_at: null,
  is_on_hold: false,
  hold_reason: null,
  hold_created_by: null,
  hold_created_at: null,
  hold_removed_by: null,
  hold_removed_at: null,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
  references: [],
  status_events: [],
  ...overrides,
})

test("derives truthful metrics, deterministic attention order, and active lanes", () => {
  const result = deriveOverviewData(
    [
      shipment({
        id: 1,
        job_number: "RQ-1001",
        is_at_risk: true,
        priority: "medium",
        status_events: [{ id: 100, stage: "arrival", timestamp: "2026-09-01T10:00:00Z", actor: "ops", note: null, source: "manual", is_stage_change: true, is_internal: false }],
      }),
      shipment({ id: 2, job_number: "RQ-1002", is_on_hold: true, priority: "high", inquiry_id: 21 }),
      shipment({ id: 3, job_number: "RQ-1003", stage: "invoice_to_customer", inquiry_id: 21 }),
      shipment({ id: 4, job_number: "RQ-1004", is_cancelled: true }),
      shipment({ id: 5, job_number: "RQ-1005", is_on_hold: true, inquiry_id: 22 }),
    ],
    [
      { id: 10, name: "Acme", company_name: null, email: "acme@example.com", phone: null, address: null, username: null, portal_active: true, created_at: "", updated_at: "" },
    ],
    [
      { id: 20, customer_id: 10, origin: "Lahore", destination: "Dubai", mode: "air", cargo_type: "General", weight_kg: "1", volume_cbm: "1", dimensions: null, ready_date: null, incoterm: "CIP", description: null, hs_code: null, pieces: 1, supplier_name: null, supplier_address: null, created_at: "", updated_at: "" },
      { id: 21, customer_id: 10, origin: "Lahore", destination: "Dubai", mode: "air", cargo_type: "General", weight_kg: "1", volume_cbm: "1", dimensions: null, ready_date: null, incoterm: "CIP", description: null, hs_code: null, pieces: 1, supplier_name: null, supplier_address: null, created_at: "", updated_at: "" },
      { id: 22, customer_id: 10, origin: "Lahore", destination: "Dubai", mode: "sea", cargo_type: "General", weight_kg: "1", volume_cbm: "1", dimensions: null, ready_date: null, incoterm: "CIP", description: null, hs_code: null, pieces: 1, supplier_name: null, supplier_address: null, created_at: "", updated_at: "" },
    ],
    stages,
    new Date("2026-09-01T12:00:00Z"),
  )

  assert.deepEqual(result.metrics, { active: 3, atRisk: 1, onHold: 2, readyToInvoice: 1 })
  assert.deepEqual(result.attention.map((item) => item.shipment.job_number), ["RQ-1002", "RQ-1005", "RQ-1001"])
  assert.equal(result.attention.find((item) => item.shipment.id === 1)?.waitingMinutes, 120)
  assert.equal(result.lanes.length, 2)
  assert.deepEqual(result.lanes[0], {
    key: "Lahore→Dubai·air",
    origin: "Lahore",
    destination: "Dubai",
    mode: "air",
    active: 2,
    atRisk: 1,
    onHold: 1,
    shipmentIds: [1, 2],
  })
  assert.deepEqual(result.lanes[1], {
    key: "Lahore→Dubai·sea",
    origin: "Lahore",
    destination: "Dubai",
    mode: "sea",
    active: 1,
    atRisk: 0,
    onHold: 1,
    shipmentIds: [5],
  })
  assert.equal(result.pipeline.some((phase) => phase.count === 3), true)
})
