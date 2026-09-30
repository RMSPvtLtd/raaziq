import { useMemo, useState } from "react"
import { toast } from "sonner"
import { CalendarBlank, DotsThree, MagnifyingGlass, Plus, Trash } from "@phosphor-icons/react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AirlineInput } from "@/components/shared/AirlineInput"
import { CargoSources } from "@/components/shared/CargoSources"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useAsync } from "@/hooks/useAsync"
import { airlineSchedulesApi, ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"
import { filterSchedules } from "@/lib/schedule-filters"
import type { AirlineSchedule, AirlineScheduleInput, DayOfWeek, TransportMode } from "@/lib/api/types"

const MODES: TransportMode[] = ["air", "sea", "road"]
const DAYS: { value: DayOfWeek; label: string }[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
]

function emptyForm(): AirlineScheduleInput {
  return { airline_name: "", origin: "", destination: "", mode: "air", days_of_week: [], notes: null }
}

function toInput(s: AirlineSchedule): AirlineScheduleInput {
  return {
    airline_name: s.airline_name,
    origin: s.origin,
    destination: s.destination,
    mode: s.mode,
    days_of_week: s.days_of_week,
    notes: s.notes,
    flight_number: s.flight_number, routing: s.routing, departure_time: s.departure_time,
    transit_time: s.transit_time, valid_from: s.valid_from, valid_until: s.valid_until,
  }
}

export function AirlineSchedulesAdminPage() {
  const schedules = useAsync(() => airlineSchedulesApi.list(), [])
  const [search, setSearch] = useState("")
  const [day, setDay] = useState<DayOfWeek | "all">("all")
  const [lane, setLane] = useState("all")
  const [carrier, setCarrier] = useState("all")
  const lanes = [...new Set((schedules.data ?? []).map((s) => `${s.origin} → ${s.destination}`))].sort()
  const carriers = [...new Set((schedules.data ?? []).map((s) => s.airline_name))].sort()
  const visible = useMemo(() => filterSchedules(schedules.data ?? [], { search, day, lane, carrier }), [day, lane, carrier, schedules.data, search])

  return (
    <div className="uppercase">
      <PageHeader
        title="Flight Schedule"
        description="Weekly lane reference for ops planning. Saved with matching quotes; subject to availability, not a confirmed booking."
        action={<ScheduleFormDialog onSaved={schedules.reload} />}
      />
      <CargoSources context="schedule" />

      {schedules.loading && <LoadingState rows={3} />}
      {!schedules.loading && schedules.error && <ErrorState message={schedules.error} onRetry={schedules.reload} />}
      {!schedules.loading && !schedules.error && (schedules.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={<CalendarBlank size={32} />}
          title="No flight schedules yet"
          description="Add an airline's weekly schedule for a lane so ops can reference it when planning a shipment."
        />
      )}

      {!schedules.loading && !schedules.error && (schedules.data?.length ?? 0) > 0 && <>
        <div className="mb-3 flex items-center gap-2"><Badge variant="outline">Reference only</Badge><p className="text-xs text-muted-foreground">Confirm live capacity with the airline.</p></div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Select value={lane} onValueChange={setLane}><SelectTrigger className="w-full sm:w-52" aria-label="Filter schedule lane"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All lanes</SelectItem>{lanes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Select value={carrier} onValueChange={setCarrier}><SelectTrigger className="w-full sm:w-44" aria-label="Filter schedule carrier"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All carriers</SelectItem>{carriers.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <div className="relative min-w-0 flex-1"><MagnifyingGlass size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search airline schedules" placeholder="Search airline, route, or mode…" className="pl-9" /></div>
          <Select value={day} onValueChange={(value) => setDay(value as DayOfWeek | "all")}><SelectTrigger className="w-full sm:w-44" aria-label="Filter schedules by day"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All days</SelectItem>{DAYS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
          <p className="self-center text-sm text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{visible.length}</span> result{visible.length === 1 ? "" : "s"}</p>
        </div>
        {visible.length === 0 ? <EmptyState icon={<CalendarBlank size={32} />} title="No schedules match this view" description="Try another airline, route, or day." action={<Button variant="outline" onClick={() => { setSearch(""); setDay("all"); setLane("all"); setCarrier("all") }}>Clear filters</Button>} /> : <ScheduleRecords schedules={visible} onChanged={schedules.reload} />}
      </>}
    </div>
  )
}

function ScheduleRecords({ schedules, onChanged }: { schedules: AirlineSchedule[]; onChanged: () => void }) {
  return <>
    <div className="hidden max-h-[min(62vh,46rem)] overflow-auto rounded-xl border border-border lg:block">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]"><tr><th className="h-10 px-3 text-left font-medium">Airline</th><th className="px-3 text-left font-medium">Lane</th><th className="px-3 text-left font-medium">Mode</th>{DAYS.map((item) => <th key={item.value} className="px-2 text-center font-medium">{item.label}</th>)}<th className="px-3 text-left font-medium">Notes</th><th className="px-3 text-right font-medium">Actions</th></tr></thead>
        <tbody>{schedules.map((schedule) => <tr key={schedule.id} className="border-t border-border hover:bg-muted/40"><td className="p-3 font-medium">{schedule.airline_name}<ScheduleDetails schedule={schedule} /></td><td className="p-3 whitespace-nowrap">{schedule.origin} → {schedule.destination}</td><td className="p-3"><Badge variant="outline" className="text-[10px] uppercase">{schedule.mode}</Badge></td>{DAYS.map((item) => <td key={item.value} className="p-2 text-center" aria-label={`${item.label}: ${schedule.days_of_week.includes(item.value) ? "operates" : "does not operate"}`}><span aria-hidden="true" className={cn("inline-block size-2 rounded-full", schedule.days_of_week.includes(item.value) ? "bg-primary" : "bg-muted-foreground/20")} /></td>)}<td className="max-w-56 truncate p-3 text-muted-foreground" title={schedule.notes ?? undefined}>{schedule.notes || "—"}</td><td className="p-3"><ScheduleActions schedule={schedule} onChanged={onChanged} /></td></tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-3 lg:hidden">{schedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} onChanged={onChanged} />)}</div>
  </>
}

function ScheduleActions({ schedule, onChanged }: { schedule: AirlineSchedule; onChanged: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await airlineSchedulesApi.remove(schedule.id)
      toast.success("Schedule deleted")
      setConfirmOpen(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete schedule.")
    } finally {
      setDeleting(false)
    }
  }

  return <div className="flex items-center justify-end gap-2"><ScheduleFormDialog schedule={schedule} onSaved={onChanged} /><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`More actions for ${schedule.airline_name}`}><DotsThree size={20} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}><Trash size={14} /> Delete schedule</DropdownMenuItem></DropdownMenuContent></DropdownMenu><ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Delete schedule?" description={`${schedule.airline_name} · ${schedule.origin} → ${schedule.destination}. This removes the weekly planning reference.`} pending={deleting} onConfirm={handleDelete} /></div>
}

function ScheduleRow({ schedule, onChanged }: { schedule: AirlineSchedule; onChanged: () => void }) {

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-heading text-sm font-semibold text-foreground">{schedule.airline_name}</p>
              <Badge variant="outline" className="text-[11px] uppercase">
                {schedule.mode}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {schedule.origin} &rarr; {schedule.destination}
            </p>
          </div>
          <ScheduleActions schedule={schedule} onChanged={onChanged} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <span
              key={d.value}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium",
                schedule.days_of_week.includes(d.value)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {d.label}
            </span>
          ))}
        </div>

        <ScheduleDetails schedule={schedule} />
        {schedule.notes && <p className="text-sm text-muted-foreground">{schedule.notes}</p>}
      </CardContent>
    </Card>
  )
}

