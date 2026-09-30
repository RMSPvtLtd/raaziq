import { useMemo, useState } from "react"
import { toast } from "sonner"
import { MagnifyingGlass, Plus, Scales, Trash } from "@phosphor-icons/react"
import { AirlineInput } from "@/components/shared/AirlineInput"
import { PageHeader } from "@/components/shared/PageHeader"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet as Dialog,
  SheetContent as DialogContent,
  SheetFooter as DialogFooter,
  SheetHeader as DialogHeader,
  SheetTitle as DialogTitle,
  SheetTrigger as DialogTrigger,
  SheetDescription,
} from "@/components/ui/sheet"
import { useAsync } from "@/hooks/useAsync"
import { rateCardsApi, ApiError } from "@/lib/api/client"
import { formatDate, formatMoney } from "@/lib/format"
import { copyRateForToday, localDate, rateCardMatchesView, type RateCardView } from "@/lib/rate-card-views"
import type {
  ChargeBasis,
  ChargeKind,
  RateCard,
  RateCardBreakInput,
  RateCardChargeInput,
  RateCardInput,
  TransportMode,
  UnitOfMeasure,
} from "@/lib/api/types"

const MODES: TransportMode[] = ["air", "sea", "road"]
const UNITS: UnitOfMeasure[] = ["per_kg", "per_cbm", "flat"]
const CHARGE_KINDS: ChargeKind[] = ["freight", "documentation", "customs", "pickup", "handling", "other"]
const CHARGE_BASES: ChargeBasis[] = ["flat", "per_kg", "percent_of_freight"]

const EMPTY_BREAK: RateCardBreakInput = {
  min_weight: null,
  max_weight: null,
  min_volume: null,
  max_volume: null,
  unit: "per_kg",
  rate: "",
  description: "",
}

const EMPTY_CHARGE: RateCardChargeInput = {
  kind: "documentation",
  description: "",
  basis: "flat",
  amount: "",
}

export function RateCardsAdminPage() {
  const rateCards = useAsync(() => rateCardsApi.list(), [])
  const [search, setSearch] = useState("")
  const [view, setView] = useState<RateCardView>("all")
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return (rateCards.data ?? []).filter((card) =>
      rateCardMatchesView(card, view) && (!term || [card.origin, card.destination, card.mode, card.carrier, card.currency]
        .some((value) => String(value ?? "").toLocaleLowerCase().includes(term)))
    )
  }, [rateCards.data, search, view])

  return (
    <div className="uppercase">
      <PageHeader
        title="Rate Cards"
        description="Daily airline rates by destination. Copy a card for today to preserve previous pricing."
        action={<RateCardFormDialog onSaved={rateCards.reload} />}
      />

      {rateCards.loading && <LoadingState rows={3} />}
      {!rateCards.loading && rateCards.error && <ErrorState message={rateCards.error} onRetry={rateCards.reload} />}
      {!rateCards.loading && !rateCards.error && (rateCards.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={<Scales size={32} />}
          title="No rate cards yet"
          description="Add a rate card for a lane before a quote can be generated for it."
        />
      )}

      {!rateCards.loading && !rateCards.error && (rateCards.data?.length ?? 0) > 0 && <>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search rate cards" placeholder="Search lane, carrier, mode, or currency…" className="pl-9" />
          </div>
          <Select value={view} onValueChange={(value) => setView(value as RateCardView)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Rate card validity view"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All rate cards</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="expiring">Expiring in 14 days</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
          </Select>
          <p className="self-center text-sm text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{visible.length}</span> result{visible.length === 1 ? "" : "s"}</p>
        </div>
        {visible.length === 0 ? <EmptyState icon={<Scales size={32} />} title="No rate cards match this view" description="Try another search or validity view." action={<Button variant="outline" onClick={() => { setSearch(""); setView("all") }}>Clear filters</Button>} /> : <RateCardRecords rateCards={visible} onChanged={rateCards.reload} />}
      </>}
    </div>
  )
}

