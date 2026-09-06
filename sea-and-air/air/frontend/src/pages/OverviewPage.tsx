import { useMemo } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowUpRight, Clock, MapPin, Package, Plus, ShieldWarning, Snowflake, UserCircle } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { NetworkMap } from "@/components/shared/NetworkMap"
import { filterShipments, parseShipmentQuery } from "@/lib/shipment-filters"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StageBadge } from "@/components/shared/StageBadge"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAsync } from "@/hooks/useAsync"
import { useStages } from "@/hooks/useStages"
import { customersApi, inquiriesApi, shipmentsApi } from "@/lib/api/client"
import { deriveOverviewData, formatWaiting } from "@/lib/overview"

const metricCards = [
  { key: "active", label: "Active shipments", icon: Package, tone: "text-accent-foreground" },
  { key: "atRisk", label: "At risk", icon: ShieldWarning, tone: "text-destructive" },
  { key: "onHold", label: "On hold", icon: Snowflake, tone: "text-status-warning" },
  { key: "readyToInvoice", label: "Ready to invoice", icon: ArrowUpRight, tone: "text-status-success" },
] as const

const metricTargets = {
  active: "all",
  atRisk: "atRisk",
  onHold: "onHold",
  readyToInvoice: "readyToInvoice",
} as const

function shipmentHref(params: Record<string, string>) {
  return `/shipments?${new URLSearchParams(params).toString()}`
}

