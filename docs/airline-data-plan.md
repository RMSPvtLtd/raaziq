# Airline cargo data and customer quote selection

Prepared 30 September 2026. This is the proposed release scope, not a claim that airline APIs are connected.

## Outcome

Start with QATAR AIRWAYS CARGO (QR), EMIRATES SKYCARGO (EK), and TURKISH CARGO (TK). An operator prepares several airline offers for one shipment request. Its customer compares the offers and chooses one. Preserve the existing markup, charge calculations, shipment workflow, quotation-to-invoice copying, and email delivery.

## What already works

- `backend/services/quotes.py:generate_quotes` creates one offer per carrier from valid rate cards for the same inquiry.
- `create_manual_quote` adds an independent carrier offer to that inquiry.
- `frontend/src/pages/InquiryQuotesPage.tsx` compares offer totals and aligned charges.
- `frontend/src/pages/CustomerQuotesPage.tsx` groups a customer's offers by inquiry and provides SELECT OFFER.
- `backend/api/customer_portal.py` checks customer ownership before acceptance.
- `accept_quote` selects one offer, closes the other open alternatives, and attaches the chosen offer to the existing shipment. It does not book airline cargo capacity.
- Invoices retain the selected quotation's commercial details. Sending a quotation and creating an invoice use the existing email workflow.

These paths must be reused, not rebuilt. Offers for the same shipment must share the SAME inquiry ID; separate shipment requests do not form one comparison group.

## Free access: what was verified

| Service | Available route | Limitation |
| --- | --- | --- |
| CargoAi CargoMART | Free portal plan advertises live capacity, rates and searches, subject to moderate usage; one user and one office | Does not establish free production API access or availability for every airline/lane/account |
| CargoAi CargoCONNECT | API searches shipment-specific routes, schedules, rates and availability; free testing environment advertised | Requires an API key and the applicable subscription/approval; production price and Raaziq's access are unconfirmed |
| Emirates SkyCargo | Official cargo portal, marketplaces and direct host-to-host API | Direct integration must be arranged with Emirates; no verified unrestricted free production API |
| Qatar Airways Cargo | Official portal and developer schedule/rate services | Developer access and applicable production entitlement must be confirmed |
| Turkish Cargo | Official schedule search, TKGO and digital sales channels | Agent/API access and account/lane eligibility must be confirmed |

No public API credentials are configured in this app. A free testing environment must stay labelled TEST; it is not evidence of live production rates.

## First release: free portal-assisted workflow

This is the proposed zero-subscription release if automatic API access is unavailable. It provides access to sources; it does NOT automatically copy or synchronise their data.

1. Add official cargo-source links for QR, EK and TK to the existing flight schedule and inquiry comparison screens. Label the links OPEN AIRLINE PORTAL and the saved rates MANUALLY ENTERED.
2. Add a CargoMART free-plan link as an alternative for looking up current offers. Account creation uses the actual operator's business details; do not invent company/agent credentials.
3. Operators search using airport codes, cargo-ready date, weight, volume, pieces and commodity. They enter the returned rate and validity into the existing manual-offer dialog, keeping source/reference information in clauses.
4. Repeat for each carrier on the same inquiry. Send the offers; the customer chooses one in the existing customer portal.
5. Confirm space/booking with the airline separately. Continue the existing invoice and email process.

Files for the first release: `sea-and-air/air/frontend/src/components/shared/CargoSources.tsx`, `sea-and-air/air/frontend/src/pages/AirlineSchedulesAdminPage.tsx` and `sea-and-air/air/frontend/src/pages/InquiryQuotesPage.tsx`. Reuse existing buttons and page styling; no new backend endpoints, migrations, libraries, background scheduler or provider abstraction.

Checks: verify all source links and mobile display; build the frontend; run existing quote comparison and customer acceptance tests. Explicitly verify that source links do not create a quote, send email, book capacity, or claim that manual schedules are live.

