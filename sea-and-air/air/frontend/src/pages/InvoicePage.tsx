import { EmailStatus } from "@/components/shared/EmailSettings"
import { CommercialCharges } from "@/components/shared/CommercialCharges"
import { CommercialDetails } from "@/components/shared/CommercialDetails"
import { ScheduleReference } from "@/components/shared/ScheduleReference"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, DownloadSimple, PaperPlaneTilt, Prohibit } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useAsync } from "@/hooks/useAsync"
import { ApiError, companiesApi, downloadAuthedFile, invoicesApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import type { InvoiceStatus } from "@/lib/api/types"


const STATUS_LABEL: Record<InvoiceStatus, string> = { draft: "Draft", issued: "Issued", paid: "Paid", cancelled: "Cancelled" }

export function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const invoiceId = Number(id)
  const navigate = useNavigate()
  const [emailing, setEmailing] = useState(false)

  const invoice = useAsync(() => invoicesApi.get(invoiceId), [invoiceId])
  const companies = useAsync(() => companiesApi.list(), [])
  // No dedicated "invoices for this quote" endpoint -- the full list is
  // small enough in this app to filter client-side for the replaces/
  // replaced-by relationship, rather than adding a new backend query just
  // for this one display.
  const allInvoices = useAsync(() => invoicesApi.list(), [])

  if (invoice.loading) return <LoadingState rows={6} />
  if (invoice.error || !invoice.data) {
    return <ErrorState message={invoice.error ?? "Invoice not found."} onRetry={invoice.reload} />
  }

  const inv = invoice.data
  const billingEntity = companies.data?.find((c) => c.id === inv.company_id)?.name
  const replaces = inv.replaces_invoice_id
    ? allInvoices.data?.find((i) => i.id === inv.replaces_invoice_id)
    : undefined
  const replacedBy = allInvoices.data?.find((i) => i.replaces_invoice_id === inv.id)

  async function handleEmail() {
    setEmailing(true)
    try {
      const result = await invoicesApi.email(inv.id)
      if (result.sent) toast.success(`Invoice emailed to ${result.recipient}`)
      else toast.error(result.error ?? "Invoice saved; email was not sent")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send email.")
    } finally {
      setEmailing(false)
      invoice.reload()
    }
  }

  return (
    <div className="uppercase">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2 gap-1.5 text-muted-foreground" onClick={() => navigate("/invoices")}>
        <ArrowLeft size={16} />
        All invoices
      </Button>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {inv.invoice_number}
            <Badge variant={inv.status === "cancelled" ? "secondary" : "outline"}>{STATUS_LABEL[inv.status] ?? inv.status}</Badge>
          </span>
        }
        description={`${inv.customer_name_snapshot} · ${inv.origin_snapshot} → ${inv.destination_snapshot} · Issued ${formatDate(inv.issued_date)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                downloadAuthedFile(invoicesApi.pdfUrl(inv.id), `${inv.invoice_number}.pdf`).catch(() =>
                  toast.error("Could not download PDF."),
                )
              }
            >
              <DownloadSimple size={16} />
              Download PDF
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={handleEmail} disabled={emailing}>
              <PaperPlaneTilt size={16} />
              {emailing ? "Sending…" : "Email to Customer"}
            </Button>
            {inv.status === "issued" && <CancelInvoiceDialog invoiceId={inv.id} onCancelled={invoice.reload} />}
          </div>
        }
      />

      <EmailStatus record={inv} />
      <CommercialDetails rows={[["QUOTE", inv.quote_reference_snapshot], ["QUOTE DATE", inv.quote_date_snapshot], ["QUOTE VALID UNTIL", inv.quote_valid_until_snapshot], ["VOLUME (CBM)", inv.volume_cbm_snapshot], ["DIMENSIONS", inv.dimensions_snapshot], ["READY DATE", inv.ready_date_snapshot], ["DESCRIPTION", inv.description_snapshot]]} />
      <div className="my-6"><ScheduleReference schedules={inv.schedule_snapshot} /></div>
      <section className="mb-6 grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-[1.4fr_1fr_1fr]" aria-label="Invoice summary">
        <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Amount due</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{formatMoney(inv.total, inv.currency)}</p></div>
        <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Bill to</p><p className="mt-1 font-medium">{inv.customer_name_snapshot}</p><p className="text-sm text-muted-foreground">{inv.origin_snapshot} → {inv.destination_snapshot}</p></div>
        <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Bill from</p><p className="mt-1 font-medium">{billingEntity ?? "Loading…"}</p><p className="text-sm text-muted-foreground">Issued {formatDate(inv.issued_date)}</p></div>
      </section>

      {inv.status === "cancelled" && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <Prohibit size={18} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            Cancelled by {inv.cancelled_by ?? "ops"} on {inv.cancelled_at ? formatDate(inv.cancelled_at) : "—"}.
            {inv.cancelled_reason && <> Reason: {inv.cancelled_reason}</>} This invoice is no longer payable.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoice charges</CardTitle>
            </CardHeader>
            <CardContent>
              <CommercialCharges items={inv.line_items} currency={inv.currency} />
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
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Billing entity" value={billingEntity ?? null} />
              <InfoRowLink label="Originating quote" to={`/quotes/${inv.quote_id}`} value={`Quote #${inv.quote_id}`} />
              <InfoRowLink label="Job / shipment" to={`/shipments/${inv.shipment_id}`} value={inv.job_number_snapshot ?? `Shipment #${inv.shipment_id}`} />
              {replaces && (
                <InfoRowLink label="Replaces" to={`/invoices/${replaces.id}`} value={replaces.invoice_number} />
              )}
              {replacedBy && (
                <InfoRowLink label="Replaced by" to={`/invoices/${replacedBy.id}`} value={replacedBy.invoice_number} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Particulars</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Job Number" value={inv.job_number_snapshot} />
              <InfoRow label="Description of Goods" value={inv.cargo_type_snapshot} />
              <InfoRow label="Incoterm" value={inv.incoterm_snapshot} />
              <InfoRow label="HS Code" value={inv.hs_code_snapshot} />
              <InfoRow label="Pieces" value={inv.pieces_snapshot ? String(inv.pieces_snapshot) : null} />
              <InfoRow label="Gross Weight" value={`${inv.weight_kg_snapshot} KGS`} />
              <InfoRow label="Chargeable Weight" value={`${inv.chargeable_weight_kg_snapshot} KGS`} />
              <InfoRow label="Carrier" value={inv.carrier_snapshot} />
              <InfoRow label="Voyage/Flight No" value={inv.voyage_flight_number_snapshot} />
              {inv.supplier_name_snapshot && <InfoRow label="Supplier" value={inv.supplier_name_snapshot} />}
            </CardContent>
          </Card>

          {inv.remarks && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Remarks</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground">{inv.remarks}</CardContent>
            </Card>
          )}

          {inv.clauses_snapshot && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Terms &amp; Conditions</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm text-foreground">{inv.clauses_snapshot}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function CancelInvoiceDialog({ invoiceId, onCancelled }: { invoiceId: number; onCancelled: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleCancel() {
    if (!reason.trim()) return
    setSubmitting(true)
    try {
      await invoicesApi.cancel(invoiceId, reason.trim())
      toast.success("Invoice cancelled")
      setOpen(false)
      onCancelled()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not cancel invoice.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive">
          <Prohibit size={16} />
          Cancel invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel invoice</DialogTitle>
          <DialogDescription>
            The invoice stays permanently visible in history, marked cancelled -- nothing is deleted or edited.
            To correct a billing mistake, create a replacement invoice from the same quote afterward.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-cancel-reason">Reason (required)</Label>
          <Textarea
            id="invoice-cancel-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Issued in error, wrong billing entity"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Back
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={submitting || !reason.trim()}>
            {submitting ? "Cancelling…" : "Cancel invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function InfoRowLink({ label, to, value }: { label: string; to: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <Link to={to} className="font-medium text-foreground underline outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {value}
      </Link>
    </div>
  )
}
