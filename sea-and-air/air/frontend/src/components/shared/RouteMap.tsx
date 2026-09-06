import { useCallback, useEffect, useRef, useState } from "react"
import { MapPin, WarningCircle } from "@phosphor-icons/react"
import { useTheme } from "next-themes"
import "maplibre-gl/dist/maplibre-gl.css"
import "./route-map.css"
import { geocodePlace } from "@/lib/geocoding"
import { buildRouteFeature, type Coordinates } from "@/lib/map-data"
import type { TransportMode } from "@/lib/api/types"

const LIGHT_STYLE = import.meta.env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron"
const DARK_STYLE = import.meta.env.VITE_MAP_DARK_STYLE_URL || "https://tiles.openfreemap.org/styles/dark"

interface RouteMapProps {
  origin: string
  destination: string
  mode: TransportMode
  reportedPosition?: string | null
  className?: string
}

function markerElement(label: string, tone: "start" | "end" | "reported") {
  const marker = document.createElement("div")
  marker.className = `route-map-marker route-map-marker--${tone}`
  marker.title = label
  marker.setAttribute("aria-label", label)
  return marker
}

export interface MappedRoute {
  key: string
  label: string
  originLabel: string
  destinationLabel: string
  origin: Coordinates
  destination: Coordinates
}