## Automatic integration: access-dependent release

Recommended method: one authorised aggregator connection covering QR/EK/TK on Raaziq's lanes, rather than three separate airline integrations. CargoCONNECT is a candidate, not a committed purchase. Confirm coverage and production pricing before selecting it.

1. Obtain authorised sandbox access, a representative response and approved business-user identity; confirm QR/EK/TK coverage for required origins and destinations. Store credentials only on the backend.
2. Capture the provider's actual request/response contract. CargoCONNECT documents `POST https://api.cargoai.co/solutions/search` with required `x-api-key`, airport codes and departure date; Quote & Book additionally requires shipment and user details. Schedule-only entitlement must not be treated as rate/capacity entitlement.
3. Add an operator-only, on-demand SEARCH AIRLINE OFFERS action to the existing inquiry screen. Require valid air-shipment inputs; respect provider limits and timeouts. Provider failures must leave existing rate cards and manual quotations usable.
4. Display returned carrier, routing, flights, departure times, charges/currency, retrieval time and provider validity/availability. Distinguish LIVE, TEST and MANUAL data. Do not mix currencies into a misleading cheapest-price label.
5. Only when an operator selects a returned offer, create a quotation through the existing pricing lifecycle. Preserve every airline charge and Raaziq's existing markup/local-charge logic; store source, flightUUID/rate.ID (or equivalent), retrieval time and expiry with the offer snapshot. Repeated imports must not create unintended duplicates.
6. Keep accepted quotations and invoices as historical snapshots. Do not overwrite agreed prices during refresh. Revalidate a live offer before airline booking; customer quotation acceptance alone is not booking confirmation.
7. Prove the flow in sandbox, then with an authorised read-only production search: three supported carriers where returned, customer isolation, exactly one accepted offer, quote-to-invoice details, and email status. Test missing/invalid key, timeout, empty results, unsupported lane, partial results, expired offers, mixed currency and duplicate import.
8. Review the diff independently, run affected backend tests and frontend build, then commit and push only reviewed project files. Keep samples, credentials, temporary files and unrelated local configuration out of the commit.
9. Configure authorised provider credentials on the PsaMetra Vercel API, apply any reviewed migration, deploy API then frontend, and verify the live comparison and invoice flow. Report the deployed link and exact data mode.

A precise code implementation plan for the automatic release follows the approved provider contract; no speculative connector is deployed before working access is verified.

## Sources checked

- [CargoMART pricing](https://www.cargoai.co/pricing/)
- [CargoCONNECT API product](https://www.cargoai.co/products/cargoconnect/)
- [CargoAi free testing environment](https://www.cargoai.co/)
- [CargoCONNECT search API](https://cargoai.readme.io/reference/routes-schedules-and-rates-endpoint-post)
- [CargoCONNECT search and booking flow](https://cargoai.readme.io/reference/search-book-flow)
- [Emirates digital booking channels](https://www.skycargo.com/my-shipments/digital-booking-channels/)
- [Qatar cargo portal](https://www.qrcargo.com/s/)
- [Turkish cargo schedule](https://www.turkishcargo.com/en/view-flight-schedule)
- [Turkish digital channels](https://www.turkishcargo.com/en/digital-sales-channels)

## Release status

The user selected the free portal-assisted workflow on 30 September 2026. Official source links and manual-entry guidance are implemented in the existing comparison and schedule screens. A release-review fix also closes all outdated automatic offers when legacy airline aliases collide during regeneration, preserving independent manual offers and the newest revision lineage.

Verification: frontend production build and 23 frontend checks passed; the existing backend suite passed 436 checks before the review fix, and 83 affected quote/customer/daily-rate checks passed after it, including both new alias regressions. Publish the reviewed app to GitHub and the existing PsaMetra Vercel projects, then inspect the live source panel. Automatic API data remains a separate access-dependent release. No airline rates have been fabricated or marked live.
