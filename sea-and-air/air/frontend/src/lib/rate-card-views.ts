import type { RateCardInput } from "./api/types"

export function localDate(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export function copyRateForToday(card: RateCardInput, today = localDate()): RateCardInput {
  return { ...card, valid_from: today, valid_until: today, breaks: card.breaks.map((item) => ({ ...item })), charges: card.charges.map((item) => ({ ...item })) }
}

export type RateCardView = "all" | "active" | "expiring" | "expired"

export function rateCardMatchesView(
  card: { valid_from: string; valid_until: string },
  view: RateCardView,
  today = localDate(),
) {
  if (view === "all") return true
  if (view === "expired") return card.valid_until < today
  const active = card.valid_from <= today && card.valid_until >= today
  if (view === "active") return active
  const threshold = new Date(`${today}T00:00:00Z`)
  threshold.setUTCDate(threshold.getUTCDate() + 14)
  return active && card.valid_until <= threshold.toISOString().slice(0, 10)
}
