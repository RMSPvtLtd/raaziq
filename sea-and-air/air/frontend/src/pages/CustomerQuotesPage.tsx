import { Link } from "react-router-dom"
import { Receipt } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAsync } from "@/hooks/useAsync"
import { useCustomerAuth } from "@/hooks/useCustomerAuth"
import { customerPortalApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import { prepareQuoteComparison } from "@/lib/quote-comparison"
import type { Quote, QuoteStatus } from "@/lib/api/types"

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  expired: "Expired",
  rejected: "Rejected",
}

// Preserves the API's own order (most recently active first) -- each
// inquiry's quotes stay grouped together the first time that inquiry_id is
// seen, so groups don't need a separate sort pass.
function groupByInquiry(quotes: Quote[]): Quote[][] {
  const order: number[] = []
  const groups = new Map<number, Quote[]>()
  for (const q of quotes) {
    if (!groups.has(q.inquiry_id)) {
      order.push(q.inquiry_id)
      groups.set(q.inquiry_id, [])
    }
    groups.get(q.inquiry_id)!.push(q)
  }
  return order.map((id) => groups.get(id)!)
}

export function CustomerQuotesPage() {
  const { token } = useCustomerAuth()
  const quotes = useAsync(() => customerPortalApi.quotes(token!), [token])

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Every quote we've prepared for you -- when a lane has more than one carrier option, they're grouped together for comparison."
      />

      {quotes.loading && <LoadingState rows={5} />}
      {!quotes.loading && quotes.error && <ErrorState message={quotes.error} onRetry={quotes.reload} />}
      {!quotes.loading && !quotes.error && (quotes.data?.length ?? 0) === 0 && (
        <EmptyState icon={<Receipt size={32} />} title="No quotes yet" description="Quotes you request will appear here." />
      )}
      {!quotes.loading && !quotes.error && (quotes.data?.length ?? 0) > 0 && (
        <div className="space-y-4">
          {groupByInquiry(quotes.data!).map((group) => (
            <InquiryGroupCard key={group[0].inquiry_id} quotes={group} />
          ))}
        </div>
      )}
    </div>
  )
}

function InquiryGroupCard({ quotes }: { quotes: Quote[] }) {
  const first = quotes[0]
  const { quotes: current, lowestQuoteId } = prepareQuoteComparison(quotes)
  const superseded = quotes.filter((q) => !q.is_current)
  const ordered = [...current, ...superseded]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {first.origin} → {first.destination}
          {current.length > 1 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{current.length} carrier options</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((quote) => (
                <TableRow key={quote.id} className={!quote.is_current ? "opacity-60" : undefined}>
                  <TableCell className="font-medium tabular-nums">
                    <Link
                      to={`/customer/quotes/${quote.id}`}
                      className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Q-{quote.root_quote_id ?? quote.id} Rev {quote.revision_number}
                    </Link>
                  </TableCell>
                  <TableCell>{quote.carrier ?? "—"}{quote.id === lowestQuoteId && <Badge className="ml-2 bg-status-success-bg text-status-success">Lowest price</Badge>}</TableCell>
                  <TableCell className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{STATUS_LABEL[quote.status]}</Badge>
                    {!quote.is_current && <Badge variant="secondary">Superseded</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMoney(quote.total, quote.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatDate(quote.valid_until)}
                  </TableCell>
                  <TableCell className="text-right"><div className="flex justify-end gap-2"><Button asChild variant="outline" size="sm"><Link to={`/customer/quotes/${quote.id}`}>View breakdown</Link></Button>{quote.is_current && (quote.status === "draft" || quote.status === "sent") && <Button asChild size="sm"><Link to={`/customer/quotes/${quote.id}?accept=true`}>Select offer</Link></Button>}</div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="space-y-2 p-4 md:hidden" aria-label="Carrier offers">{ordered.map((quote) => <li key={quote.id} className={!quote.is_current ? "rounded-lg border border-border p-3 opacity-60" : "rounded-lg border border-border p-3"}><div className="flex items-start justify-between gap-3"><div><Link to={`/customer/quotes/${quote.id}`} className="font-medium tabular-nums hover:underline">Q-{quote.root_quote_id ?? quote.id} Rev {quote.revision_number}</Link><p className="text-sm text-muted-foreground">{quote.carrier ?? "Unspecified carrier"}</p></div><Badge variant="outline">{STATUS_LABEL[quote.status]}</Badge></div><div className="mt-3 flex items-end justify-between gap-3"><p className="text-xs text-muted-foreground">Valid {formatDate(quote.valid_until)}</p><div className="text-right">{quote.id === lowestQuoteId && <p className="text-xs text-status-success">Lowest price</p>}<p className="font-heading font-semibold tabular-nums">{formatMoney(quote.total, quote.currency)}</p></div></div><div className="mt-3 grid grid-cols-2 gap-2"><Button asChild variant="outline" size="sm"><Link to={`/customer/quotes/${quote.id}`}>View breakdown</Link></Button>{quote.is_current && (quote.status === "draft" || quote.status === "sent") && <Button asChild size="sm"><Link to={`/customer/quotes/${quote.id}?accept=true`}>Select offer</Link></Button>}</div></li>)}</ul>
      </CardContent>
    </Card>
  )
}
