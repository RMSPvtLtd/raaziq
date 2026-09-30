type ComparableQuote = {
  id: number
  is_current: boolean
  currency: string
  total: string
  status?: QuoteStatus
  valid_until?: string
}

type QuoteStatus = "draft" | "sent" | "accepted" | "expired" | "rejected"

const CHARGE_LABELS = {
  freight: "Freight",
  documentation: "Documentation",
  customs: "Customs",
  pickup: "Pickup",
  handling: "Handling",
  other: "Other",
} as const

type MatrixQuote = { id: number; line_items: { kind: string; final_total: string }[] }

export function comparisonMatrix(quotes: MatrixQuote[]) {
  return Object.entries(CHARGE_LABELS).flatMap(([kind, label]) => {
    const amounts = Object.fromEntries(quotes.map((quote) => {
      const matching = quote.line_items.filter((item) => item.kind === kind)
      return [quote.id, matching.length ? matching.reduce((sum, item) => sum + (Number(item.final_total) || 0), 0) : null]
    })) as Record<number, number | null>
    return Object.values(amounts).some((value) => value !== null) ? [{ kind, label, amounts }] : []
  })
}

export function prepareQuoteComparison<T extends ComparableQuote>(offers: T[], now = new Date()) {
  const quotes = offers
    .filter((quote) => quote.is_current)
    .toSorted((a, b) => a.currency.localeCompare(b.currency) || amount(a.total) - amount(b.total) || a.id - b.id)
  const available = quotes.filter((quote) => {
    const status = quote.status && quote.valid_until ? effectiveQuoteStatus({ status: quote.status, valid_until: quote.valid_until }, now) : quote.status
    return !status || status === "draft" || status === "sent"
  })
  const currencies = new Set(available.map((quote) => quote.currency))
  return { quotes, lowestQuoteId: currencies.size === 1 && available.length > 1 ? available[0].id : null }
}

export function manualSubtotal(items: { amount: string }[]) {
  return items.reduce((total, item) => total + (Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0), 0)
}

export function quoteReference(quote: { id: number; root_quote_id: number | null; revision_number: number }) {
  return `Q-${quote.root_quote_id ?? quote.id} Rev ${quote.revision_number}`
}

export function effectiveQuoteStatus(quote: { status: QuoteStatus; valid_until: string }, now = new Date()): QuoteStatus {
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  return (quote.status === "draft" || quote.status === "sent") && quote.valid_until < localToday ? "expired" : quote.status
}

function amount(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}
