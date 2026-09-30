import { AirlineInput } from "@/components/shared/AirlineInput"
import { CargoSources } from "@/components/shared/CargoSources"
import { Textarea } from "@/components/ui/textarea"
import { localDate } from "@/lib/rate-card-views"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Plus, Scales, Trash } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useAsync } from "@/hooks/useAsync"
import { ApiError, inquiriesApi, quotesApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import { comparisonMatrix, manualSubtotal, prepareQuoteComparison } from "@/lib/quote-comparison"
import type { ChargeKind, ManualLineItemInput, Quote } from "@/lib/api/types"

const CHARGE_KINDS: ChargeKind[] = ["freight", "documentation", "customs", "pickup", "handling", "other"]
const emptyLineItem = (): ManualLineItemInput => ({ kind: "freight", description: "", quantity: "1", unit_price: "", amount: "" })

export function InquiryQuotesPage() {
  const { id } = useParams<{ id: string }>()
  const inquiryId = Number(id)
  const navigate = useNavigate()
  const inquiry = useAsync(() => inquiriesApi.get(inquiryId), [inquiryId])
  const offers = useAsync(() => quotesApi.forInquiry(inquiryId), [inquiryId])

  if (inquiry.loading || offers.loading) return <LoadingState rows={4} />
  if (inquiry.error || !inquiry.data) return <ErrorState message={inquiry.error ?? "Inquiry not found."} onRetry={inquiry.reload} />
  if (offers.error) return <ErrorState message={offers.error} onRetry={offers.reload} />

  const { quotes, lowestQuoteId } = prepareQuoteComparison(offers.data ?? [])
  const inq = inquiry.data
  return <div className="mx-auto max-w-6xl uppercase">
    <Button variant="ghost" size="sm" className="mb-3 -ml-2 gap-1.5 text-muted-foreground" onClick={() => navigate("/quotes")}><ArrowLeft size={16} /> Quote library</Button>
    <PageHeader title="Compare quotes" description={`${inq.origin} → ${inq.destination} · ${inq.mode.toUpperCase()} · ${inq.cargo_type} · Incoterm ${inq.incoterm}`} action={<ManualQuoteDialog inquiryId={inquiryId} onCreated={offers.reload} />} />
    {inq.mode === "air" && <CargoSources />}
    {quotes.length === 0 ? <EmptyState icon={<Scales size={32} />} title="No quotes yet" description="No rate card matched this lane automatically. Add a manual quote to price it by hand." /> : <PriceBreakdown quotes={quotes} lowestQuoteId={lowestQuoteId} />}
  </div>
}

function PriceBreakdown({ quotes, lowestQuoteId }: { quotes: Quote[]; lowestQuoteId: number | null }) {
  const rows = comparisonMatrix(quotes)
  return <section className="mt-7" aria-labelledby="price-breakdown-heading">
    <div className="mb-3"><h2 id="price-breakdown-heading" className="font-heading text-lg font-semibold">Aligned price breakdown</h2><p className="text-sm text-muted-foreground">The same charge categories line up across every current carrier offer.</p></div>
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-max text-sm">
        <thead className="bg-muted/50"><tr><th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left font-medium">Charge</th>{quotes.map((quote) => <th key={quote.id} className="min-w-56 px-5 py-5 text-right font-medium"><span className="block">{quote.carrier ?? "Unspecified carrier"}</span><span className="text-xs font-normal text-muted-foreground">{quote.currency}{quote.id === lowestQuoteId ? " · Lowest price" : ""}</span><span className="mt-2 block text-xs font-normal text-muted-foreground">Q-{quote.root_quote_id ?? quote.id} · Rev {quote.revision_number} · {quote.is_manual ? "Manual" : "Rate card"}</span><span className="block text-xs font-normal text-muted-foreground">Valid until {formatDate(quote.valid_until)}</span></th>)}</tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.kind} className="border-t border-border"><th className="sticky left-0 bg-card px-4 py-3 text-left font-medium">{row.label}</th>{quotes.map((quote) => <td key={quote.id} className="px-4 py-3 text-right tabular-nums">{row.amounts[quote.id] === null ? "—" : formatMoney(String(row.amounts[quote.id]), quote.currency)}</td>)}</tr>)}
          <tr className="border-t border-border bg-muted/20"><th className="sticky left-0 bg-muted px-4 py-3 text-left font-medium">Subtotal</th>{quotes.map((quote) => <td key={quote.id} className="px-4 py-3 text-right tabular-nums">{formatMoney(quote.subtotal, quote.currency)}</td>)}</tr>
          <tr className="border-t border-border"><th className="sticky left-0 bg-card px-4 py-3 text-left font-medium">Markup</th>{quotes.map((quote) => <td key={quote.id} className="px-4 py-3 text-right tabular-nums">{formatMoney(quote.markup_amount, quote.currency)}</td>)}</tr>
          <tr className="border-t border-border"><th className="sticky left-0 bg-card px-4 py-3 text-left font-medium">Tax</th>{quotes.map((quote) => <td key={quote.id} className="px-4 py-3 text-right tabular-nums">{formatMoney(quote.tax_amount, quote.currency)}</td>)}</tr>
          <tr className="border-t border-border"><th className="sticky left-0 bg-card px-4 py-3 text-left font-medium">Discount</th>{quotes.map((quote) => <td key={quote.id} className="px-4 py-3 text-right tabular-nums">−{formatMoney(quote.discount_amount, quote.currency)}</td>)}</tr>
          <tr className="border-t-2 border-border bg-muted/40"><th className="sticky left-0 bg-muted px-4 py-4 text-left font-semibold">Total</th>{quotes.map((quote) => <td key={quote.id} className="px-4 py-4 text-right font-heading text-base font-semibold tabular-nums">{formatMoney(quote.total, quote.currency)}</td>)}</tr>
        </tbody>
        <tfoot><tr className="border-t"><th className="sticky left-0 bg-card p-4 text-left font-medium">Review offer</th>{quotes.map((quote) => <td key={quote.id} className="p-4 text-right"><Button asChild variant={quote.id === lowestQuoteId ? "default" : "outline"}><Link to={`/quotes/${quote.id}`} aria-label={`Review ${quote.carrier ?? "carrier"} quote for ${formatMoney(quote.total, quote.currency)}`}>Open quote</Link></Button></td>)}</tr></tfoot>
      </table>
    </div>
  </section>
}

function ManualQuoteDialog({ inquiryId, onCreated }: { inquiryId: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [carrier, setCarrier] = useState("")
  const [validUntil, setValidUntil] = useState(localDate())
  const [clauses, setClauses] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [lineItems, setLineItems] = useState<ManualLineItemInput[]>([emptyLineItem()])
  const enteredSubtotal = manualSubtotal(lineItems)
  const previewCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD"
  const valid = Boolean(validUntil >= localDate() && carrier.trim() && /^[A-Z]{3}$/.test(currency) && lineItems.length && lineItems.every((item) => item.description.trim() && item.quantity.trim() && item.unit_price.trim() && item.amount.trim()))

  function resetForm() { setValidUntil(localDate()); setClauses(""); setCarrier(""); setCurrency("USD"); setLineItems([emptyLineItem()]) }
  function updateLine(index: number, patch: Partial<ManualLineItemInput>) { setLineItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)) }
  async function handleSubmit() {
    if (!valid) return
    setSubmitting(true)
    try {
      await quotesApi.createManual({ inquiry_id: inquiryId, carrier: carrier.trim(), currency, line_items: lineItems, valid_until: validUntil, clauses: clauses.trim() || null })
      toast.success("Manual quote added")
      setOpen(false)
      onCreated()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not create manual quote.")
    } finally { setSubmitting(false) }
  }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) resetForm() }}>
    <DialogTrigger asChild><Button variant="outline" size="sm" className="gap-1.5"><Plus size={14} /> Add manual quote</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl!">
      <DialogHeader><DialogTitle>Add a manual quote</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Enter the carrier's base rate. The standard markup is applied by the server after save, exactly as it is for rate-card quotes.</p>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="manual-carrier">Carrier</Label><AirlineInput id="manual-carrier" value={carrier} onChange={(event) => setCarrier(event.target.value.toUpperCase())} placeholder="e.g. Qatar Airways Cargo" /></div><div className="space-y-1.5"><Label htmlFor="manual-currency">Currency</Label><Input id="manual-currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} placeholder="USD" /></div></div>
      <div className="space-y-2"><div className="flex items-center justify-between"><Label>Line items</Label><Button type="button" variant="outline" size="sm" onClick={() => setLineItems((items) => [...items, emptyLineItem()])}><Plus size={14} /> Add line</Button></div>{lineItems.map((item, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 lg:grid-cols-12"><div className="col-span-2 lg:col-span-2"><Select value={item.kind} onValueChange={(value) => updateLine(index, { kind: value as ChargeKind })}><SelectTrigger aria-label={`Line ${index + 1} charge kind`}><SelectValue /></SelectTrigger><SelectContent>{CHARGE_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}</SelectContent></Select></div><Input aria-label={`Line ${index + 1} description`} placeholder="Description" className="col-span-2 lg:col-span-4" value={item.description} onChange={(event) => updateLine(index, { description: event.target.value })} /><Input aria-label={`Line ${index + 1} quantity`} inputMode="decimal" placeholder="Qty" className="lg:col-span-1" value={item.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /><Input aria-label={`Line ${index + 1} unit price`} inputMode="decimal" placeholder="Unit price" className="lg:col-span-2" value={item.unit_price} onChange={(event) => updateLine(index, { unit_price: event.target.value })} /><Input aria-label={`Line ${index + 1} amount`} inputMode="decimal" placeholder="Base amount" className="lg:col-span-2" value={item.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} /><Button type="button" variant="ghost" size="icon" className="justify-self-end lg:col-span-1" aria-label={`Remove line ${index + 1}`} disabled={lineItems.length <= 1} onClick={() => setLineItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} /></Button></div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="manual-validity">VALID UNTIL</Label><Input id="manual-validity" type="date" min={localDate()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div><div><Label htmlFor="manual-clauses">QUOTATION CLAUSES</Label><Textarea id="manual-clauses" value={clauses} maxLength={4000} onChange={(e) => setClauses(e.target.value)} /></div></div>
      <div className="ml-auto w-full max-w-sm rounded-xl border border-border bg-muted/40 p-4"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Entered subtotal</span><span className="font-medium tabular-nums">{formatMoney(String(enteredSubtotal), previewCurrency)}</span></div><div className="mt-2 flex justify-between border-t border-border pt-2"><span className="font-medium">Final quote total</span><span className="text-sm text-muted-foreground">Calculated after save</span></div><p className="mt-2 text-xs text-muted-foreground">No estimated markup is shown because that rate is owned by the server configuration.</p></div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={handleSubmit} disabled={!valid || submitting}>{submitting ? "Saving…" : "Add quote"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