function ScheduleFormDialog({ schedule, onSaved }: { schedule?: AirlineSchedule; onSaved: () => void }) {
  const editing = Boolean(schedule)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<AirlineScheduleInput>(schedule ? toInput(schedule) : emptyForm())

  function resetForm() {
    setForm(schedule ? toInput(schedule) : emptyForm())
  }

  function toggleDay(day: DayOfWeek) {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(day)
        ? f.days_of_week.filter((d) => d !== day)
        : [...f.days_of_week, day],
    }))
  }

  const valid = form.airline_name.trim() && form.origin.trim() && form.destination.trim() && form.days_of_week.length > 0 && (form.mode !== "air" || (/^[A-Z]{3}$/.test(form.origin) && /^[A-Z]{3}$/.test(form.destination))) && (!form.valid_from || !form.valid_until || form.valid_until >= form.valid_from)

  async function handleSubmit() {
    if (!valid) return
    setSubmitting(true)
    try {
      const payload: AirlineScheduleInput = {
        ...form,
        airline_name: form.airline_name.trim(),
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        notes: form.notes?.trim() || null,
      }
      if (editing && schedule) {
        await airlineSchedulesApi.update(schedule.id, payload)
        toast.success("Schedule updated")
      } else {
        await airlineSchedulesApi.create(payload)
        toast.success("Schedule created")
      }
      setOpen(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save schedule.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <Plus size={14} />
            New schedule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl! overflow-y-auto uppercase">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit flight schedule" : "New flight schedule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="schedule-airline">Airline</Label>
              <AirlineInput
                id="schedule-airline"
                value={form.airline_name}
                onChange={(e) => setForm((f) => ({ ...f, airline_name: e.target.value.toUpperCase() }))}
                placeholder="EMIRATES"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-origin">Origin</Label>
              <Input id="schedule-origin" value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value.toUpperCase() }))} placeholder="LHE" maxLength={form.mode === "air" ? 3 : undefined} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-destination">Destination</Label>
              <Input
                id="schedule-destination"
                value={form.destination}
                onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value.toUpperCase() }))}
                placeholder="DXB / LHR" maxLength={form.mode === "air" ? 3 : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as TransportMode }))}>
                <SelectTrigger className="w-full" aria-label="Transport mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {([['flight_number', 'FLIGHT NUMBER', 'text', 40], ['routing', 'ROUTING (AIRPORT CODES)', 'text', 200], ['departure_time', 'DEPARTURE (ORIGIN LOCAL TIME)', 'time', undefined], ['transit_time', 'TRANSIT TIME', 'text', 120], ['valid_from', 'VALID FROM', 'date', undefined], ['valid_until', 'VALID UNTIL', 'date', undefined]] as const).map(([key, label, type, maxLength]) => <div key={key} className="space-y-1.5"><Label htmlFor={"schedule-" + key}>{label}</Label><Input id={"schedule-" + key} type={type} maxLength={maxLength} value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.toUpperCase() || null }))} /></div>)}
          </div>

          <div className="space-y-1.5">
            <Label>Days flown</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const active = form.days_of_week.includes(d.value)
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDay(d.value)}
                    className={cn(
                      "min-h-11 min-w-11 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-transparent text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-notes">Notes</Label>
            <Textarea
              id="schedule-notes"
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
              placeholder="Optional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Create schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleDetails({ schedule: s }: { schedule: AirlineSchedule }) {
  return <div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground">{(s.flight_number || s.departure_time) && <p>{s.flight_number}{s.departure_time ? " · " + s.departure_time + " LOCAL" : ""}</p>}{s.routing && <p>{s.routing}</p>}{s.transit_time && <p>TRANSIT: {s.transit_time}</p>}{(s.valid_from || s.valid_until) && <p>{s.valid_from ?? "OPEN"} – {s.valid_until ?? "OPEN"}</p>}</div>
}
