import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Link } from "react-router-dom"
import { MagnifyingGlass, Receipt } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAsync } from "@/hooks/useAsync"
import { invoicesApi } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"

const STATUS_LABEL: Record<string, string> = { draft: "Draft", issued: "Issued", paid: "Paid", cancelled: "Cancelled" }

type ListTab = "all" | "draft" | "issued" | "paid" | "cancelled"

export function InvoiceListPage() {
  const navigate = useNavigate()
  const invoices = useAsync(() => invoicesApi.list(), [])
  const [tab, setTab] = useState<ListTab>("all")
  const [search, setSearch] = useState("")
  const visibleInvoices = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return (invoices.data ?? []).filter((invoice) => (tab === "all" || invoice.status === tab) && (!term || [invoice.invoice_number, invoice.customer_name_snapshot, invoice.origin_snapshot, invoice.destination_snapshot, invoice.job_number_snapshot].some((value) => String(value ?? "").toLocaleLowerCase().includes(term))))
  }, [invoices.data, search, tab])

  return (
    <div>
      <PageHeader title="Invoices" description="Every invoice generated from an accepted quote." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ListTab)} className="mb-3 overflow-x-auto">
        <TabsList className="max-w-full justify-start">
          {(["all", "draft", "issued", "paid", "cancelled"] as const).map((status) => <TabsTrigger key={status} value={status}>{status === "all" ? "All" : STATUS_LABEL[status]} <span className="tabular-nums text-muted-foreground">{(invoices.data ?? []).filter((invoice) => status === "all" || invoice.status === status).length}</span></TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div className="relative mb-4"><MagnifyingGlass size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search invoices" placeholder="Search invoice, customer, job, or route…" className="pl-9" /></div>

      {invoices.loading && <LoadingState rows={5} />}
      {!invoices.loading && invoices.error && <ErrorState message={invoices.error} onRetry={invoices.reload} />}
      {!invoices.loading && !invoices.error && visibleInvoices.length === 0 && (
        <EmptyState
          icon={<Receipt size={32} />}
          title="No invoices match this view"
          description="Try another status or search."
          action={(search || tab !== "all") ? <Button variant="outline" onClick={() => { setSearch(""); setTab("all") }}>Clear filters</Button> : undefined}
        />
      )}
      {!invoices.loading && !invoices.error && visibleInvoices.length > 0 && (
        <><div className="hidden max-h-[min(62vh,46rem)] overflow-auto rounded-xl border border-border lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleInvoices.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                >
                  <TableCell className="font-medium tabular-nums">
                    <Link
                      to={`/invoices/${invoice.id}`}
                      className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {invoice.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell>{invoice.customer_name_snapshot}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {invoice.origin_snapshot} → {invoice.destination_snapshot}
                  </TableCell>
                  <TableCell>
                    <Badge variant={invoice.status === "cancelled" ? "secondary" : "outline"}>
                      {STATUS_LABEL[invoice.status] ?? invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatDate(invoice.issued_date)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(invoice.total, invoice.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="space-y-2 lg:hidden" aria-label="Invoices">{visibleInvoices.map((invoice) => <li key={invoice.id} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><div><Link to={`/invoices/${invoice.id}`} className="font-medium tabular-nums hover:underline">{invoice.invoice_number}</Link><p className="text-sm text-muted-foreground">{invoice.customer_name_snapshot}</p></div><Badge variant={invoice.status === "cancelled" ? "secondary" : "outline"}>{STATUS_LABEL[invoice.status] ?? invoice.status}</Badge></div><p className="mt-3 text-sm">{invoice.origin_snapshot} → {invoice.destination_snapshot}</p><div className="mt-3 flex items-end justify-between gap-3"><p className="text-xs text-muted-foreground">Issued {formatDate(invoice.issued_date)}</p><p className="font-heading font-semibold tabular-nums">{formatMoney(invoice.total, invoice.currency)}</p></div></li>)}</ul></>
      )}
    </div>
  )
}
