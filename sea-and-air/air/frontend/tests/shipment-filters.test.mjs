import test from "node:test"
import assert from "node:assert/strict"
import { filterShipments, parseShipmentQuery, toShipmentSearchParams } from "../src/lib/shipment-filters.ts"

const shipments = [
  { id: 1, customer_id: 10, inquiry_id: 20, job_number: "RQ-1001", stage: "arrival", priority: "medium", is_at_risk: true, is_on_hold: false, is_cancelled: false, references: [{ value: "MAWB-AAA" }] },
  { id: 2, customer_id: 11, inquiry_id: 21, job_number: "RQ-1002", stage: "customs_clearance", priority: "medium", is_at_risk: false, is_on_hold: true, is_cancelled: false, references: [{ value: "BOX-BBB" }] },
  { id: 3, customer_id: 12, inquiry_id: 22, job_number: "RQ-1003", stage: "departure", priority: "high", is_at_risk: false, is_on_hold: false, is_cancelled: false, references: [] },
  { id: 4, customer_id: 13, inquiry_id: 23, job_number: "RQ-1004", stage: "invoice_to_customer", priority: "low", is_at_risk: false, is_on_hold: false, is_cancelled: false, references: [] },
  { id: 5, customer_id: 10, inquiry_id: 20, job_number: "RQ-1005", stage: "arrival", priority: "low", is_at_risk: false, is_on_hold: true, is_cancelled: false, references: [] },
  { id: 6, customer_id: 10, inquiry_id: 20, job_number: "RQ-1006", stage: "arrival", priority: "low", is_at_risk: false, is_on_hold: false, is_cancelled: true, references: [] },
]

const customers = [
  { id: 10, name: "Acme Foods" },
  { id: 11, name: "Blue Harbor" },
  { id: 12, name: "Cedar Works" },
  { id: 13, name: "Delta Retail" },
]

const inquiries = [
  { id: 20, origin: "Lahore", destination: "Dubai", mode: "air" },
  { id: 21, origin: "Lahore", destination: "Dubai", mode: "sea" },
  { id: 22, origin: "Karachi", destination: "London", mode: "air" },
  { id: 23, origin: "Karachi", destination: "London", mode: "air" },
]

const ids = (params) => filterShipments(shipments, customers, inquiries, parseShipmentQuery(new URLSearchParams(params))).map(({ id }) => id)

test("filters shipment rows by every supported control-tower query", () => {
  assert.deepEqual(ids("search=acme"), [1, 5, 6])
  assert.deepEqual(ids("search=box-bbb"), [2])
  assert.deepEqual(ids("at_risk=true"), [1])
  assert.deepEqual(ids("on_hold=true"), [2, 5])
  assert.deepEqual(ids("mode=sea"), [2])
  assert.deepEqual(ids("origin=Lahore&destination=Dubai"), [1, 2, 5, 6])
  assert.deepEqual(ids("stage=arrival"), [1, 5, 6])
  assert.deepEqual(ids("stage=customs_clearance,departure"), [2, 3])
  assert.deepEqual(ids("search=RQ-1004&mode=sea"), [])
})

test("ready-to-invoice filter excludes held and cancelled arrivals", () => {
  assert.deepEqual(ids("stage=arrival&ready_to_invoice=true"), [1])
})

test("Control Tower drill-down keeps the active-only scope", () => {
  assert.deepEqual(ids("active_only=true"), [1, 2, 3, 5])
  assert.deepEqual(ids("active_only=true&origin=Lahore&destination=Dubai"), [1, 2, 5])
  const query = parseShipmentQuery(new URLSearchParams("active_only=true&view=attention"))
  assert.deepEqual(parseShipmentQuery(toShipmentSearchParams(query)), query)
})

test("canonical shipment state round-trips every URL-backed control", () => {
  const query = parseShipmentQuery(new URLSearchParams("view=attention&priority=high&customer_id=10&origin=Lahore&destination=Dubai&mode=air&stage=arrival,departure&at_risk=false&on_hold=true&ready_to_invoice=true&search=RQ-1001"))
  const roundTrip = parseShipmentQuery(toShipmentSearchParams(query))

  assert.deepEqual(roundTrip, query)
  assert.equal(toShipmentSearchParams(query).toString(), "search=RQ-1001&view=attention&priority=high&customer_id=10&at_risk=false&on_hold=true&ready_to_invoice=true&mode=air&origin=Lahore&destination=Dubai&stage=arrival%2Cdeparture")
})

test("needs-attention quick view uses risk, hold, or high priority", () => {
  assert.deepEqual(ids("view=attention"), [1, 2, 3, 5])
  assert.deepEqual(ids("priority=high"), [3])
  assert.deepEqual(ids("customer_id=10&at_risk=false&on_hold=false"), [6])
})
