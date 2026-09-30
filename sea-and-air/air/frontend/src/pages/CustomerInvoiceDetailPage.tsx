import { CommercialCharges } from "@/components/shared/CommercialCharges"
import { CommercialDetails } from "@/components/shared/CommercialDetails"
import { ScheduleReference } from "@/components/shared/ScheduleReference"
import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAsync } from "@/hooks/useAsync"
import { useCustomerAuth } from "@/hooks/useCustomerAuth"
import { customerPortalApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import type { InvoiceStatus } from "@/lib/api/types"


const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  cancelled: "Cancelled",
}

export function CustomerInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { token } = useCustomerAuth()
  const invoiceId = Number(id)

  const invoice = useAsync(() => customerPortalApi.invoice(token!, invoiceId), [token, invoiceId])

  if (invoice.loading) return <LoadingState rows={6} />
  if (invoice.error || !invoice.data) {
    return <ErrorState message={invoice.error ?? "Invoice not found."} onRetry={invoice.reload} />
  }

  const inv = invoice.data

  return (
    <div className="mx-auto max-w-3xl space-y-6 uppercase">
      <PageHeader
        title={inv.invoice_number}
        description={
          <span className="flex items-center gap-2">
            <Badge variant={inv.status === "cancelled" ? "secondary" : "outline"}>{STATUS_LABEL[inv.status]}</Badge>
            <span>Issued {formatDate(inv.issued_date)}</span>
          </span>
        }
      />

      <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Invoice total</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{formatMoney(inv.total, inv.currency)}</p><p className="mt-2 text-sm text-muted-foreground">{inv.origin} → {inv.destination}{inv.job_number ? ` · ${inv.job_number}` : ""}</p></div>

<CommercialDetails rows={[["QUOTE", inv.quote_reference], ["QUOTE DATE", inv.quote_date], ["QUOTE VALID UNTIL", inv.quote_valid_until], ["AIRLINE", inv.carrier], ["CARGO", inv.cargo_type], ["GROSS WEIGHT (KG)", inv.weight_kg], ["CHARGEABLE WEIGHT (KG)", inv.chargeable_weight_kg], ["VOLUME (CBM)", inv.volume_cbm], ["PIECES", inv.pieces], ["HS CODE", inv.hs_code], ["DIMENSIONS", inv.dimensions], ["READY DATE", inv.ready_date], ["DESCRIPTION", inv.description], ["FLIGHT", inv.voyage_flight_number], ["REMARKS", inv.remarks]]} clauses={inv.clauses} />
      <ScheduleReference schedules={inv.schedule} />
      {inv.status === "cancelled" && (
        <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This invoice has been cancelled and is no longer payable. Contact us if you have questions.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Charges</CardTitle>
        </CardHeader>
        <CardContent>
          <CommercialCharges items={inv.line_items} currency={inv.currency} />
          <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatMoney(inv.subtotal, inv.currency)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Service charge</span>
              <span className="tabular-nums">{formatMoney(inv.service_charge_amount, inv.currency)}</span>
            </div>
            {Number(inv.tax_amount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tax</span>
                <span className="tabular-nums">{formatMoney(inv.tax_amount, inv.currency)}</span>
              </div>
            )}
            {Number(inv.discount_amount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span className="tabular-nums">-{formatMoney(inv.discount_amount, inv.currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(inv.total, inv.currency)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shipment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Route</span>
            <span className="font-medium text-foreground">{inv.origin} → {inv.destination}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Incoterm</span>
            <span className="font-medium text-foreground">{inv.incoterm}</span>
          </div>
          {inv.job_number && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Job Number</span>
              <span className="font-medium text-foreground">{inv.job_number}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
