import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  CheckCircle,
  DownloadSimple,
  FileText,
  PaperPlaneTilt,
  PencilSimpleLine,
  Receipt,
  XCircle,
} from "@phosphor-icons/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { useAsync } from "@/hooks/useAsync"
import { companiesApi, downloadAuthedFile, inquiriesApi, invoicesApi, openAuthedFile, quotesApi, ApiError } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import { effectiveQuoteStatus } from "@/lib/quote-comparison"
import type { Quote, QuoteStatus, Shipment } from "@/lib/api/types"

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  expired: "Expired",
  rejected: "Rejected",
}

const KIND_LABEL: Record<string, string> = {
  freight: "Freight",
  documentation: "Documentation",
  customs: "Customs",
  pickup: "Pickup",
  handling: "Handling",
  other: "Other",
}

export function QuoteBreakdown({ quoteId }: { quoteId: number }) {
  const quote = useAsync(() => quotesApi.get(quoteId), [quoteId])
  const inquiry = useAsync(
    () => (quote.data ? inquiriesApi.get(quote.data.inquiry_id) : Promise.resolve(null)),
    [quote.data?.inquiry_id],
  )
  const [acceptedShipment, setAcceptedShipment] = useState<Shipment | null>(null)
  const [emailing, setEmailing] = useState(false)

  if (quote.loading) return <LoadingState rows={5} />
  if (quote.error || !quote.data) return <ErrorState message={quote.error ?? "Quote not found."} onRetry={quote.reload} />

  if (acceptedShipment) {
    return <AcceptedPanel shipment={acceptedShipment} />
  }

  const q = quote.data

  async function handleEmail() {
    setEmailing(true)
    try {
      await quotesApi.email(q.id)
      toast.success("Quote emailed to customer")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send email.")
    } finally {
      setEmailing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              Q-{q.root_quote_id ?? q.id} Rev {q.revision_number}
            </span>
            {q.carrier && <Badge variant="outline">{q.carrier}</Badge>}
            {q.is_manual && (
              <Badge variant="outline" className="text-[10px]">
                Manual
              </Badge>
            )}
            {!q.is_current && <Badge variant="secondary">Superseded</Badge>}
          </div>
          {inquiry.data && (
            <p className="text-sm text-muted-foreground">
              {inquiry.data.origin} → {inquiry.data.destination} · {inquiry.data.mode.toUpperCase()} ·{" "}
              {inquiry.data.cargo_type} · Incoterm {inquiry.data.incoterm}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm"><Link to={`/inquiries/${q.inquiry_id}/quotes`}>Compare offers</Link></Button>
          <button
            type="button"
            onClick={() => openAuthedFile(quotesApi.pdfUrl(q.id)).catch(() => toast.error("Could not open PDF."))}
            className="flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText size={16} />
            Preview PDF
          </button>
          <button
            type="button"
            onClick={handleEmail}
            disabled={emailing}
            className="flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <PaperPlaneTilt size={16} />
            {emailing ? "Sending…" : "Email to Customer"}
          </button>
        </div>
      </div>

      <RevisionHistory rootQuoteId={q.root_quote_id ?? q.id} currentId={q.id} />

      <LineItemsCard quote={quote.data} onSaved={quote.reload} />

      <SummaryCard quote={quote.data} onSaved={quote.reload} />

      <ClausesCard quote={quote.data} onSaved={quote.reload} />

      <ActionsBar quote={quote.data} onSent={quote.reload} onAccepted={setAcceptedShipment} onRejected={quote.reload} />

      {quote.data.status === "accepted" && <InvoiceSection quote={quote.data} onCreated={quote.reload} />}
    </div>
  )
}

function RevisionHistory({ rootQuoteId, currentId }: { rootQuoteId: number; currentId: number }) {
  const revisions = useAsync(() => quotesApi.revisions(rootQuoteId), [rootQuoteId])
  if (revisions.loading || !revisions.data || revisions.data.length < 2) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">Revisions:</span>
      {revisions.data.map((rev) => (
        <Link
          key={rev.id}
          to={`/quotes/${rev.id}`}
          className={
            rev.id === currentId
              ? "rounded bg-secondary px-2 py-0.5 font-medium text-secondary-foreground"
              : "rounded px-2 py-0.5 text-muted-foreground underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          }
        >
          Rev {rev.revision_number}
        </Link>
      ))}
    </div>
  )
}

function LineItemsCard({ quote, onSaved }: { quote: Quote; onSaved: () => void }) {
  const editable = quote.shipment_stage !== "invoice_to_customer" && quote.is_current
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  const dirty = Object.keys(edits).length > 0

  async function handleSave() {
    setSaving(true)
    try {
      await quotesApi.overrideLineItems(
        quote.id,
        Object.entries(edits).map(([lineItemId, finalTotal]) => ({
          line_item_id: Number(lineItemId),
          final_total: finalTotal,
        })),
      )
      toast.success("Line items updated")
      setEdits({})
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save changes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Price breakdown</CardTitle>
        {editable && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <PencilSimpleLine size={14} />
            Editable until invoiced
          </span>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Calculated</TableHead>
                <TableHead className="text-right">Final</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quote.line_items.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{KIND_LABEL[li.kind] ?? li.kind}</span>
                      {li.is_manual_override && (
                        <Badge variant="outline" className="text-[10px]">
                          Overridden
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{li.description}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatMoney(li.calculated_total, quote.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={li.final_total}
                        className="ml-auto w-28 text-right tabular-nums"
                        onChange={(e) => setEdits((prev) => ({ ...prev, [li.id]: e.target.value }))}
                        aria-label={`Final price for ${li.description}`}
                      />
                    ) : (
                      <span className="tabular-nums font-medium">{formatMoney(li.final_total, quote.currency)}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {editable && dirty && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save overrides"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryCard({ quote, onSaved }: { quote: Quote; onSaved: () => void }) {
  const editable = quote.shipment_stage !== "invoice_to_customer" && quote.is_current
  const hasAdjustments = Number(quote.tax_amount) > 0 || Number(quote.discount_amount) > 0
  const [editing, setEditing] = useState(false)
  const [taxAmount, setTaxAmount] = useState(quote.tax_amount)
  const [discountAmount, setDiscountAmount] = useState(quote.discount_amount)
  const [saving, setSaving] = useState(false)

  async function handleSaveAdjustments() {
    setSaving(true)
    try {
      await quotesApi.setAdjustments(quote.id, taxAmount || "0", discountAmount || "0")
      toast.success("Adjustments updated")
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update tax/discount.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-1.5 py-5 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatMoney(quote.subtotal, quote.currency)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Markup</span>
          <span className="tabular-nums">{formatMoney(quote.markup_amount, quote.currency)}</span>
        </div>
        {(hasAdjustments || editing) && (
          <>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Tax</span>
              {editing ? (
                <Input
                  type="number" step="0.01" value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  className="h-7 w-24 text-right tabular-nums" aria-label="Tax amount"
                />
              ) : (
                <span className="tabular-nums">{formatMoney(quote.tax_amount, quote.currency)}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Discount</span>
              {editing ? (
                <Input
                  type="number" step="0.01" value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="h-7 w-24 text-right tabular-nums" aria-label="Discount amount"
                />
              ) : (
                <span className="tabular-nums">-{formatMoney(quote.discount_amount, quote.currency)}</span>
              )}
            </div>
          </>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(quote.total, quote.currency)}</span>
        </div>
        <p className="pt-1 text-xs text-muted-foreground">Valid until {formatDate(quote.valid_until)}</p>
        {editable && (
          <div className="flex justify-end pt-1">
            {editing ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveAdjustments} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {hasAdjustments ? "Edit tax/discount" : "Add tax or discount"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ClausesCard({ quote, onSaved }: { quote: Quote; onSaved: () => void }) {
  const editable = quote.shipment_stage !== "invoice_to_customer" && quote.is_current
  const [editing, setEditing] = useState(false)
  const [clauses, setClauses] = useState(quote.clauses ?? "")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await quotesApi.setClauses(quote.id, clauses.trim() || null)
      toast.success("Terms & conditions updated")
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save terms & conditions.")
    } finally {
      setSaving(false)
    }
  }

  if (!editable && !quote.clauses) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Terms &amp; Conditions</CardTitle>
        {editable && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {quote.clauses ? "Edit" : "Add"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              rows={4}
              value={clauses}
              onChange={(e) => setClauses(e.target.value)}
              placeholder="Trading terms/clauses to print on this quote and any invoice generated from it, e.g. BIFA standard trading conditions."
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setClauses(quote.clauses ?? "")
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.clauses}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ActionsBar({
  quote,
  onSent,
  onAccepted,
  onRejected,
}: {
  quote: Quote
  onSent: () => void
  onAccepted: (shipment: Shipment) => void
  onRejected: () => void
}) {
  const [sending, setSending] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [revising, setRevising] = useState(false)
  const navigate = useNavigate()

  const status = effectiveQuoteStatus(quote)
  const statusLabel = STATUS_LABEL[status]

  async function handleGenerateRevision() {
    setRevising(true)
    try {
      const revisions = await quotesApi.generate(quote.inquiry_id)
      toast.success(revisions.length > 1 ? `${revisions.length} carrier quotes regenerated` : "New revision created")
      // generate can produce several sibling quotes (one per carrier) --
      // go to the comparison view rather than assuming there's just one.
      navigate(`/inquiries/${quote.inquiry_id}/quotes`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate a new revision.")
    } finally {
      setRevising(false)
    }
  }

  if (!quote.is_current) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        This revision has been superseded by a newer quote and can no longer be sent, accepted, or rejected.
      </div>
    )
  }

  if (status === "expired") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <span>This quote expired on {formatDate(quote.valid_until)} and can no longer be sent or accepted.</span>
        <Button size="sm" variant="outline" onClick={handleGenerateRevision} disabled={revising}>
          {revising ? "Generating…" : "Generate New Revision"}
        </Button>
      </div>
    )
  }

  if (quote.status === "rejected") {
    return (
      <div className="space-y-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <div>
          <p className="font-medium">This quote was rejected{quote.rejected_by ? ` by ${quote.rejected_by}` : ""}.</p>
          {quote.rejected_reason && <p>{quote.rejected_reason}</p>}
        </div>
        <Button size="sm" variant="outline" onClick={handleGenerateRevision} disabled={revising}>
          {revising ? "Generating…" : "Generate New Revision"}
        </Button>
      </div>
    )
  }

  if (quote.status === "accepted") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-status-success/20 bg-status-success/5 px-4 py-3 text-sm text-status-success">
        <CheckCircle size={18} weight="fill" />
        A job has already been opened from this quote.{" "}
        <Link to="/shipments" className="underline">
          View shipments
        </Link>
      </div>
    )
  }

  async function handleSend() {
    setSending(true)
    try {
      await quotesApi.send(quote.id)
      toast.success("Quote marked as sent")
      onSent()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send quote.")
    } finally {
      setSending(false)
    }
  }

  async function handleAccept() {
    setAccepting(true)
    try {
      const shipment = await quotesApi.accept(quote.id)
      toast.success("Job opened")
      onAccepted(shipment)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not accept quote.")
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="text-sm text-muted-foreground">
        Status: <span className="font-medium text-foreground">{statusLabel}</span>
      </span>
      <div className="flex gap-2">
        {quote.status === "draft" && (
          <Button variant="outline" onClick={handleSend} disabled={sending} className="gap-1.5">
            <PaperPlaneTilt size={16} />
            {sending ? "Sending…" : "Send Quote"}
          </Button>
        )}
        <Button variant="outline" onClick={() => setRejectOpen(true)} className="gap-1.5 text-destructive hover:text-destructive">
          <XCircle size={16} />
          Reject
        </Button>
        <Button onClick={() => setAcceptOpen(true)} disabled={accepting} className="gap-1.5">
          <CheckCircle size={16} />
          {accepting ? "Opening job…" : "Open Job"}
        </Button>
      </div>
      <Dialog open={acceptOpen} onOpenChange={(open) => { if (!accepting) setAcceptOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept {quote.carrier ?? "this carrier"} for {formatMoney(quote.total, quote.currency)}?</DialogTitle>
            <DialogDescription>This opens the shipment job and closes the other available carrier offers for this inquiry.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={accepting} onClick={() => setAcceptOpen(false)}>Cancel</Button>
            <Button disabled={accepting} onClick={handleAccept}>{accepting ? "Opening job…" : "Accept quotation"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RejectQuoteDialog
        quoteId={quote.id}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onRejected={onRejected}
      />
    </div>
  )
}

function RejectQuoteDialog({
  quoteId,
  open,
  onOpenChange,
  onRejected,
}: {
  quoteId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onRejected: () => void
}) {
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleReject() {
    setSubmitting(true)
    try {
      await quotesApi.reject(quoteId, reason)
      toast.success("Quote rejected")
      setReason("")
      onOpenChange(false)
      onRejected()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reject quote.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject quote</DialogTitle>
          <DialogDescription>Record why this quote is being declined. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer found a lower rate elsewhere"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleReject} disabled={submitting || !reason.trim()}>
            {submitting ? "Rejecting…" : "Reject quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InvoiceSection({ quote, onCreated }: { quote: Quote; onCreated: () => void }) {
  if (quote.invoice_id) {
    return <ExistingInvoiceCard invoiceId={quote.invoice_id} />
  }
  return <CreateInvoiceCard quoteId={quote.id} onCreated={onCreated} />
}

function ExistingInvoiceCard({ invoiceId }: { invoiceId: number }) {
  const invoice = useAsync(() => invoicesApi.get(invoiceId), [invoiceId])
  if (invoice.loading || !invoice.data) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-success/20 bg-status-success/5 px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-status-success">
        <Receipt size={18} weight="fill" />
        Invoice: <span className="font-medium tabular-nums">{invoice.data.invoice_number}</span>
      </span>
      <div className="flex gap-2">
        <Link to={`/invoices/${invoiceId}`} className="text-sm text-muted-foreground underline">
          View invoice
        </Link>
        <button
          type="button"
          onClick={() =>
            downloadAuthedFile(invoicesApi.pdfUrl(invoiceId), `${invoice.data!.invoice_number}.pdf`).catch(() =>
              toast.error("Could not download PDF."),
            )
          }
          className="flex items-center gap-1 text-sm text-muted-foreground underline"
        >
          <DownloadSimple size={14} />
          PDF
        </button>
      </div>
    </div>
  )
}

function CreateInvoiceCard({ quoteId, onCreated }: { quoteId: number; onCreated: () => void }) {
  const companies = useAsync(() => companiesApi.list(), [])
  const [companyId, setCompanyId] = useState<string>("")
  const [creating, setCreating] = useState(false)

  const defaultCompanyId = useMemo(() => {
    const list = companies.data ?? []
    return String((list.find((c) => c.is_default) ?? list[0])?.id ?? "")
  }, [companies.data])
  const selectedCompanyId = companyId || defaultCompanyId

  async function handleCreate() {
    if (!selectedCompanyId) return
    setCreating(true)
    try {
      await invoicesApi.createFromQuote(quoteId, Number(selectedCompanyId))
      toast.success("Invoice created")
      onCreated()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create invoice.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invoice</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 space-y-1.5">
          <Label>Bill from</Label>
          <Select value={selectedCompanyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={companies.loading ? "Loading…" : "Select a company"} />
            </SelectTrigger>
            <SelectContent>
              {(companies.data ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleCreate} disabled={creating || !selectedCompanyId} className="gap-1.5">
          <Receipt size={16} />
          {creating ? "Creating invoice…" : "Create Invoice from Quote"}
        </Button>
      </CardContent>
    </Card>
  )
}

function AcceptedPanel({ shipment }: { shipment: Shipment }) {
  const navigate = useNavigate()
  return (
    <Card className="border-status-success/30 bg-status-success/5">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <CheckCircle size={40} weight="fill" className="text-status-success" />
        <h2 className="font-heading text-lg font-semibold text-foreground">Job opened</h2>
        <p className="text-sm text-muted-foreground">The shipment has been created with job number</p>
        <p className="font-heading text-2xl font-semibold tabular-nums text-foreground">{shipment.job_number}</p>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => navigate(`/shipments/${shipment.id}`)}>View shipment</Button>
          <Button variant="outline" onClick={() => navigate("/quotes/new")}>
            Create another quote
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
