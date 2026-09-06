import { useState } from "react"
import { Link } from "react-router-dom"
import { Package } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { StageBadge } from "@/components/shared/StageBadge"
import { RiskBadge } from "@/components/shared/RiskBadge"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAsync } from "@/hooks/useAsync"
import { useCustomerAuth } from "@/hooks/useCustomerAuth"
import { customerPortalApi } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

type Tab = "active" | "completed"

export function CustomerShipmentsPage() {
  const { token } = useCustomerAuth()
  const [tab, setTab] = useState<Tab>("active")

  const shipments = useAsync(
    () => customerPortalApi.shipments(token!, tab === "completed"),
    [token, tab],
  )

  return (
    <div>
      <PageHeader title="Shipments" description="Every job we're moving for you, past and present." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {shipments.loading && <LoadingState rows={5} />}
      {!shipments.loading && shipments.error && <ErrorState message={shipments.error} onRetry={shipments.reload} />}
      {!shipments.loading && !shipments.error && (shipments.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={<Package size={32} />}
          title={tab === "completed" ? "No completed shipments yet" : "No active shipments"}
          description={
            tab === "completed"
              ? "Shipments appear here once they've been invoiced."
              : "New shipments will show up here as soon as they're created."
          }
        />
      )}
      {!shipments.loading && !shipments.error && (shipments.data?.length ?? 0) > 0 && (
        <><div className="hidden overflow-x-auto rounded-xl border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Number</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.data!.map((shipment) => (
                <TableRow key={shipment.id}>
                  <TableCell className="font-medium tabular-nums">
                    <Link
                      to={`/customer/shipments/${shipment.id}`}
                      className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {shipment.job_number ?? `Inquiry #${shipment.id}`}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {shipment.origin} → {shipment.destination}
                  </TableCell>
                  <TableCell className="flex flex-wrap items-center gap-1.5">
                    <StageBadge stage={shipment.stage} />
                    {shipment.is_cancelled && <Badge variant="secondary">Cancelled</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatDateTime(shipment.updated_at)}
                  </TableCell>
                  <TableCell>{!shipment.is_cancelled && shipment.is_at_risk && <RiskBadge />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div><ul className="space-y-2 md:hidden" aria-label="Shipments">{shipments.data!.map((shipment) => <li key={shipment.id} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><Link to={`/customer/shipments/${shipment.id}`} className="font-medium tabular-nums hover:underline">{shipment.job_number ?? `Inquiry #${shipment.id}`}</Link><StageBadge stage={shipment.stage} /></div><p className="mt-2 text-sm">{shipment.origin} → {shipment.destination}</p><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Updated {formatDateTime(shipment.updated_at)}</p><div className="flex gap-1">{shipment.is_cancelled && <Badge variant="secondary">Cancelled</Badge>}{!shipment.is_cancelled && shipment.is_at_risk && <RiskBadge />}</div></div></li>)}</ul></>
      )}
    </div>
  )
}
