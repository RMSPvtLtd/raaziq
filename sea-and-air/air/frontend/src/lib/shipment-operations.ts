import { parseApiDate } from "./format.ts"

export interface ShipmentOperationState {
  stage: string
  is_at_risk: boolean
  is_on_hold: boolean
  is_cancelled: boolean
  priority: string
}

export interface StageEntry {
  stage: string
  timestamp: string
  is_stage_change: boolean
}

export interface JourneyStage {
  stage: string
  label: string
  group: string | null
}

export interface JourneyRailItem {
  label: string
  state: "completed" | "current" | "upcoming"
}

export function needsAttention(shipment: Pick<ShipmentOperationState, "is_at_risk" | "is_on_hold" | "priority">): boolean {
  return shipment.is_at_risk || shipment.is_on_hold || shipment.priority === "high"
}

export function quickViewCounts(shipments: ShipmentOperationState[]) {
  return {
    all: shipments.length,
    attention: shipments.filter(needsAttention).length,
    atRisk: shipments.filter((shipment) => shipment.is_at_risk).length,
    onHold: shipments.filter((shipment) => shipment.is_on_hold).length,
    highPriority: shipments.filter((shipment) => shipment.priority === "high").length,
    readyToInvoice: shipments.filter((shipment) => shipment.stage === "arrival" && !shipment.is_on_hold && !shipment.is_cancelled).length,
    completed: shipments.filter((shipment) => shipment.stage === "invoice_to_customer").length,
  }
}

export function stageEnteredAt(stage: string, events: StageEntry[]): string | null {
  return [...events].reverse().find((event) => event.stage === stage && event.is_stage_change)?.timestamp ?? null
}

export function formatWaitingAge(enteredAt: string | null, now = new Date()): string {
  if (!enteredAt) return "—"
  const timestamp = parseApiDate(enteredAt).getTime()
  if (!Number.isFinite(timestamp)) return "—"
  const minutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000))
  if (minutes < 1) return "Just now"
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remainder = minutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${remainder}m`
  return `${remainder}m`
}

export function journeyRail(stages: JourneyStage[], currentStage: string): JourneyRailItem[] {
  const currentIndex = stages.findIndex((stage) => stage.stage === currentStage)
  const groups = stages.reduce<{ label: string; firstIndex: number; lastIndex: number }[]>((items, stage, index) => {
    const label = stage.group ?? stage.label
    const last = items.at(-1)
    if (last?.label === label) {
      last.lastIndex = index
    } else {
      items.push({ label, firstIndex: index, lastIndex: index })
    }
    return items
  }, [])

  return groups.map((group) => ({
    label: group.label,
    state: currentIndex > group.lastIndex ? "completed" : currentIndex >= group.firstIndex ? "current" : "upcoming",
  }))
}

export function attentionText(shipment: Pick<ShipmentOperationState, "is_at_risk" | "is_on_hold"> & { priority?: string }): string | null {
  return [shipment.is_on_hold && "On hold", shipment.is_at_risk && "At risk", shipment.priority === "high" && "High priority"].filter(Boolean).join(" · ") || null
}

export function withShipmentSearch(params: URLSearchParams, search: string): URLSearchParams {
  const next = new URLSearchParams(params)
  if (search) next.set("search", search)
  else next.delete("search")
  return next
}

export function customerJourneyState<T extends { status: string }>(items: readonly T[], isCancelled: boolean) {
  return {
    items: isCancelled ? items.filter((item) => item.status !== "upcoming") : [...items],
    next: isCancelled ? undefined : items.find((item) => item.status === "upcoming"),
  }
}
