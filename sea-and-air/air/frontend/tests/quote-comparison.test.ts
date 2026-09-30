import assert from "node:assert/strict"
import test from "node:test"

import { comparisonMatrix, effectiveQuoteStatus, manualSubtotal, prepareQuoteComparison, quoteReference } from "../src/lib/quote-comparison.ts"

test("comparison keeps current offers, sorts by real totals, and names one lowest price", () => {
  const quotes = [
    { id: 3, is_current: false, currency: "USD", total: "80.00" },
    { id: 2, is_current: true, currency: "USD", total: "125.00" },
    { id: 1, is_current: true, currency: "USD", total: "100.00" },
  ]

  assert.deepEqual(prepareQuoteComparison(quotes), {
    quotes: [quotes[2], quotes[1]],
    lowestQuoteId: 1,
  })
})

test("comparison does not claim a lowest price across currencies", () => {
  const quotes = [
    { id: 1, is_current: true, currency: "USD", total: "100.00" },
    { id: 2, is_current: true, currency: "PKR", total: "50.00" },
  ]

  assert.equal(prepareQuoteComparison(quotes).lowestQuoteId, null)
})

test("lowest price applies only while comparing available unexpired offers", () => {
  const base = { is_current: true, currency: "USD", valid_until: "2026-09-28" }
  const offers = [
    { ...base, id: 1, total: "1", status: "accepted" as const },
    { ...base, id: 2, total: "2", status: "draft" as const, valid_until: "2026-09-27" },
    { ...base, id: 3, total: "3", status: "sent" as const },
    { ...base, id: 4, total: "4", status: "draft" as const },
  ]
  const now = new Date("2026-09-28T12:00:00")
  assert.equal(prepareQuoteComparison(offers, now).lowestQuoteId, 3)
  assert.equal(prepareQuoteComparison(offers.slice(0, 3), now).lowestQuoteId, null)
})

test("comparison matrix aligns charge kinds across carriers", () => {
  const rows = comparisonMatrix([
    { id: 1, line_items: [{ kind: "freight", final_total: "100" }, { kind: "handling", final_total: "25" }] },
    { id: 2, line_items: [{ kind: "freight", final_total: "90" }, { kind: "documentation", final_total: "10" }, { kind: "freight", final_total: "5" }] },
  ])

  assert.deepEqual(rows, [
    { kind: "freight", label: "Freight", amounts: { 1: 100, 2: 95 } },
    { kind: "documentation", label: "Documentation", amounts: { 1: null, 2: 10 } },
    { kind: "handling", label: "Handling", amounts: { 1: 25, 2: null } },
  ])
})

test("manual subtotal uses only finite entered amounts", () => {
  assert.equal(manualSubtotal([{ amount: "100.25" }, { amount: "20" }, { amount: "" }, { amount: "invalid" }]), 120.25)
})

test("quote reference follows the displayed revision family", () => {
  assert.equal(quoteReference({ id: 21, root_quote_id: 8, revision_number: 3 }), "Q-8 Rev 3")
  assert.equal(quoteReference({ id: 9, root_quote_id: null, revision_number: 1 }), "Q-9 Rev 1")
})

test("effective status mirrors backend lazy expiry for draft and sent quotes", () => {
  assert.equal(effectiveQuoteStatus({ status: "draft", valid_until: "2026-09-01" }, new Date("2026-09-02T12:00:00")), "expired")
  assert.equal(effectiveQuoteStatus({ status: "sent", valid_until: "2026-09-02" }, new Date("2026-09-02T23:59:00")), "sent")
  assert.equal(effectiveQuoteStatus({ status: "accepted", valid_until: "2026-08-01" }, new Date("2026-09-02T12:00:00")), "accepted")
})
