import type { Customer, Inquiry, Shipment, ShipmentStage, StageMeta, TransportMode } from "./api/types"
import { needsAttention } from "./shipment-operations.ts"
import { parseApiDate } from "./format.ts"

export interface OverviewMetrics {
  active: number
  atRisk: number
  onHold: number
  readyToInvoice: number
}

export interface OverviewAttentionItem {
  shipment: Shipment
  customer: Customer | undefined
  inquiry: Inquiry | undefined
  waitingMinutes: number
}

export interface OverviewLane {
  key: string
  origin: string
  destination: string
  mode: TransportMode
  active: number
  atRisk: number
  onHold: number
  shipmentIds: number[]
}

export interface OverviewPipelinePhase {
  key: string
  label: string
  count: number
  stages: ShipmentStage[]
}

export interface OverviewData {
  metrics: OverviewMetrics
  attention: OverviewAttentionItem[]
  lanes: OverviewLane[]
  pipeline: OverviewPipelinePhase[]
}

function minutesWaiting(shipment: Shipment, now: Date): number {
  const stageChanges = shipment.status_events
    .filter((event) => event.is_stage_change && event.stage === shipment.stage)
    .map((event) => parseApiDate(event.timestamp).getTime())
    .filter((timestamp) => Number.isFinite(timestamp))
  const latestStageChange = stageChanges.length ? Math.max(...stageChanges) : parseApiDate(shipment.updated_at).getTime()
  if (!Number.isFinite(latestStageChange)) return 0
  return Math.max(0, Math.floor((now.getTime() - latestStageChange) / 60000))
}

function attentionScore(item: Shipment): number {
  return (item.is_at_risk ? 2 : 0) + (item.is_on_hold ? 2 : 0) + (item.priority === "high" ? 1 : 0)
}

function phaseLabel(stage: StageMeta, index: number, lastIndex: number): string {
  if (index <= 2) return "Booked"
  if (index === lastIndex) return "Billing"
  if (stage.group === "Documentation") return "Origin"
  if (stage.group === "Airline") return "In Transit"
  if (stage.group === "Airport") return "Airport / Export"
  return stage.group ?? stage.label
}

export function formatWaiting(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`
}

export function deriveOverviewData(
  shipments: Shipment[],
  customers: Customer[],
  inquiries: Inquiry[],
  stages: StageMeta[],
  now = new Date(),
): OverviewData {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const inquiryById = new Map(inquiries.map((inquiry) => [inquiry.id, inquiry]))
  const activeShipments = shipments.filter((shipment) => !shipment.is_cancelled && shipment.stage !== "invoice_to_customer")

  const metrics: OverviewMetrics = {
    active: activeShipments.length,
    atRisk: activeShipments.filter((shipment) => shipment.is_at_risk).length,
    onHold: activeShipments.filter((shipment) => shipment.is_on_hold).length,
    readyToInvoice: activeShipments.filter((shipment) => shipment.stage === "arrival" && !shipment.is_on_hold).length,
  }

  const attention = activeShipments
    .filter(needsAttention)
    .map((shipment) => ({
      shipment,
      customer: customerById.get(shipment.customer_id),
      inquiry: inquiryById.get(shipment.inquiry_id),
      waitingMinutes: minutesWaiting(shipment, now),
    }))
    .sort((a, b) => {
      const scoreDifference = attentionScore(b.shipment) - attentionScore(a.shipment)
      if (scoreDifference) return scoreDifference
      if (b.waitingMinutes !== a.waitingMinutes) return b.waitingMinutes - a.waitingMinutes
      return a.shipment.id - b.shipment.id
    })
    .slice(0, 8)

  const laneMap = new Map<string, OverviewLane>()
  for (const shipment of activeShipments) {
    const inquiry = inquiryById.get(shipment.inquiry_id)
    if (!inquiry) continue
    const key = `${inquiry.origin}→${inquiry.destination}·${inquiry.mode}`
    const lane = laneMap.get(key) ?? {
      key,
      origin: inquiry.origin,
      destination: inquiry.destination,
      mode: inquiry.mode,
      active: 0,
      atRisk: 0,
      onHold: 0,
      shipmentIds: [],
    }
    lane.active += 1
    if (shipment.is_at_risk) lane.atRisk += 1
    if (shipment.is_on_hold) lane.onHold += 1
    lane.shipmentIds.push(shipment.id)
    laneMap.set(key, lane)
  }
  const lanes = [...laneMap.values()]
    .map((lane) => ({ ...lane, shipmentIds: [...lane.shipmentIds].sort((a, b) => a - b) }))
    .sort((a, b) => b.active - a.active || b.atRisk - a.atRisk || a.key.localeCompare(b.key))

  const phaseMap = new Map<string, OverviewPipelinePhase>()
  const lastStageIndex = stages.length - 1
  stages.forEach((stage, index) => {
    const label = phaseLabel(stage, index, lastStageIndex)
    const phase = phaseMap.get(label) ?? { key: label, label, count: 0, stages: [] }
    phase.stages.push(stage.stage)
    phase.count += shipments.filter((shipment) => !shipment.is_cancelled && shipment.stage === stage.stage).length
    phaseMap.set(label, phase)
  })

  return { metrics, attention, lanes, pipeline: [...phaseMap.values()] }
}
