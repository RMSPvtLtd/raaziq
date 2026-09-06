import { useCallback, useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { MapCanvas, type MappedRoute } from "./RouteMap"
import { geocodePlace } from "@/lib/geocoding"
import type { OverviewLane } from "@/lib/overview"
import { Button } from "@/components/ui/button"

export function NetworkMap({ lanes, onSelect }: { lanes: OverviewLane[]; onSelect: (key: string) => void }) {
  const { resolvedTheme } = useTheme()
  const [routes, setRoutes] = useState<MappedRoute[]>([])
  const [status, setStatus] = useState("loading")
  const [attempt, setAttempt] = useState(0)
  const onError = useCallback(() => setStatus("error"), [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    const places = [...new Set(lanes.flatMap((lane) => [lane.origin, lane.destination]))]
    Promise.all(places.map(async (place) => [place, await geocodePlace(place, controller.signal).catch(() => null)] as const)).then((entries) => {
      if (controller.signal.aborted) return
      const points = new Map(entries)
      setRoutes(lanes.flatMap((lane) => {
        const origin = points.get(lane.origin)
        const destination = points.get(lane.destination)
        return origin && destination ? [{ key: lane.key, label: `${lane.origin} → ${lane.destination} · ${lane.mode.toUpperCase()}`, originLabel: lane.origin, destinationLabel: lane.destination, origin, destination }] : []
      }))
      setStatus("ready")
    })
    return () => controller.abort()
  }, [lanes, attempt])

  return <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
    <div className="relative h-[360px] sm:h-[480px]">
      {status === "ready" && routes.length > 0 ? <MapCanvas routes={routes} reported={null} dark={resolvedTheme === "dark"} onError={onError} onSelect={onSelect} /> : <div className="absolute inset-0 grid place-items-center px-6 text-center" role="status"><div>
        <p className="font-medium">{status === "loading" ? "Locating active lanes…" : lanes.length === 0 ? "No active lanes in this view" : "Map unavailable"}</p>
        {status !== "loading" && <p className="mt-1 text-sm text-muted-foreground">Shipment routes remain available in the lane list.</p>}
        {status === "error" && <Button variant="outline" className="mt-3" onClick={() => setAttempt((value) => value + 1)}>Retry map</Button>}
      </div></div>}
    </div>
    {status === "ready" && routes.length < lanes.length && <Button variant="ghost" className="m-2" onClick={() => setAttempt((value) => value + 1)}>Retry missing locations</Button>}
    <p className="border-t bg-card px-4 py-3 text-xs text-muted-foreground">City-level planned routes · Not live vehicle tracking · Locations: <a href="https://www.geonames.org/" className="underline" target="_blank" rel="noreferrer">GeoNames</a>{status === "ready" && routes.length < lanes.length ? ` · ${lanes.length - routes.length} lane(s) could not be located` : ""}</p>
  </div>
}
