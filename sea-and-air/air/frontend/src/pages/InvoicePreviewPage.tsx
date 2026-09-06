import { useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Plus, Receipt } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAsync } from "@/hooks/useAsync"
import { ApiError, companiesApi, customersApi, inquiriesApi, invoicesApi, quotesApi, shipmentsApi } from "@/lib/api/client"
import { formatMoney } from "@/lib/format"
import type { ReferenceType } from "@/lib/api/types"

const KIND_LABEL: Record<string, string> = {
  freight: "Freight",
  documentation: "Documentation",
  customs: "Customs",
  pickup: "Pickup",
  handling: "Handling",
  other: "Other",
}

const REFERENCE_TYPES: ReferenceType[] = ["MAWB", "HAWB", "MBL", "HBL", "CONTAINER", "FORM_E", "LC", "PARTY_REFERENCE"]

// Everything shown here is exactly what create_invoice_from_quote will
// snapshot server-side -- fetched directly from the quote/inquiry/shipment
// rather than a separate "preview" endpoint, since nothing here is computed
// differently at creation time. Most fields are read-only review, sourced
// from the quote/inquiry; the billing entity, remarks, and any shipment
// reference (MB/L, HB/L, Form E, LC, Party Reference, Container) are the
// only things not already known at this point, so those are editable here.
export function InvoicePreviewPage() {
  const { id } = useParams<{ id: string }>()
  const shipmentId = Number(id)
  const navigate = useNavigate()

  const shipment = useAsync(() => shipmentsApi.get(shipmentId), [shipmentId])
  const quote = useAsync(
    () => (shipment.data?.quote_id ? quotesApi.get(shipment.data.quote_id) : Promise.resolve(null)),
    [shipment.data?.quote_id],
  )
  const inquiry = useAsync(
    () => (shipment.data ? inquiriesApi.get(shipment.data.inquiry_id) : Promise.resolve(null)),
    [shipment.data?.inquiry_id],
  )
  const customer = useAsync(
    () => (shipment.data ? customersApi.get(shipment.data.customer_id) : Promise.resolve(null)),
    [shipment.data?.customer_id],
  )
  const companies = useAsync(() => companiesApi.list(), [])

  const [companyId, setCompanyId] = useState<string>("")
  const [statusNote, setStatusNote] = useState("")
  const [remarks, setRemarks] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [refType, setRefType] = useState<ReferenceType>("MAWB")
  const [refValue, setRefValue] = useState("")
  const [addingRef, setAddingRef] = useState(false)

  const defaultCompanyId = useMemo(() => {
    const list = companies.data ?? []
    return String((list.find((c) => c.is_default) ?? list[0])?.id ?? "")
  }, [companies.data])
  const selectedCompanyId = companyId || defaultCompanyId

  const loading = shipment.loading || quote.loading || inquiry.loading || customer.loading
  const error = shipment.error ?? quote.error ?? inquiry.error ?? customer.error

  if (loading) return <LoadingState rows={6} />
  if (error || !shipment.data) return <ErrorState message={error ?? "Shipment not found."} onRetry={shipment.reload} />
  if (!quote.data) {
    return <ErrorState message="This shipment has no accepted quote to invoice." onRetry={shipment.reload} />
  }
  if (quote.data.invoice_id) {
    return <ErrorState message="This quote already has an invoice." onRetry={() => navigate(`/invoices/${quote.data!.invoice_id}`)} />
  }

  const q = quote.data
  const s = shipment.data
  const inq = inquiry.data
  const cust = customer.data

  async function handleGenerate() {
    if (!selectedCompanyId) return
    setSubmitting(true)
    try {
      const invoice = await invoicesApi.createFromQuote(
        q.id,
        Number(selectedCompanyId),
        undefined,
        remarks.trim() || undefined,
      )
      await shipmentsApi.invoice(shipmentId, statusNote.trim() || undefined)
      toast.success("Invoice generated")
      navigate(`/invoices/${invoice.id}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the invoice.")
      setSubmitting(false)
    }
  }

  async function handleAddReference() {
    if (!refValue.trim()) return
    setAddingRef(true)
    try {
      await shipmentsApi.addReference(shipmentId, refType, refValue.trim())
      toast.success("Reference added")
      setRefValue("")
      shipment.reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add reference.")
    } finally {
      setAddingRef(false)
    }
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="mb-3 -ml-2 gap-1.5 text-muted-foreground"
        onClick={() => navigate(`/shipments/${shipmentId}`)}
      >
        <ArrowLeft size={16} />
        Back to shipment
      </Button>

      <PageHeader
        title="Review invoice"
        description={
          cust && inq ? `${cust.name} · ${inq.origin} → ${inq.destination} · not yet generated` : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-2 text-xs"><Badge variant="outline">Quote & shipment snapshot · read only</Badge><Badge variant="outline">Billing entity, remarks & references · supplied by ops</Badge></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quote charges · read only</CardTitle>
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
                    {q.line_items.map((li) => (
                      <TableRow key={li.id}>
                        <TableCell>
                          <span>{KIND_LABEL[li.kind] ?? li.kind}</span>
                          <p className="text-xs text-muted-foreground">{li.description}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(li.final_total, q.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatMoney(q.subtotal, q.currency)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Markup</span>
                  <span className="tabular-nums">{formatMoney(q.markup_amount, q.currency)}</span>
                </div>
                {Number(q.tax_amount) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax</span>
                    <span className="tabular-nums">{formatMoney(q.tax_amount, q.currency)}</span>
                  </div>
                )}
                {Number(q.discount_amount) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span className="tabular-nums">-{formatMoney(q.discount_amount, q.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(q.total, q.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ops-supplied invoice fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Bill from</Label>
                <Select value={selectedCompanyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="w-full" aria-label="Bill from company">
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
              <div className="space-y-1.5">
                <Label>Remarks (optional)</Label>
                <Textarea
                  aria-label="Invoice remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Printed on the invoice itself"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status note (optional)</Label>
                <Textarea
                  aria-label="Shipment status note"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="Recorded on the shipment's status history, not on the invoice"
                  rows={2}
                />
              </div>
              <Button onClick={handleGenerate} disabled={submitting || !selectedCompanyId} className="w-full gap-1.5">
                <Receipt size={16} />
                {submitting ? "Generating…" : "Generate Invoice"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shipment references · supplied by ops</CardTitle>
              <p className="text-xs text-muted-foreground">
                MB/L, HB/L, Form E, LC, Party Reference, Container -- not part of the quote, add any that apply
                before generating.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {s.references.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {s.references.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5">
                      <span className="text-muted-foreground">{r.type.replace("_", " ")}</span>
                      <span className="font-medium tabular-nums">{r.value}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No references added yet.</p>
              )}
              <div className="flex gap-2">
                <Select value={refType} onValueChange={(v) => setRefType(v as ReferenceType)}>
                  <SelectTrigger className="w-32 shrink-0" aria-label="Reference type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REFERENCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={refValue}
                  onChange={(e) => setRefValue(e.target.value)}
                  placeholder="Reference number"
                  aria-label="Reference value"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={addingRef || !refValue.trim()}
                onClick={handleAddReference}
                className="w-full gap-1.5"
              >
                <Plus size={14} />
                {addingRef ? "Adding…" : "Add reference"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Customer" value={cust?.name ?? null} />
              <InfoRowLink label="Originating quote" to={`/quotes/${q.id}`} value={`Quote #${q.id}`} />
              <InfoRowLink label="Job / shipment" to={`/shipments/${s.id}`} value={s.job_number ?? `Shipment #${s.id}`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Particulars</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Job Number" value={s.job_number} />
              <InfoRow label="Description of Goods" value={inq?.cargo_type ?? null} />
              <InfoRow label="Incoterm" value={inq?.incoterm ?? null} />
              <InfoRow label="HS Code" value={inq?.hs_code ?? null} />
              <InfoRow label="Pieces" value={inq?.pieces ? String(inq.pieces) : null} />
              <InfoRow label="Gross Weight" value={inq ? `${inq.weight_kg} KGS` : null} />
              <InfoRow label="Volume" value={inq ? `${inq.volume_cbm} CBM` : null} />
              <InfoRow label="Carrier" value={s.carrier} />
              <InfoRow label="Voyage/Flight No" value={s.voyage_flight_number} />
              {inq?.supplier_name && <InfoRow label="Supplier" value={inq.supplier_name} />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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