export function MapCanvas({ routes, reported, dark, onError, onSelect }: {
  routes: MappedRoute[]
  reported: Coordinates | null
  dark: boolean
  onError: () => void
  onSelect?: (key: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const selection = useRef(onSelect)
  selection.current = onSelect

  useEffect(() => {
    if (!container.current || !routes.length) return
    setLoaded(false)
    let disposed = false
    let map: import("maplibre-gl").Map | undefined
    let bounds: import("maplibre-gl").LngLatBounds | undefined
    const observer = new ResizeObserver(() => {
      map?.resize()
      if (map && bounds) map.fitBounds(bounds, { padding: 45, maxZoom: 6, duration: 0 })
    })
    observer.observe(container.current)
    const timeout = window.setTimeout(() => { if (!disposed && !map?.isStyleLoaded()) onError() }, 15000)

    import("maplibre-gl").then((maplibre) => {
      if (disposed || !container.current) return
      map = new maplibre.Map({
        container: container.current,
        style: dark ? DARK_STYLE : LIGHT_STYLE,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      })
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right")
      bounds = new maplibre.LngLatBounds()
      for (const route of routes) bounds.extend(route.origin).extend(route.destination)
      if (reported) bounds.extend(reported)
      map.fitBounds(bounds, { padding: 60, maxZoom: 6, duration: 0 })
      if (reported) {
        new maplibre.Marker({ element: markerElement("Reported position", "reported"), anchor: "center" }).setLngLat(reported).addTo(map)
      }
      map.on("load", () => {
        if (!map) return
        window.clearTimeout(timeout)
        setLoaded(true)
        map.addSource("route", { type: "geojson", data: {
          type: "FeatureCollection",
          features: routes.map((route) => ({ ...buildRouteFeature(route.origin, route.destination), properties: { key: route.key, label: route.label } })),
        } })
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": dark ? "#9eb7d4" : "#253f73",
            "line-width": 3,
            "line-opacity": 0.85,
            "line-dasharray": [2, 1.5],
          },
        })
        map.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-width": 20, "line-opacity": 0 } })
        map.on("click", "route-hit", (event) => {
          const key = event.features?.[0]?.properties?.key
          if (typeof key === "string") selection.current?.(key)
        })
        map.on("mouseenter", "route-hit", () => { if (map && selection.current) map.getCanvas().style.cursor = "pointer" })
        map.on("mouseleave", "route-hit", () => { if (map) map.getCanvas().style.cursor = "" })
        const endpoints = new Map<string, { point: Coordinates; label: string }>()
        for (const route of routes) {
          endpoints.set(route.origin.join(","), { point: route.origin, label: route.originLabel })
          endpoints.set(route.destination.join(","), { point: route.destination, label: route.destinationLabel })
        }
        map.addSource("places", { type: "geojson", cluster: true, clusterRadius: 45, data: {
          type: "FeatureCollection", features: [...endpoints.values()].map(({ point, label }) => ({ type: "Feature", properties: { label }, geometry: { type: "Point", coordinates: point } })),
        } })
        map.addLayer({ id: "place-clusters", type: "circle", source: "places", filter: ["has", "point_count"], paint: { "circle-radius": 19, "circle-color": "#21305A", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } })
        map.addLayer({ id: "cluster-labels", type: "symbol", source: "places", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#ffffff" } })
        map.addLayer({ id: "place-points", type: "circle", source: "places", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 8, "circle-color": "#659F2F", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } })
        map.on("click", "place-clusters", async (event) => {
          const feature = event.features?.[0]
          if (!map || !feature || feature.geometry.type !== "Point") return
          try {
            const zoom = await (map.getSource("places") as import("maplibre-gl").GeoJSONSource).getClusterExpansionZoom(Number(feature.properties.cluster_id))
            if (!disposed) map.easeTo({ center: feature.geometry.coordinates as Coordinates, zoom, duration: 0 })
          } catch { /* The map may have been removed during navigation. */ }
        })
        map.on("click", "place-points", (event) => {
          const feature = event.features?.[0]
          if (!map || !feature || feature.geometry.type !== "Point") return
          const point = feature.geometry.coordinates as Coordinates
          const popup = document.createElement("div")
          popup.className = "space-y-2 text-sm text-slate-900"
          const title = document.createElement("strong")
          title.textContent = String(feature.properties.label)
          popup.append(title)
          if (selection.current) for (const route of routes.filter((route) => route.origin.join(",") === point.join(",") || route.destination.join(",") === point.join(","))) {
            const button = document.createElement("button")
            button.type = "button"
            button.className = "block min-h-11 rounded border px-3 py-2 text-left focus-visible:outline-2"
            button.textContent = route.label
            button.addEventListener("click", () => selection.current?.(route.key))
            popup.append(button)
          }
          new maplibre.Popup({ maxWidth: "280px" }).setLngLat(point).setDOMContent(popup).addTo(map)
        })
        for (const layer of ["place-clusters", "place-points"]) {
          map.on("mouseenter", layer, () => { if (map) map.getCanvas().style.cursor = "pointer" })
          map.on("mouseleave", layer, () => { if (map) map.getCanvas().style.cursor = "" })
        }
      })
      map.on("error", () => { if (!disposed && !map?.isStyleLoaded()) onError() })
    }).catch(() => { if (!disposed) onError() })

    return () => {
      disposed = true
      window.clearTimeout(timeout)
      observer.disconnect()
      map?.remove()
    }
  }, [dark, onError, routes, reported])

  return <><div ref={container} className="absolute inset-0 h-full w-full" role="region" aria-label="Interactive route map" />{!loaded && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted/70 text-sm text-muted-foreground" role="status">Loading map…</div>}</>
}

export function RouteMap({ origin, destination, mode, reportedPosition, className = "" }: RouteMapProps) {
  const { resolvedTheme } = useTheme()
  const [coordinates, setCoordinates] = useState<{ origin: Coordinates; destination: Coordinates; reported: Coordinates | null } | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading")
  const [attempt, setAttempt] = useState(0)
  const [routes, setRoutes] = useState<MappedRoute[]>([])
  const onMapError = useCallback(() => setStatus("error"), [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    Promise.all([
      geocodePlace(origin, controller.signal),
      geocodePlace(destination, controller.signal),
      mode === "sea" && reportedPosition ? geocodePlace(reportedPosition, controller.signal).catch(() => null) : Promise.resolve(null),
    ]).then(([originCoordinates, destinationCoordinates, reported]) => {
      if (controller.signal.aborted) return
      if (!originCoordinates || !destinationCoordinates) {
        setCoordinates(null)
        setStatus("unavailable")
        return
      }
      setCoordinates({ origin: originCoordinates, destination: destinationCoordinates, reported })
      setRoutes([{ key: "route", label: `${origin} → ${destination}`, originLabel: origin, destinationLabel: destination, origin: originCoordinates, destination: destinationCoordinates }])
      setStatus("ready")
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && (error as { name?: string }).name !== "AbortError") setStatus("error")
    })
    return () => controller.abort()
  }, [attempt, destination, mode, origin, reportedPosition])

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-muted/30 ${className}`}>
      <div className="relative h-[300px] sm:h-[360px]">
        {status === "loading" && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground" role="status">Locating route…</div>}
        {status === "ready" && coordinates && (
          <MapCanvas
            routes={routes}
            reported={coordinates.reported}
            dark={resolvedTheme === "dark"}
            onError={onMapError}
          />
        )}
        {(status === "unavailable" || status === "error") && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <WarningCircle size={24} className="mx-auto text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium">Map unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">Your shipment route is shown below.</p>
              {status === "error" && <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 rounded-md border border-border px-3 py-2 text-sm">Retry map</button>}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-3 py-2 text-sm">
        <span className="min-w-0 break-words font-medium"><MapPin size={14} className="mr-1 inline" />{origin}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{mode === "air" ? "Route only" : "Planned route"}</span>
        <span className="min-w-0 break-words text-right font-medium">{destination}</span>
      </div>
      {mode === "sea" && reportedPosition && (
        <p className="border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">Reported position: {reportedPosition} · not live AIS</p>
      )}
      <p className="bg-card px-3 pb-2 text-[10px] text-muted-foreground">City-level route · Locations: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline">GeoNames</a></p>
    </div>
  )
}
