import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { CheckCircle } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { useCustomerAuth } from "@/hooks/useCustomerAuth"
import { ApiError, customerPortalApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import { effectiveQuoteStatus } from "@/lib/quote-comparison"

const KIND_LABEL: Record<string, string> = {
  freight: "Freight",
  documentation: "Documentation",
  customs: "Customs",
  pickup: "Pickup",
  handling: "Handling",
  other: "Other",
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  expired: "Expired",
  rejected: "Rejected",
}

function AcceptQuoteCard({ quoteId, carrier, amount, currency, defaultOpen, onAccepted }: { quoteId: number; carrier: string | null; amount: string; currency: string; defaultOpen: boolean; onAccepted: () => void }) {
  const { token } = useCustomerAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(defaultOpen)
  const [accepting, setAccepting] = useState(false)

  async function handleAccept() {
    setAccepting(true)
    try {
      const shipment = await customerPortalApi.acceptQuote(token!, quoteId)
      toast.success("Quote accepted -- your job has been opened")
      setOpen(false)
      onAccepted()
      navigate(`/customer/shipments/${shipment.id}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not accept this quote.")
    } finally {
      setAccepting(false)
    }
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-sm text-muted-foreground">Ready to proceed with this quote?</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <CheckCircle size={16} />
              Accept this quote
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Accept {carrier ?? "this carrier"} for {formatMoney(amount, currency)}?</DialogTitle>
              <DialogDescription>
                This confirms the selected carrier and total, then opens your shipment job. Other carrier options
                for this inquiry will no longer be available.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={accepting}>
                Cancel
              </Button>
              <Button onClick={handleAccept} disabled={accepting}>
                {accepting ? "Accepting…" : `Accept ${formatMoney(amount, currency)}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

export function CustomerQuoteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { token } = useCustomerAuth()
  const quoteId = Number(id)
  const [searchParams] = useSearchParams()

  const quote = useAsync(() => customerPortalApi.quote(token!, quoteId), [token, quoteId])

  if (quote.loading) return <LoadingState rows={5} />
  if (quote.error || !quote.data) return <ErrorState message={quote.error ?? "Quote not found."} onRetry={quote.reload} />

  const q = quote.data
  const status = effectiveQuoteStatus(q)
  const canAccept = q.is_current && (status === "draft" || status === "sent")

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={`Quote #${q.root_quote_id ?? q.id} Rev ${q.revision_number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{STATUS_LABEL[status]}</Badge>
            {q.carrier && <Badge variant="outline">{q.carrier}</Badge>}
            {!q.is_current && <Badge variant="secondary">Superseded</Badge>}
            <span>Valid until {formatDate(q.valid_until)}</span>
          </span>
        }
      />

      {q.status === "accepted" && (
        <div className="flex items-center gap-2 rounded-xl border border-status-success/20 bg-status-success/5 px-4 py-3 text-sm text-status-success">
          <CheckCircle size={18} weight="fill" />
          This quote has been accepted and your job has been opened.
        </div>
      )}

      {!q.is_current && q.status !== "accepted" && (
        <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This offer is no longer available -- either a newer revision replaced it, or a different carrier option
          was accepted instead. Contact us if you have questions.
        </div>
      )}

      {q.status === "rejected" && q.rejected_reason && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span className="font-medium">Declined:</span> {q.rejected_reason}
        </div>
      )}

      {canAccept && <AcceptQuoteCard quoteId={q.id} carrier={q.carrier} amount={q.total} currency={q.currency} defaultOpen={searchParams.get("accept") === "true"} onAccepted={quote.reload} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price breakdown</CardTitle>
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
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(li.final_total, q.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 py-5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(q.subtotal, q.currency)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Markup</span>
            <span className="tabular-nums">{formatMoney(q.markup_amount, q.currency)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(q.total, q.currency)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
