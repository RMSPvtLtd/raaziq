import type { Customer, Inquiry, Priority, Shipment, ShipmentStage, TransportMode } from "./api/types"
import { needsAttention } from "./shipment-operations.ts"

export type ShipmentQuickView = "all" | "attention" | "atRisk" | "onHold" | "highPriority" | "readyToInvoice" | "completed"

export interface ShipmentQuery {
  search: string
  activeOnly: boolean
  view: ShipmentQuickView
  priority?: Priority
  customerId?: number
  atRisk?: boolean
  onHold?: boolean
  readyToInvoice: boolean
  mode?: TransportMode
  origin?: string
  destination?: string
  stages: ShipmentStage[]
}

const text = (value: string | null | undefined) => value?.trim().toLocaleLowerCase() ?? ""
const QUICK_VIEWS = new Set<ShipmentQuickView>(["all", "attention", "atRisk", "onHold", "highPriority", "readyToInvoice", "completed"])
const PRIORITIES = new Set<Priority>(["low", "medium", "high"])
const MODES = new Set<TransportMode>(["air", "sea", "road"])

function booleanParam(value: string | null): boolean | undefined {
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

export function parseShipmentQuery(params: URLSearchParams): ShipmentQuery {
  const stages = (params.get("stage") ?? "")
    .split(",")
    .map((stage) => stage.trim())
    .filter(Boolean) as ShipmentStage[]
  const modeValue = params.get("mode")?.trim().toLowerCase() as TransportMode | undefined
  const priorityValue = params.get("priority")?.trim().toLowerCase() as Priority | undefined
  const viewValue = params.get("view") as ShipmentQuickView | null
  const customerValue = Number(params.get("customer_id"))
  return {
    search: params.get("search")?.trim() ?? "",
    activeOnly: params.get("active_only") === "true",
    view: viewValue && QUICK_VIEWS.has(viewValue) ? viewValue : "all",
    priority: priorityValue && PRIORITIES.has(priorityValue) ? priorityValue : undefined,
    customerId: Number.isInteger(customerValue) && customerValue > 0 ? customerValue : undefined,
    atRisk: booleanParam(params.get("at_risk")),
    onHold: booleanParam(params.get("on_hold")),
    readyToInvoice: params.get("ready_to_invoice") === "true",
    mode: modeValue && MODES.has(modeValue) ? modeValue : undefined,
    origin: params.get("origin")?.trim() || undefined,
    destination: params.get("destination")?.trim() || undefined,
    stages,
  }
}

export function toShipmentSearchParams(query: ShipmentQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.search) params.set("search", query.search)
  if (query.activeOnly) params.set("active_only", "true")
  if (query.view !== "all") params.set("view", query.view)
  if (query.priority) params.set("priority", query.priority)
  if (query.customerId) params.set("customer_id", String(query.customerId))
  if (query.atRisk !== undefined) params.set("at_risk", String(query.atRisk))
  if (query.onHold !== undefined) params.set("on_hold", String(query.onHold))
  if (query.readyToInvoice) params.set("ready_to_invoice", "true")
  if (query.mode) params.set("mode", query.mode)
  if (query.origin) params.set("origin", query.origin)
  if (query.destination) params.set("destination", query.destination)
  if (query.stages.length) params.set("stage", query.stages.join(","))
  return params
}

function matchesQuickView(view: ShipmentQuickView, shipment: Shipment): boolean {
  if (view === "attention") return needsAttention(shipment)
  if (view === "atRisk") return shipment.is_at_risk
  if (view === "onHold") return shipment.is_on_hold
  if (view === "highPriority") return shipment.priority === "high"
  if (view === "readyToInvoice") return shipment.stage === "arrival" && !shipment.is_on_hold && !shipment.is_cancelled
  if (view === "completed") return shipment.stage === "invoice_to_customer"
  return true
}

export function filterShipments(
  shipments: Shipment[],
  customers: Customer[],
  inquiries: Inquiry[],
  query: ShipmentQuery,
): Shipment[] {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const inquiryById = new Map(inquiries.map((inquiry) => [inquiry.id, inquiry]))
  const search = text(query.search)
  const stages = new Set(query.stages)

  return shipments.filter((shipment) => {
    if (query.activeOnly && (shipment.is_cancelled || shipment.stage === "invoice_to_customer")) return false
    const customer = customerById.get(shipment.customer_id)
    const inquiry = inquiryById.get(shipment.inquiry_id)
    if (!matchesQuickView(query.view, shipment)) return false
    if (query.priority && shipment.priority !== query.priority) return false
    if (query.customerId && shipment.customer_id !== query.customerId) return false
    if (query.atRisk !== undefined && shipment.is_at_risk !== query.atRisk) return false
    if (query.onHold !== undefined && shipment.is_on_hold !== query.onHold) return false
    if (query.readyToInvoice && (shipment.stage !== "arrival" || shipment.is_on_hold || shipment.is_cancelled)) return false
    if (query.mode && inquiry?.mode !== query.mode) return false
    if (query.origin && text(inquiry?.origin) !== text(query.origin)) return false
    if (query.destination && text(inquiry?.destination) !== text(query.destination)) return false
    if (stages.size && !stages.has(shipment.stage)) return false
    if (!search) return true
    const searchFields = [shipment.job_number, customer?.name, inquiry?.origin, inquiry?.destination, ...shipment.references.map((reference) => reference.value)]
    return searchFields.some((field) => text(field).includes(search))
  })
}