function RateCardRecords({ rateCards, onChanged }: { rateCards: RateCard[]; onChanged: () => void }) {
  return <>
    <div className="hidden max-h-[min(62vh,46rem)] overflow-auto rounded-xl border border-border lg:block">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]"><tr><th className="h-10 px-3 text-left font-medium">Lane</th><th className="px-3 text-left font-medium">Carrier / Mode</th><th className="px-3 text-left font-medium">Validity</th><th className="px-3 text-right font-medium">Minimum</th><th className="px-3 text-left font-medium">Breaks</th><th className="px-3 text-left font-medium">Charges</th><th className="px-3 text-right font-medium">Actions</th></tr></thead>
        <tbody>{rateCards.map((card) => <tr key={card.id} className="border-t border-border hover:bg-muted/40"><td className="p-3 font-medium">{card.origin} → {card.destination}</td><td className="p-3"><span>{card.carrier || "Any carrier"}</span><Badge variant="outline" className="ml-2 text-[10px] uppercase">{card.mode}</Badge></td><td className="p-3 whitespace-nowrap"><p>{formatDate(card.valid_from)} – {formatDate(card.valid_until)}</p><p className="text-xs text-muted-foreground">{rateCardMatchesView(card, "expired") ? "Expired" : card.valid_from > localDate() ? `Starts ${formatDate(card.valid_from)}` : rateCardMatchesView(card, "expiring") ? "Expires within 14 days" : "Active"}</p></td><td className="p-3 text-right font-medium tabular-nums">{formatMoney(card.minimum_charge, card.currency)}</td><td className="p-3 tabular-nums">{card.breaks.length}</td><td className="p-3 tabular-nums">{card.charges.length}</td><td className="p-3"><RateCardActions rateCard={card} onChanged={onChanged} /></td></tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-3 lg:hidden">{rateCards.map((card) => <RateCardRow key={card.id} rateCard={card} onChanged={onChanged} />)}</div>
  </>
}

function RateCardActions({ rateCard, onChanged }: { rateCard: RateCard; onChanged: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await rateCardsApi.remove(rateCard.id)
      toast.success("Rate card deleted")
      setConfirmOpen(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete rate card.")
    } finally {
      setDeleting(false)
    }
  }

  return <div className="flex items-center justify-end gap-2"><RateCardFormDialog rateCard={rateCard} onSaved={onChanged} /><RateCardFormDialog rateCard={rateCard} copyForToday onSaved={onChanged} /><Button variant="outline" size="icon-sm" aria-label={`Delete ${rateCard.origin} to ${rateCard.destination} rate card`} disabled={deleting} onClick={() => setConfirmOpen(true)}><Trash size={14} /></Button><ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Delete rate card?" description={`${rateCard.origin} → ${rateCard.destination} · ${rateCard.carrier || "Any carrier"}. This pricing card will no longer be available for new quotes.`} pending={deleting} onConfirm={handleDelete} /></div>
}

function RateCardRow({ rateCard, onChanged }: { rateCard: RateCard; onChanged: () => void }) {

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-heading text-sm font-semibold text-foreground">
                {rateCard.origin} &rarr; {rateCard.destination}
              </p>
              <Badge variant="outline" className="text-[11px] uppercase">
                {rateCard.mode}
              </Badge>
              {rateCard.carrier && <span className="text-sm text-muted-foreground">{rateCard.carrier}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              Valid {rateCard.valid_from} &ndash; {rateCard.valid_until} &middot; {rateCard.currency}{" "}
              {rateCard.minimum_charge} minimum
            </p>
          </div>
          <RateCardActions rateCard={rateCard} onChanged={onChanged} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Breaks</p>
            <ul className="mt-1 space-y-0.5 text-sm text-foreground">
              {rateCard.breaks.map((b) => (
                <li key={b.id}>
                  {b.description || `${b.min_weight ?? "0"}–${b.max_weight ?? "∞"} ${b.unit}`}: {b.rate}{" "}
                  {rateCard.currency}
                </li>
              ))}
            </ul>
          </div>
          {rateCard.charges.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Charges</p>
              <ul className="mt-1 space-y-0.5 text-sm text-foreground">
                {rateCard.charges.map((c) => (
                  <li key={c.id}>
                    {c.description}: {c.amount} {c.basis === "percent_of_freight" ? "%" : rateCard.currency}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function toInput(rc: RateCard): RateCardInput {
  return {
    origin: rc.origin,
    destination: rc.destination,
    mode: rc.mode,
    carrier: rc.carrier,
    currency: rc.currency,
    valid_from: rc.valid_from,
    valid_until: rc.valid_until,
    minimum_charge: rc.minimum_charge,
    breaks: rc.breaks.map((b) => ({
      min_weight: b.min_weight,
      max_weight: b.max_weight,
      min_volume: b.min_volume,
      max_volume: b.max_volume,
      unit: b.unit,
      rate: b.rate,
      description: b.description,
    })),
    charges: rc.charges.map((c) => ({ kind: c.kind, description: c.description, basis: c.basis, amount: c.amount })),
  }
}

function RateCardFormDialog({ rateCard, copyForToday = false, onSaved }: { rateCard?: RateCard; copyForToday?: boolean; onSaved: () => void }) {
  const editing = Boolean(rateCard) && !copyForToday
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState<RateCardInput>(
    rateCard
      ? (copyForToday ? copyRateForToday(toInput(rateCard)) : toInput(rateCard))
      : {
          origin: "",
          destination: "",
          mode: "air",
          carrier: null,
          currency: "USD",
          valid_from: localDate(),
          valid_until: localDate(),
          minimum_charge: "",
          breaks: [EMPTY_BREAK],
          charges: [],
        }
  )

  function resetForm() {
    setForm(
      rateCard
        ? (copyForToday ? copyRateForToday(toInput(rateCard)) : toInput(rateCard))
        : {
            origin: "",
            destination: "",
            mode: "air",
            carrier: null,
            currency: "USD",
            valid_from: localDate(),
            valid_until: localDate(),
            minimum_charge: "",
            breaks: [EMPTY_BREAK],
            charges: [],
          }
    )
  }

  const valid =
    form.origin.trim() &&
    form.destination.trim() &&
    form.currency.trim().length === 3 &&
    form.valid_from &&
    form.valid_until >= form.valid_from &&
    (form.mode !== "air" || (/^[A-Z]{3}$/.test(form.origin) && /^[A-Z]{3}$/.test(form.destination))) &&
    form.minimum_charge.trim() &&
    form.breaks.length > 0 &&
    form.breaks.every((b) => b.rate.trim() && b.unit) &&
    form.charges.every((c) => c.description.trim() && c.amount.trim())

  function updateBreak(index: number, patch: Partial<RateCardBreakInput>) {
    setForm((f) => ({ ...f, breaks: f.breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }))
  }

  function updateCharge(index: number, patch: Partial<RateCardChargeInput>) {
    setForm((f) => ({ ...f, charges: f.charges.map((c, i) => (i === index ? { ...c, ...patch } : c)) }))
  }

  async function handleSubmit() {
    if (!valid) return
    setSubmitting(true)
    try {
      const payload: RateCardInput = {
        ...form,
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        carrier: form.carrier?.trim() || null,
        currency: form.currency.trim().toUpperCase(),
      }
      if (editing && rateCard) {
        await rateCardsApi.update(rateCard.id, payload)
        toast.success("Rate card updated")
      } else {
        await rateCardsApi.create(payload)
        toast.success("Rate card created")
      }
      setOpen(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save rate card.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        setOpen(next)
        if (next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        {rateCard ? (
          <Button variant="outline" size="sm">
            {copyForToday ? "COPY FOR TODAY" : "EDIT"}
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <Plus size={14} />
            New rate card
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-full! sm:max-w-6xl! gap-0 uppercase" showCloseButton={!submitting}>
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{copyForToday ? "COPY RATE FOR TODAY" : editing ? "EDIT RATE CARD" : "NEW DAILY RATE CARD"}</DialogTitle>
          <SheetDescription>Configure lane pricing, weight breaks and additional charges.</SheetDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto space-y-8 p-6">
          <h2 className="text-lg font-semibold">Lane &amp; carrier</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rate-origin">Origin</Label>
              <Input id="rate-origin" value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value.toUpperCase() }))} placeholder="LHE" maxLength={form.mode === "air" ? 3 : undefined} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-destination">Destination</Label>
              <Input
                id="rate-destination"
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
            <div className="space-y-1.5">
              <Label htmlFor="rate-carrier">Carrier</Label>
              <AirlineInput
                id="rate-carrier"
                value={form.carrier ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value.toUpperCase() || null }))}
                placeholder="Optional"
              />
            </div>
            <h2 className="mt-5 text-lg font-semibold sm:col-span-2">Commercial settings</h2>
            <div className="space-y-1.5">
              <Label htmlFor="rate-currency">Currency</Label>
              <Input
                id="rate-currency"
                value={form.currency}
                maxLength={3}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                placeholder="USD"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-minimum">Minimum charge</Label>
              <Input
                id="rate-minimum"
                type="number"
                min="0"
                step="0.01"
                value={form.minimum_charge}
                onChange={(e) => setForm((f) => ({ ...f, minimum_charge: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-valid-from">Valid from</Label>
              <Input id="rate-valid-from" type="date" value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-valid-until">Valid until</Label>
              <Input id="rate-valid-until" type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Weight / volume breaks</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, breaks: [...f.breaks, EMPTY_BREAK] }))}
              >
                <Plus size={14} /> Add break
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/50"><tr>{["Min weight", "Max weight", "Min volume", "Max volume", "Unit", "Rate", "Description", "Actions"].map((label) => <th key={label} className="p-2 text-left font-medium">{label}</th>)}</tr></thead><tbody>{form.breaks.map((b, i) => (
              <tr key={i} className="border-t [&>td]:p-2"><td>
                <Input
                  aria-label={`Break ${i + 1} minimum weight`}
                  placeholder="Min kg"
                  value={b.min_weight ?? ""}
                  onChange={(e) => updateBreak(i, { min_weight: e.target.value || null })}
                />
                </td><td>
                <Input
                  aria-label={`Break ${i + 1} maximum weight`}
                  placeholder="Max kg"
                  value={b.max_weight ?? ""}
                  onChange={(e) => updateBreak(i, { max_weight: e.target.value || null })}
                />
                </td><td><Input aria-label={`Break ${i + 1} minimum volume`} placeholder="Min cbm" value={b.min_volume ?? ""} onChange={(e) => updateBreak(i, { min_volume: e.target.value || null })} /></td><td><Input aria-label={`Break ${i + 1} maximum volume`} placeholder="Max cbm" value={b.max_volume ?? ""} onChange={(e) => updateBreak(i, { max_volume: e.target.value || null })} /></td><td>
                <Select value={b.unit} onValueChange={(v) => updateBreak(i, { unit: v as UnitOfMeasure })}>
                  <SelectTrigger aria-label={`Break ${i + 1} unit`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </td><td>
                <Input aria-label={`Break ${i + 1} rate`} placeholder="Rate" value={b.rate} onChange={(e) => updateBreak(i, { rate: e.target.value })} />
                </td><td>
                <Input
                  aria-label={`Break ${i + 1} description`}
                  placeholder="Description"
                  className="col-span-2"
                  value={b.description ?? ""}
                  onChange={(e) => updateBreak(i, { description: e.target.value || null })}
                />
                </td><td>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove break ${i + 1}`}
                  disabled={form.breaks.length <= 1}
                  onClick={() => setForm((f) => ({ ...f, breaks: f.breaks.filter((_, idx) => idx !== i) }))}
                >
                  <Trash size={14} />
                </Button>
              </td></tr>
            ))}</tbody></table></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Additional charges</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, charges: [...f.charges, EMPTY_CHARGE] }))}
              >
                <Plus size={14} /> Add charge
              </Button>
            </div>
            {form.charges.map((c, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 sm:grid-cols-6">
                <Select value={c.kind} onValueChange={(v) => updateCharge(i, { kind: v as ChargeKind })}>
                  <SelectTrigger aria-label={`Charge ${i + 1} kind`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARGE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Charge ${i + 1} description`}
                  placeholder="Description"
                  className="col-span-2"
                  value={c.description}
                  onChange={(e) => updateCharge(i, { description: e.target.value })}
                />
                <Select value={c.basis} onValueChange={(v) => updateCharge(i, { basis: v as ChargeBasis })}>
                  <SelectTrigger aria-label={`Charge ${i + 1} basis`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARGE_BASES.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input aria-label={`Charge ${i + 1} amount`} placeholder="Amount" value={c.amount} onChange={(e) => updateCharge(i, { amount: e.target.value })} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="col-span-2 justify-self-start sm:col-span-6"
                  onClick={() => setForm((f) => ({ ...f, charges: f.charges.filter((_, idx) => idx !== i) }))}
                >
                  <Trash size={14} className="mr-1" /> Remove charge
                </Button>
              </div>
            ))}
          </div>
        </div>

          <section className="rounded-lg bg-muted/50 p-4"><h2 className="font-semibold">Review</h2><p className="mt-1 text-sm text-muted-foreground">{form.origin || "Origin"} → {form.destination || "Destination"} · {form.carrier || "Any carrier"} · {form.currency} · {form.breaks.length} breaks · {form.charges.length} additional charges</p></section>
        <DialogFooter className="border-t bg-background sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={submitting} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Create rate card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
