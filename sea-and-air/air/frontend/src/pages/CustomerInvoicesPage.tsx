import { Link } from "react-router-dom"
import { FileText } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Badge } from "@/components/ui/badge"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

export function CustomerInvoicesPage() {
  const { token } = useCustomerAuth()
  const invoices = useAsync(() => customerPortalApi.invoices(token!), [token])

  return (
    <div>
      <PageHeader title="Invoices" description="Every invoice issued to you." />

      {invoices.loading && <LoadingState rows={5} />}
      {!invoices.loading && invoices.error && <ErrorState message={invoices.error} onRetry={invoices.reload} />}
      {!invoices.loading && !invoices.error && (invoices.data?.length ?? 0) === 0 && (
        <EmptyState icon={<FileText size={32} />} title="No invoices yet" description="Invoices we issue you will appear here." />
      )}
      {!invoices.loading && !invoices.error && (invoices.data?.length ?? 0) > 0 && (
        <><div className="hidden overflow-x-auto rounded-xl border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Issued</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.data!.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">
                    <Link
                      to={`/customer/invoices/${invoice.id}`}
                      className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {invoice.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={invoice.status === "cancelled" ? "secondary" : "outline"}>
                      {STATUS_LABEL[invoice.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMoney(invoice.total, invoice.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatDate(invoice.issued_date)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div><ul className="space-y-2 md:hidden" aria-label="Invoices">{invoices.data!.map((invoice) => <li key={invoice.id} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><Link to={`/customer/invoices/${invoice.id}`} className="font-medium tabular-nums hover:underline">{invoice.invoice_number}</Link><Badge variant={invoice.status === "cancelled" ? "secondary" : "outline"}>{STATUS_LABEL[invoice.status]}</Badge></div><div className="mt-3 flex items-end justify-between gap-3"><p className="text-xs text-muted-foreground">Issued {formatDate(invoice.issued_date)}</p><p className="font-heading font-semibold tabular-nums">{formatMoney(invoice.total, invoice.currency)}</p></div></li>)}</ul></>
      )}
    </div>
  )
}
