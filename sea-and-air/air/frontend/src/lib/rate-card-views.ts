export type RateCardView = "all" | "active" | "expiring" | "expired"

export function rateCardMatchesView(
  card: { valid_from: string; valid_until: string },
  view: RateCardView,
  today = new Date().toISOString().slice(0, 10),
) {
  if (view === "all") return true
  if (view === "expired") return card.valid_until < today
  const active = card.valid_from <= today && card.valid_until >= today
  if (view === "active") return active
  const threshold = new Date(`${today}T00:00:00Z`)
  threshold.setUTCDate(threshold.getUTCDate() + 14)
  return active && card.valid_until <= threshold.toISOString().slice(0, 10)
}
