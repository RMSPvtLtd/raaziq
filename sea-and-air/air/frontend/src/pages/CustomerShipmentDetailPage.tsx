import { useParams } from "react-router-dom"
import { Prohibit, Warning } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { StageChecklist } from "@/components/shared/StageChecklist"
import { EventTimeline } from "@/components/shared/EventTimeline"
import { JourneyRail } from "@/components/shared/JourneyRail"
import { RouteMap } from "@/components/shared/RouteMap"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { useAsync } from "@/hooks/useAsync"
import { useCustomerAuth } from "@/hooks/useCustomerAuth"
import { useStages } from "@/hooks/useStages"
import { customerPortalApi } from "@/lib/api/client"
import { formatRelativeTime } from "@/lib/format"
import { customerJourneyState } from "@/lib/shipment-operations"

const MODE_LABEL: Record<string, string> = { air: "Air Freight", sea: "Sea Freight", road: "Road Freight" }

export function CustomerShipmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { token } = useCustomerAuth()
  const { stages, labelFor } = useStages()
  const shipmentId = Number(id)

  const result = useAsync(() => customerPortalApi.shipment(token!, shipmentId), [token, shipmentId])

  if (result.loading) return <LoadingState rows={4} />
  if (result.error || !result.data) {
    return <ErrorState message={result.error ?? "Shipment not found."} onRetry={result.reload} />
  }

  const r = result.data
  const latest = r.status_history.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
  const journey = customerJourneyState(r.checklist, r.is_cancelled)

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.job_number ?? `Inquiry #${shipmentId}`}
            {r.is_cancelled && <Badge variant="secondary">Cancelled</Badge>}
          </span>
        }
        description={`${r.origin} → ${r.destination} · ${MODE_LABEL[r.mode]}`}
      />

      {r.is_cancelled && (
        <div className="flex items-start gap-2.5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <Prohibit size={18} weight="fill" className="mt-0.5 shrink-0" />
          <p>{r.cancellation_note ?? "This shipment has been cancelled."}</p>
        </div>
      )}

      {!r.is_cancelled && r.at_risk && (
        <div className="flex items-start gap-2.5 rounded-xl bg-status-warning-bg px-4 py-3 text-sm text-status-warning">
          <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
          <p>
            This shipment may be experiencing a delay. Contact your Raaziq account manager for the latest
            details.
          </p>
        </div>
      )}

      <div className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,1fr)_300px]">
        <RouteMap origin={r.origin} destination={r.destination} mode={r.mode} className="rounded-none border-0 [&>div:first-child]:min-h-80 [&>div:first-child>div]:min-h-80" />
        <aside className="flex flex-col justify-center border-t border-border p-6 lg:border-t-0 lg:border-l"><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Current situation</p><p className="mt-3 font-heading text-2xl font-semibold">{r.is_cancelled ? "Cancelled" : labelFor(r.stage)}</p><p className="mt-2 text-xs text-muted-foreground">{latest ? `Updated ${formatRelativeTime(latest.timestamp)}` : "No activity update yet"}</p><div className="mt-6 border-t border-border pt-5"><p className="text-xs text-muted-foreground">{r.is_cancelled ? "Last recorded milestone" : "What happens next"}</p><p className="mt-2 text-sm font-medium">{r.is_cancelled ? labelFor(r.stage) : journey.next ? labelFor(journey.next.stage) : "Journey complete"}</p></div></aside>
      </div>

      {!r.is_cancelled && <section className="border-b border-border pb-6"><p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Journey</p><JourneyRail stages={stages} currentStage={r.stage} /></section>}

      <details className="border-b border-border pb-5">
          <summary className="cursor-pointer py-2 text-sm font-medium">Full shipment checklist</summary>
          <div className="pt-5">
          <StageChecklist items={journey.items} />
          </div>
      </details>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <h2 className="mb-5 font-heading text-lg font-semibold">Shipment activity</h2>
          <EventTimeline entries={r.status_history} />
        </section>

      {r.references.length > 0 && (
        <section className="border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">References</p>
            <ul className="space-y-1.5 text-sm">
              {r.references.map((ref, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3">
                  <span className="text-muted-foreground">{ref.type.replace("_", " ")}</span>
                  <span className="font-medium tabular-nums">{ref.value}</span>
                </li>
              ))}
            </ul>
        </section>
      )}
      </div>
    </div>
  )
}
