import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAsync } from "@/hooks/useAsync"
import { useCustomerAuth } from "@/hooks/useCustomerAuth"
import { customerPortalApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import type { InvoiceStatus } from "@/lib/api/types"

const KIND_LABEL: Record<string, string> = {
  freight: "Freight",
  documentation: "Documentation",
  customs: "Customs",
  pickup: "Pickup",
  handling: "Handling",
  other: "Other",
}

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
    <div className="mx-auto max-w-2xl space-y-6">
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.line_items.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell>
                      <span>{KIND_LABEL[li.kind] ?? li.kind}</span>
                      <p className="text-xs text-muted-foreground">{li.description}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(li.amount, inv.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatMoney(inv.subtotal, inv.currency)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Markup</span>
              <span className="tabular-nums">{formatMoney(inv.markup_amount, inv.currency)}</span>
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
