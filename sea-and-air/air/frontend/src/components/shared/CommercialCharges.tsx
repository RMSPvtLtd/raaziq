import { Fragment } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatMoney } from "@/lib/format"

type Line = { id: number; kind: string; description: string; quantity: string; unit_price: string; amount?: string; final_total?: string }

export function CommercialCharges({ items, currency }: { items: Line[]; currency: string }) {
  const kinds = [...new Set(["freight", "documentation", "customs", "pickup", "handling", "other", ...items.map((item) => item.kind)])].filter((kind) => items.some((item) => item.kind === kind))
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>DESCRIPTION</TableHead><TableHead className="text-right">QUANTITY</TableHead><TableHead className="text-right">UNIT RATE</TableHead><TableHead className="text-right">AMOUNT</TableHead></TableRow></TableHeader><TableBody>
    {kinds.map((kind) => <Fragment key={kind}><TableRow className="bg-muted/50"><TableCell colSpan={4} className="font-semibold uppercase">{kind} CHARGES</TableCell></TableRow>{items.filter((item) => item.kind === kind).map((item) => <TableRow key={item.id}><TableCell className="min-w-40 whitespace-normal uppercase">{item.description}</TableCell><TableCell className="text-right tabular-nums">{item.quantity}</TableCell><TableCell className="text-right tabular-nums">{new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(item.amount ?? item.final_total ?? 0) / (Number(item.quantity) || 1))} {currency}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(item.amount ?? item.final_total ?? "0", currency)}</TableCell></TableRow>)}</Fragment>)}
  </TableBody></Table></div>
}
