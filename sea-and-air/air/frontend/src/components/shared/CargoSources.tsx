import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const SOURCES = [
  { name: "QATAR AIRWAYS CARGO", url: "https://www.qrcargo.com/s/" },
  { name: "EMIRATES SKYCARGO", url: "https://www.skycargo.com/contact-support/" },
  { name: "TURKISH CARGO", url: "https://www.turkishcargo.com/en/view-flight-schedule" },
  { name: "CARGOMART", url: "https://www.cargoai.co/products/cargomart/" },
]

export function CargoSources({ context = "quote" }: { context?: "quote" | "schedule" }) {
  return <Card className="mb-6 uppercase">
    <CardContent className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-sm font-semibold">AIRLINE CARGO SOURCES</h2>
        <Badge variant="outline">MANUAL ENTRY</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Open an official portal or contact the airline to check shipment-specific rates and space. Enter the offer manually here. Portal access may require an approved business account. No automatic sync or booking.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SOURCES.map((source) => <Button key={source.name} asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-2 text-center">
          <a href={source.url} target="_blank" rel="noopener noreferrer" title={`${source.name} — opens in a new tab`}>
            {source.name}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>)}
      </div>
      <p className="text-xs text-muted-foreground">{context === "quote"
        ? "Use ADD MANUAL QUOTE for each airline offer on this same request. Set VALID UNTIL and include the source, rate reference and offer validity in QUOTATION CLAUSES before sending for customer comparison."
        : "Check the published schedule, then save it manually using NEW SCHEDULE or EDIT. Include its source and checked date in NOTES. Saved schedules are planning references only; confirm space and timing with the airline before booking."}</p>
    </CardContent>
  </Card>
}
