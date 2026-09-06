import { Check } from "@phosphor-icons/react"
import { journeyRail } from "@/lib/shipment-operations"
import { cn } from "@/lib/utils"
import type { ShipmentStage, StageMeta } from "@/lib/api/types"

export function JourneyRail({ stages, currentStage }: { stages: StageMeta[]; currentStage: ShipmentStage }) {
  const items = journeyRail(stages, currentStage)

  if (!items.length) return null

  return (
    <ol className="grid w-full grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:flex" aria-label="Condensed shipment journey">
      {items.map((item) => (
        <li key={item.label} className={cn("min-w-0 flex-1 border-t-2 px-1 pt-3 text-center", item.state === "current" ? "border-status-info" : item.state === "completed" ? "border-status-success/50" : "border-border")}>
          <div className="flex min-w-0 flex-col items-center text-center">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs",
                item.state === "completed" && "border-status-success bg-status-success text-status-success-foreground",
                item.state === "current" && "border-status-info bg-status-info-bg text-status-info",
                item.state === "upcoming" && "border-border bg-background text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {item.state === "completed" ? <Check size={13} weight="bold" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className={cn("mt-1 text-xs font-medium", item.state === "upcoming" && "text-muted-foreground")}>{item.label}</span>
            {item.state === "current" && <span className="mt-0.5 text-[11px] text-status-info">Current</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}
