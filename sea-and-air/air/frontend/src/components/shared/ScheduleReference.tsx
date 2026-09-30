import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { AirlineScheduleInput } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

export function ScheduleReference({ schedules }: { schedules: AirlineScheduleInput[] | null | undefined }) {
  return <Card className="uppercase"><CardHeader><CardTitle className="text-base">WEEKLY SCHEDULE REFERENCE</CardTitle><p className="text-xs text-muted-foreground">FROZEN AT QUOTATION · SUBJECT TO AVAILABILITY · NOT A CONFIRMED BOOKING</p></CardHeader><CardContent className="space-y-3 text-sm">
    {schedules?.length ? schedules.map((s, index) => <div key={index} className="space-y-1 rounded-lg border p-3">
      <p className="font-medium">{s.airline_name} {s.flight_number} · {s.origin} → {s.destination}</p>
      <p>{s.days_of_week.join(" / ")}{s.departure_time ? ` · ${s.departure_time} ORIGIN LOCAL TIME` : ""}</p>
      {s.routing && <p>ROUTING: {s.routing}</p>}{s.transit_time && <p>TRANSIT: {s.transit_time}</p>}
      {(s.valid_from || s.valid_until) && <p>VALID: {s.valid_from ? formatDate(s.valid_from) : "OPEN"} – {s.valid_until ? formatDate(s.valid_until) : "OPEN"}</p>}
      {s.notes && <p className="whitespace-pre-wrap text-muted-foreground">{s.notes}</p>}
    </div>) : <p className="text-muted-foreground">NO WEEKLY SCHEDULE WAS RECORDED FOR THIS OFFER.</p>}
  </CardContent></Card>
}
