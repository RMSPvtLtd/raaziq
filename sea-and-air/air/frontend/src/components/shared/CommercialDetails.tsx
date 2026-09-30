import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function CommercialDetails({ rows, clauses }: { rows: [string, string | number | null | undefined][]; clauses?: string | null }) {
  return <Card className="uppercase"><CardHeader><CardTitle className="text-base">PARTICULARS OF CONSIGNMENT</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{rows.filter(([, value]) => value != null && value !== "").map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
    {clauses && <div className="border-t pt-4"><h3 className="mb-2 font-semibold">TERMS &amp; CONDITIONS</h3><p className="whitespace-pre-wrap break-words">{clauses}</p></div>}
  </CardContent></Card>
}