export function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryString = searchParams.toString()
  const query = useMemo(() => parseShipmentQuery(new URLSearchParams(queryString)), [queryString])
  const { stages, loading: stagesLoading, labelFor } = useStages()
  const shipments = useAsync(() => shipmentsApi.list(), [])
  const customers = useAsync(() => customersApi.list(), [])
  const inquiries = useAsync(() => inquiriesApi.list(), [])
  const visibleShipments = useMemo(() => filterShipments(shipments.data ?? [], customers.data ?? [], inquiries.data ?? [], query), [shipments.data, customers.data, inquiries.data, query])
  const data = useMemo(
    () => deriveOverviewData(visibleShipments, customers.data ?? [], inquiries.data ?? [], stages),
    [visibleShipments, customers.data, inquiries.data, stages],
  )
  const loading = shipments.loading || customers.loading || inquiries.loading || stagesLoading
  const error = shipments.error ?? customers.error ?? inquiries.error

  function scopedHref(target: string, activeOnly = true) {
    const next = new URLSearchParams(queryString)
    if (activeOnly) next.set("active_only", "true")
    else next.delete("active_only")
    for (const [key, value] of new URLSearchParams(target.split("?")[1])) next.set(key, value)
    return `/shipments?${next}`
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(queryString)
    if (value === "all") next.delete(key)
    else next.set(key, value)
    setSearchParams(next)
  }

  function selectLane(key: string) {
    const lane = data.lanes.find((item) => item.key === key)
    if (!lane) return
    const next = new URLSearchParams(queryString)
    next.set("origin", lane.origin)
    next.set("destination", lane.destination)
    next.set("mode", lane.mode)
    setSearchParams(next)
  }

  function reloadOverview() {
    shipments.reload()
    customers.reload()
    inquiries.reload()
  }

  if (loading) return <LoadingState rows={6} />
  if (error) return <ErrorState message={error} onRetry={reloadOverview} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control Tower"
        description="A truthful view of what is moving, waiting, and ready for the next action."
        action={
          <Button asChild className="gap-1.5">
            <Link to="/quotes/new"><Plus size={16} /> New Quote</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Control Tower filters">
        <Select value={query.mode ?? "all"} onValueChange={(value) => setFilter("mode", value)}><SelectTrigger className="w-36" aria-label="Filter network by mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All modes</SelectItem><SelectItem value="air">Air</SelectItem><SelectItem value="sea">Sea</SelectItem><SelectItem value="road">Road</SelectItem></SelectContent></Select>
        <Select value={query.view} onValueChange={(value) => setFilter("view", value)}><SelectTrigger className="w-48" aria-label="Filter network by attention"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All active work</SelectItem><SelectItem value="attention">Needs attention</SelectItem><SelectItem value="atRisk">At risk</SelectItem><SelectItem value="onHold">On hold</SelectItem><SelectItem value="highPriority">High priority</SelectItem><SelectItem value="readyToInvoice">Ready to invoice</SelectItem></SelectContent></Select>
        {(query.origin || query.destination) && <Badge variant="secondary">{query.origin ?? "Any origin"} → {query.destination ?? "Any destination"}</Badge>}
        {queryString && <Button variant="ghost" onClick={() => setSearchParams({})}>Reset view</Button>}
        <Button asChild variant="outline" className="sm:ml-auto"><Link to={scopedHref("/shipments")}>View matching shipments <ArrowUpRight size={16} /></Link></Button>
      </div>

      <section aria-label="Shipment metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metricCards.map(({ key, label, icon: Icon, tone }) => (
          <button type="button" key={key} onClick={() => setFilter("view", metricTargets[key])} aria-pressed={query.view === metricTargets[key]} className="block rounded-xl text-left outline-none transition-transform duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring">
            <Card size="sm" className="h-full transition-colors duration-150 hover:border-accent-foreground/40">
              <CardContent className="flex items-center justify-between gap-4 py-1">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
                  <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{data.metrics[key]}</p>
                </div>
                <Icon size={24} weight="duotone" className={tone} aria-hidden="true" />
              </CardContent>
            </Card>
          </button>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,0.8fr)]">
        <Card className="min-w-0">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Network overview</CardTitle>
                <CardDescription>Active lanes from current shipment and inquiry records.</CardDescription>
              </div>
              <Badge variant="outline" className="gap-1.5"><MapPin size={13} /> Planned route network</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <NetworkMap lanes={data.lanes} onSelect={selectLane} />
            <ul className="mt-3 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2" aria-label="Select an active lane">
              {data.lanes.map((lane) => <li key={lane.key}><button type="button" onClick={() => selectLane(lane.key)} className="w-full rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="block font-medium">{lane.origin} → {lane.destination}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{lane.mode.toUpperCase()} · {lane.active} active{lane.atRisk ? ` · ${lane.atRisk} at risk` : ""}{lane.onHold ? ` · ${lane.onHold} on hold` : ""}</span>
              </button></li>)}
            </ul>
            {(query.origin || query.destination) && <section className="mt-5 border-t pt-4" aria-label="Selected lane shipments"><h3 className="mb-2 font-semibold">Jobs on this lane</h3><ul className="divide-y">{visibleShipments.filter((shipment) => !shipment.is_cancelled && shipment.stage !== "invoice_to_customer").map((shipment) => <li key={shipment.id}><Link className="flex flex-wrap items-center justify-between gap-2 rounded py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" to={`/shipments/${shipment.id}`}><span className="font-medium">{shipment.job_number ?? `Shipment #${shipment.id}`}</span><StageBadge stage={shipment.stage} /></Link></li>)}</ul></section>}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="border-b">
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Risk, holds, and high-priority work sorted deterministically.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {data.attention.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No shipments need attention.</p>
            ) : (
              <ul className="divide-y divide-border" aria-label="Shipments needing attention">
                {data.attention.map(({ shipment, customer, inquiry, waitingMinutes }) => (
                  <li key={shipment.id}>
                    <Link to={`/shipments/${shipment.id}`} className="block rounded-lg px-2 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{shipment.job_number ?? `Shipment #${shipment.id}`}</p>
                          <p className="truncate text-xs text-muted-foreground">{customer?.name ?? "Unknown customer"}</p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Clock size={13} /> {formatWaiting(waitingMinutes)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {inquiry && <span className="text-xs text-muted-foreground">{inquiry.origin} → {inquiry.destination}</span>}
                        <StageBadge stage={shipment.stage} />
                        {shipment.is_at_risk && <Badge variant="destructive">At risk</Badge>}
                        {shipment.is_on_hold && <Badge variant="outline">On hold</Badge>}
                        {shipment.priority === "high" && <Badge variant="secondary">High priority</Badge>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>Shipment volume by macro phase, derived from the canonical stage metadata.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {data.pipeline.map((phase) => (
            <Link key={phase.key} to={scopedHref(shipmentHref({ phase: phase.key, stage: phase.stages.join(",") }), false)} className="block rounded-lg p-2 -m-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{phase.label}</span>
                <span className="font-heading text-lg font-semibold tabular-nums">{phase.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${phase.label}: ${phase.count} shipments`}>
                <div className="h-full rounded-full bg-accent-foreground" style={{ width: `${Math.min(100, phase.count ? Math.max(16, phase.count / Math.max(1, data.metrics.active) * 100) : 0)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{phase.stages.map((stage) => labelFor(stage)).join(" · ")}</p>
            </div>
            </Link>
          ))}
          {data.pipeline.length === 0 && <p className="text-sm text-muted-foreground">Stage metadata is unavailable.</p>}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground"><UserCircle size={14} /> Metrics exclude cancelled and invoiced shipments from active operations.</p>
    </div>
  )
}
