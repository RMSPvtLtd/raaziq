import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { MagnifyingGlass, Plus, Scales } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAsync } from "@/hooks/useAsync"
import { customersApi, inquiriesApi, quotesApi } from "@/lib/api/client"
import { formatDate, formatDateTime, formatMoney } from "@/lib/format"
import { effectiveQuoteStatus, quoteReference } from "@/lib/quote-comparison"
import type { Customer, Inquiry, Quote, QuoteStatus } from "@/lib/api/types"

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  expired: "Expired",
  rejected: "Rejected",
}

export function QuotesLibraryPage() {
  const records = useAsync(async () => {
    const [quotes, inquiries, customers] = await Promise.all([quotesApi.list(), inquiriesApi.list(), customersApi.list()])
    return { quotes, inquiries, customers }
  }, [])
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<QuoteStatus | "all">("all")
  const inquiryById = useMemo(() => new Map((records.data?.inquiries ?? []).map((inquiry) => [inquiry.id, inquiry])), [records.data?.inquiries])
  const customerById = useMemo(() => new Map((records.data?.customers ?? []).map((customer) => [customer.id, customer])), [records.data?.customers])
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return (records.data?.quotes ?? [])
      .filter((quote) => status === "all" || effectiveQuoteStatus(quote) === status)
      .filter((quote) => {
        if (!term) return true
        const inquiry = inquiryById.get(quote.inquiry_id)
        const customer = inquiry ? customerById.get(inquiry.customer_id) : undefined
        return [quote.id, quote.root_quote_id, quote.revision_number, quoteReference(quote), quote.inquiry_id, quote.carrier, quote.origin, quote.destination, customer?.name, customer?.company_name]
          .some((value) => String(value ?? "").toLocaleLowerCase().includes(term))
      })
      .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [customerById, inquiryById, records.data?.quotes, search, status])

  if (records.loading) return <LoadingState rows={7} />
  if (records.error || !records.data) return <ErrorState message={records.error ?? "Could not load quotes."} onRetry={records.reload} />

  return <div>
    <PageHeader title="Quotes" description="Search every commercial offer and return to the inquiry comparison workspace." action={<Button asChild className="gap-1.5"><Link to="/quotes/new"><Plus size={16} /> New Quote</Link></Button>} />
    <div className="mb-5 flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <MagnifyingGlass size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quote, inquiry, customer, route, or carrier…" aria-label="Search quotes" className="pl-9" />
      </div>
      <Select value={status} onValueChange={(value) => setStatus(value as QuoteStatus | "all")}>
        <SelectTrigger className="w-full sm:w-44" aria-label="Filter by quote status"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.entries(STATUS_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <p className="self-center text-sm text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{visible.length}</span> result{visible.length === 1 ? "" : "s"}</p>
    </div>
    {visible.length === 0 ? <EmptyState icon={<Scales size={32} />} title="No quotes match this view" description="Try a different search or status." action={(search || status !== "all") ? <Button variant="outline" onClick={() => { setSearch(""); setStatus("all") }}>Clear filters</Button> : <Button asChild><Link to="/quotes/new">Create a quote</Link></Button>} /> : <QuoteRecords quotes={visible} inquiryById={inquiryById} customerById={customerById} />}
  </div>
}

function QuoteRecords({ quotes, inquiryById, customerById }: { quotes: Quote[]; inquiryById: Map<number, Inquiry>; customerById: Map<number, Customer> }) {
  const context = (quote: Quote) => {
    const inquiry = inquiryById.get(quote.inquiry_id)
    const customer = inquiry ? customerById.get(inquiry.customer_id) : undefined
    return { inquiry, customer }
  }
  return <>
    <div className="hidden max-h-[min(62vh,46rem)] overflow-auto rounded-xl border border-border lg:block">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]"><tr><th className="h-10 px-3 text-left font-medium">Quote / Inquiry</th><th className="px-3 text-left font-medium">Customer</th><th className="px-3 text-left font-medium">Route</th><th className="px-3 text-left font-medium">Carrier</th><th className="px-3 text-left font-medium">Source</th><th className="px-3 text-left font-medium">Status</th><th className="px-3 text-right font-medium">Total</th><th className="px-3 text-left font-medium">Valid until</th><th className="px-3 text-left font-medium">Updated</th><th className="px-3 text-right font-medium">Actions</th></tr></thead>
        <tbody>{quotes.map((quote) => { const { inquiry, customer } = context(quote); return <tr key={quote.id} className="border-t border-border transition-colors hover:bg-muted/50"><td className="p-3"><Link to={`/quotes/${quote.id}`} className="font-medium tabular-nums hover:underline">{quoteReference(quote)}</Link><p className="text-xs text-muted-foreground">Inquiry #{quote.inquiry_id}</p></td><td className="p-3">{customer?.name ?? "—"}</td><td className="p-3 whitespace-nowrap">{inquiry ? `${inquiry.origin} → ${inquiry.destination}` : `${quote.origin} → ${quote.destination}`}</td><td className="p-3">{quote.carrier ?? "—"}</td><td className="p-3">{quote.is_manual ? "Manual" : "Rate card"}</td><td className="p-3"><Badge variant="outline">{STATUS_LABEL[effectiveQuoteStatus(quote)]}</Badge></td><td className="p-3 text-right font-medium tabular-nums">{formatMoney(quote.total, quote.currency)}</td><td className="p-3 whitespace-nowrap">{formatDate(quote.valid_until)}</td><td className="p-3 whitespace-nowrap text-muted-foreground">{formatDateTime(quote.updated_at)}</td><td className="p-3 text-right"><Button asChild variant="ghost" size="sm"><Link to={`/quotes/${quote.id}`}>Open</Link></Button></td></tr>})}</tbody>
      </table>
    </div>
    <ul className="space-y-2 lg:hidden" aria-label="Quote records">{quotes.map((quote) => { const { inquiry, customer } = context(quote); return <li key={quote.id} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><div><Link to={`/quotes/${quote.id}`} className="font-medium tabular-nums hover:underline">{quoteReference(quote)}</Link><p className="mt-0.5 text-sm text-muted-foreground">{customer?.name ?? `Inquiry #${quote.inquiry_id}`}</p></div><Badge variant="outline">{STATUS_LABEL[effectiveQuoteStatus(quote)]}</Badge></div><p className="mt-3 text-sm">{inquiry ? `${inquiry.origin} → ${inquiry.destination}` : `${quote.origin} → ${quote.destination}`}</p><div className="mt-3 flex items-end justify-between gap-3"><div className="text-xs text-muted-foreground"><p>{quote.carrier ?? "Unspecified carrier"} · {quote.is_manual ? "Manual" : "Rate card"}</p><p>Valid {formatDate(quote.valid_until)}</p></div><p className="font-heading font-semibold tabular-nums">{formatMoney(quote.total, quote.currency)}</p></div></li>})}</ul>
  </>
}
