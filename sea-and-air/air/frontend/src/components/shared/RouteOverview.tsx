import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RouteMap } from "@/components/shared/RouteMap"
import type { TransportMode } from "@/lib/api/types"

const MODE_LABEL: Record<TransportMode, string> = { air: "Air", sea: "Sea", road: "Road" }

export function RouteOverview({ origin, destination, mode, reportedPosition }: { origin: string; destination: string; mode: TransportMode; reportedPosition?: string | null }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Route overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <RouteMap origin={origin} destination={destination} mode={mode} reportedPosition={reportedPosition} />
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{MODE_LABEL[mode]} route</p>
      </CardContent>
    </Card>
  )
}
