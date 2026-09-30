# Raaziq — Air Freight Vertical

Raaziq MVP: a Pakistan-based air-freight forwarder's two core workflows — freight
quotation automation, and shipment tracking across the forwarding lifecycle — plus a
worker portal so warehouse/ops staff mark their own stage done instead of a single admin
updating everything, and a customer portal for higher-volume clients who'd rather log in
and see everything in one place than track shipments one reference at a time. A FastAPI
backend and a React frontend with four surfaces: the ops dashboard, the worker portal, the
customer portal, and the public customer tracking page.

This is the **air** vertical of the [sea-and-air](../../sea-and-air) monorepo — a
self-contained project with its own `pyproject.toml`, `uv.lock`, migrations, and frontend.
It doesn't depend on anything in `../sea` (not built yet) or `../shared` (empty until
something is genuinely duplicated between the two verticals).

## Daily commercial workflow

Back up the target database, then run `uv run alembic upgrade head` from this
directory before starting the updated backend. Existing pricing percentages,
incoterm charge rules, permissions and the 17-stage shipment workflow remain in
place. Historical invoice snapshots are not rewritten by these migrations.

- **Rate Cards:** use **COPY FOR TODAY**, enter the day's prices, then save. The
  latest effective card per airline wins; issued quotes retain their prices.
  Generated quote validity cannot exceed the source rate's expiry.
- **Airline Schedules:** maintain weekly days, flight/routing, departure time
  (origin local time), transit notes and validity. Quotes capture a reference
  snapshot; this is not a live booking or capacity feed.
- **Quotes:** filter by destination, compare airlines, add clauses and select an
  offer. Air lanes use standard three-letter airport codes (LHE, DXB, LHR).
- **Invoices:** the chosen quote's commercial details, clauses and schedule
  reference are copied with the itemized charge headings. Supplier and internal
  pricing audit details remain restricted to operations users.

### Gmail delivery

Configure `SMTP_USERNAME` and `SMTP_PASSWORD` (a Gmail app password, requiring
2-Step Verification), with `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587` in the
backend environment. Keep credentials out of Git. Restart the backend after
changing these values. [Google's app-password instructions](https://support.google.com/mail/answer/185833).

Expand **AUTOMATIC QUOTATION & INVOICE EMAIL** on the quotations or invoices page to change each
issuing company's recipient and automatic-delivery switch. The recipient order
is company setting, `NOTIFICATION_EMAIL`, then the document customer's email.
Publishing a quotation and creating an invoice trigger automatic PDF delivery.
Draft creation and sample seeding do not send mail. A failed send leaves the
document saved, records the failure, and allows an explicit retry. This is
synchronous provider submission, not a queued delivery/receipt guarantee.
Existing Resend configuration remains supported when SMTP is absent.

### Safe sample data

For a development database, run `uv run python database/seeds/seed.py`. The seed
refuses production mode and can be rerun. It adds clearly labelled fictional
daily EMIRATES, TURKISH AIRLINES and QATAR AIRWAYS offers for LHE–DXB and LHE–LHR,
weekly reference schedules, customer comparisons and a non-payable invoice.
Run again on a new day for fresh daily examples; past offers remain unchanged.
No private `Real-Samples` files are imported or committed, and no mail is sent.

### Production database setup

Provision a persistent PostgreSQL database before deploying the air backend to
Vercel. Set `ENVIRONMENT=production`, `DATABASE_URL`, `JWT_SECRET_KEY` (at least
32 characters), `OPS_ADMIN_USERNAME`, `OPS_ADMIN_PASSWORD`, `CORS_ORIGINS`, and
the email settings in the backend environment. With those same settings locally,
run `uv run alembic upgrade head`, then
`uv run python database/seeds/bootstrap_production.py` once. The bootstrap is
idempotent and creates only the first operator and the default issuing company;
it does not publish demo rates or credentials. Change the bootstrap password
after the first login. Deploy the sea backend and frontend as their separate
Vercel projects, and point the frontend API rewrites at the deployed backends.

Development customer portal: `/customer/login`, user `demo.customer`, password
`Customer123!`. Demo credentials and rates must not be used for real operations.

## Stack

**Backend:** Python, FastAPI, SQLAlchemy 2.x (ORM), Alembic, Pydantic, PostgreSQL
(production), SQLite (tests — no PostgreSQL or Docker required to run the test suite),
pytest, uv.

**Frontend:** React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Radix primitives),
Phosphor icons, React Router.

## Project layout

```
air/
├── pyproject.toml, uv.lock, alembic.ini, .env.example   the backend project root
├── backend/
│   ├── main.py            FastAPI app, router mounting, centralized error handlers
│   ├── config.py          every tunable business value (markup %, validity days, ...)
│   ├── db.py               engine, session factory, get_db dependency
│   ├── api/                 FastAPI routers (auth, workers, worker_portal, customers,
│   │                         customer_portal, quotes, shipments, inquiries, tracking, meta)
│   ├── models/               SQLAlchemy models + the sole owner of stage ordering (enums.py)
│   ├── schemas/               Pydantic request/response models
│   ├── services/               business logic: pricing, quotes, transitions, tracking,
│   │                            workers, customers, inquiries, shipments
│   ├── integrations/
│   │   └── tracking/            TrackingAdapter protocol (protocol.py) + MockTrackingAdapter
│   │                            (mock.py); airlines/, airports/, customs/, notifications/
│   │                            are placeholders — no real carrier integration exists yet
│   ├── utils/                   errors.py (domain exceptions -> HTTP mapping),
│   │                            dependencies.py (current_actor), security.py (worker +
│   │                            customer JWT/bcrypt auth)
│   ├── repositories/             placeholder — the app queries via SQLAlchemy directly
│   │                             from services/api today, no repository layer exists yet
│   └── workers/                  placeholder — no background/queue workers exist yet
│                                  (not to be confused with the Worker *model*, which is a
│                                  warehouse staff account — see backend/models/worker.py)
├── ai/                       placeholder — no AI features exist yet
├── database/
│   ├── migrations/             Alembic env + versions/ (four migrations: initial schema,
│   │                            worker areas, 17-stage pipeline, customer portal access)
│   ├── seeds/seed.py            idempotent demo data
│   └── tests/                   placeholder — no DB-level tests beyond the pytest suite yet
├── integrations/              placeholder — external-system config/docs, distinct from
│                               backend/integrations/ which holds the actual adapter code
├── tests/
│   ├── conftest.py, factories.py    shared fixtures
│   ├── integration/                  the full pytest suite (108 tests) — API + service
│   │                                  tests through a real (SQLite) DB
│   ├── unit/                          placeholder — nothing isolated from the DB yet
│   └── e2e/                           placeholder — no browser-level tests yet
└── frontend/
    ├── src/
    │   ├── main.tsx / App.tsx      entry point, ThemeProvider, router
    │   ├── index.css                design tokens (colors, fonts) as CSS variables
    │   ├── lib/
    │   │   ├── api/                 typed fetch client mirroring the backend schemas
    │   │   └── format.ts            money/date formatting helpers
    │   ├── hooks/                   useStages, useAsync, useWorkerAuth, useCustomerAuth
    │   │                             (worker/customer login+session are separate contexts)
    │   ├── components/
    │   │   ├── ui/                   shadcn/ui primitives
    │   │   ├── layout/                OpsShell (staff nav) / PublicShell (tracking page) /
    │   │   │                          CustomerShell (customer portal nav)
    │   │   ├── shared/                StageBadge, RiskBadge, StageChecklist, EventTimeline, ...
    │   │   └── quotes/                InquiryForm, QuoteBreakdown
    │   ├── pages/                    ShipmentListPage, ShipmentDetailPage, QuoteFlowPage,
    │   │                              TrackingPage, WorkersAdminPage, CustomersAdminPage,
    │   │                              WorkerLoginPage, WorkerQueuePage, CustomerLoginPage,
    │   │                              CustomerShipmentsPage, CustomerShipmentDetailPage,
    │   │                              CustomerQuotesPage, CustomerQuoteDetailPage
    │   └── features/, services/, stores/, types/    placeholders — everything above still
    │                                                 lives in lib/, components/, pages/;
    │                                                 these exist for future reorganization,
    │                                                 not populated yet (see note below)
```

> **Two deliberate deviations from a stricter "everything in its named folder" layout**,
> both made to avoid rewriting a lot of working, tested code purely for cosmetic
> reorganization:
> 1. The frontend keeps its `src/` wrapper (standard Vite convention — `index.html`,
>    `vite.config.ts`, and `tsconfig.json` all assume it) rather than flattening
>    `components/`, `pages/`, etc. directly under `frontend/`.
> 2. `frontend/src/{features,services,stores,types}/` exist but are currently empty — the
>    existing API client and types still live in `lib/api/` (`client.ts`, `types.ts`),
>    referenced from ~20 files. Move them into `services/`/`types/` yourself when you're
>    next touching that area, rather than as a drive-by rename.
> `backend/repositories/`, `backend/workers/`, `ai/`, and the unused `backend/integrations/`
> subfolders (`airlines/`, `airports/`, `customs/`, `notifications/`) are placeholders for
> the same reason — nothing currently needs them, so there's no code to put there yet.

## Local setup

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/). All commands below assume `cd
sea-and-air/air` first (this directory — where `pyproject.toml` lives).

```bash
cd sea-and-air/air
uv sync --extra dev
cp .env.example .env   # adjust DATABASE_URL etc. as needed
```

### Environment variables

See `.env.example` for the full list with defaults:

- `DATABASE_URL` — PostgreSQL connection string in production.
- `DEFAULT_MARKUP_PERCENT`, `QUOTE_VALIDITY_DAYS` — pricing/quoting tunables.
- `VOLUMETRIC_FACTOR_AIR` / `_SEA` / `_ROAD` — kg-per-CBM dimensional weight factors (sea/road
  are unused in practice — see "Air freight only" below).
- `JOB_NUMBER_PREFIX`, `JOB_NUMBER_PADDING` — job number format, e.g. `RAZ-2026-00001`.
- `INVOICE_NUMBER_PREFIX`, `INVOICE_NUMBER_PADDING` — invoice number format, e.g.
  `INV-2026-00001`.
- `CORS_ORIGINS`.
- `JWT_SECRET_KEY`, `JWT_EXPIRY_MINUTES` — sign/expire worker, customer, and ops login
  tokens (each token carries a `typ` claim, so a worker's token, a customer's token, and an
  ops token are never interchangeable even if the underlying ids happen to collide).
  **Change `JWT_SECRET_KEY` before deploying anywhere real** — the default is dev-only.
- `OPS_ADMIN_USERNAME`, `OPS_ADMIN_PASSWORD` — bootstrap credential for the single ops
  account the seed script creates (see "Demo ops login" below). **This is a temporary
  development credential, not a permanent one** — it's only ever used to create the account
  once (re-running the seed script never resets an existing admin's password), and it must
  be changed via `POST /ops/change-password` (or the "Change password" menu in the ops UI)
  before any real deployment. Override both via the environment for anything beyond local
  dev; never commit a real value for either.

`.env` is never committed (see `.gitignore`).

### Database migration

Requires a running PostgreSQL instance reachable at `DATABASE_URL`:

```bash
uv run alembic upgrade head
```

(`alembic.ini` lives at `air/`, alongside `pyproject.toml`; migrations themselves are at
`database/migrations/`.)

### Seed data

Idempotent — safe to run more than once. Seeds the Lahore→Dubai air route, four customers,
four inquiries carried to different points in the pipeline (a draft quote, a shipment
walked to Customs Examination, a shipment at Job Opening marked at-risk, and a shipment
walked all the way to Invoice to Customer), the 13 worker areas, and a demo worker account
per area:

```bash
uv run python database/seeds/seed.py
```

**Demo worker logins** (all share the password `Worker123!`):

| Username | Area | Stage they complete |
|---|---|---|
| `ayesha.airwaybill` | Airway Bill | airway_bill |
| `usman.gd` | GD | gd |
| `bilal.pickup` | Pickup | pickup |
| `kamran.gatein` | Gate In | gate_in |
| `nadia.receipt` | Shipment Receipt | shipment_receipt |
| `saad.weighment` | Weighment | weighment |
| `fatima.examination` | Customs Examination | customs_examination |
| `omar.customs`, `sana.customs` | Customs Clearance | customs_clearance |
| `hamza.scanning` | Scanning | scanning |
| `rabia.handover` | Handover | handover |
| `zara.departure` | Departure | departure |
| `adeel.transhipment` | Transhipment | transhipment |
| `hina.arrival` | Arrival | arrival |

Demo-only credentials for local development — not meant for any real deployment.
"Invoice to Customer", the final stage, has no worker area — ops marks it directly (see
"Worker portal & areas" below).

**Demo customer portal logins** (password `Customer123!`) — only the two higher-volume
demo customers get one, matching how ops would actually grant access:

| Username | Customer | Demoes |
|---|---|---|
| `orient.traders` | Orient Traders | An active shipment (Customs Examination) |
| `zainab.enterprises` | Zainab Enterprises | A completed/invoiced shipment + an accepted quote |

**Demo ops login** — username/password from `OPS_ADMIN_USERNAME`/`OPS_ADMIN_PASSWORD`
(defaults: `admin` / `ChangeMe123!`). Every `/quotes`, `/shipments`, `/invoices`,
`/companies`, `/customers`, `/inquiries`, `/workers`, and document-management endpoint
requires this login (`POST /ops/login`) — there is no unauthenticated ops access. This is a
**temporary development credential**: change it via `POST /ops/change-password` (or
Ops UI → account menu → "Change password") before any real deployment. Doing so bumps the
account's `token_version`, which immediately invalidates every previously issued token for
that account, not just the one making the change.

### Run the server

```bash
uv run uvicorn main:app --app-dir backend --reload
```

(`--app-dir backend` is needed because `main.py` lives in `backend/`, one level below
where `pyproject.toml`/the venv live — everything under `backend/` imports flatly, e.g.
`from models.shipment import Shipment`, not `from app.models...`.)

### Run the tests

The test suite runs entirely on a throwaway in-memory SQLite database — no PostgreSQL or
Docker needed:

```bash
uv run pytest -q
```

`tests/` is a sibling of `backend/`, not nested inside it — `pyproject.toml`'s
`[tool.pytest.ini_options] pythonpath = ["backend", "tests"]` puts both on `sys.path`, so
test files import backend modules flatly (`from models.enums import ShipmentStage`) and
shared fixtures flatly too (`from factories import make_customer`), without either
directory needing to be a Python package.

## Frontend setup

Requires Node.js 20+.

```bash
cd frontend
npm install
npm run dev       # starts Vite on http://localhost:5173
```

The dev server proxies `/api/*` to `http://localhost:8000` (see `vite.config.ts`), so run
the backend (per above) alongside it — no CORS configuration needed in dev. For a non-dev
deployment, set `VITE_API_BASE_URL` to the backend's URL.

It also proxies `/sea-api/*` to `http://localhost:8001` — the sea vertical's backend (see
[`../sea/README.md`](../sea/README.md)) — for the Sea mode of the tracking page. Run that
backend too if you want Sea mode to work locally; Air mode works without it.
`VITE_SEA_API_BASE_URL` overrides that base path the same way `VITE_API_BASE_URL` does for
air's own API.

- `npm run build` — type-checks (`tsc -b`) and produces a production bundle in `dist/`.
- `npm run lint` — oxlint.

### Pages

- `/shipments` — ops dashboard: every shipment (from Inquiry onward), filterable by stage /
  at-risk.
- `/shipments/:id` — shipment detail: status history, a read-only "next stage / waiting on
  which area" indicator, the status-correction dialog (for fixing mistakes only), at-risk
  toggle, and reference management. There is no "advance to next stage" action here for
  worker-owned stages — normal progression is worker-only; see "Worker portal & areas"
  below. The one exception is the terminal stage: once a shipment reaches Arrival, this
  page shows a "Mark Invoiced" action instead, since ops (not a worker) handles invoicing.
- `/quotes/new` → `/quotes/:id` — pick or create a customer, enter the inquiry (which
  immediately creates a Shipment at the Inquiry stage), generate a quote, override line
  items while in draft, then send/accept. Accepting allocates the job number and advances
  the existing shipment to Job Opening.
- `/workers` — admin: create worker accounts, assign them to an area, deactivate accounts.
- `/customers` — admin: list customers, grant/reset a portal login, deactivate one.
- `/worker/login` → `/worker/queue` — the worker portal (real login required; see below).
- `/customer/login` → `/customer/shipments`, `/customer/quotes` — the customer portal (real
  login required; see "Customer portal" below).
- `/track` → `/track/:reference` — the public, unauthenticated customer view (for customers
  without a portal login). Looks up by job number or any reference (MAWB/HAWB/MBL/HBL/
  container) and renders only what `GET /tracking/{reference}` returns — no pricing, no
  internal notes, no risk reason ever reaches this page, by construction on the backend.
  An **Air / Sea toggle** at the top of this page switches to `/track/sea` →
  `/track/sea/:containerNumber`, which searches sea containers instead — a completely
  different backend (`../sea`, proxied through this dev server's `/sea-api/*` rule in
  `vite.config.ts`) and result shape, but the same page and URL space, so customers have
  one place to track either kind of shipment. See [`../sea/README.md`](../sea/README.md)
  for that backend; the Sea-mode result view and its components
  (`ContainerTimeline.tsx`, `ContainerDetailCard.tsx`) live in this frontend, not there.

### Design system

Colors, spacing, and typography are CSS variables in `src/index.css` (light + dark, both
WCAG AA-checked) — a professional navy/slate palette with semantic status colors
(job progress = blue, delivered = green, at-risk = amber), Lexend for headings and Source
Sans 3 for body text. The stage order and human-readable labels are fetched once from
`GET /meta/stages` (`useStages` hook) and never hardcoded in a component — the backend's
`backend/models/enums.py` is still the single source of truth for that mapping.

## API overview

```
POST/GET  /customers · /customers/{id}
POST      /customers/{id}/portal-access        ops-only; (re)issues a customer's portal login
PATCH     /customers/{id}/portal-access         ops-only; { is_active } to enable/disable it
POST/GET  /inquiries · /inquiries/{id}         creating an inquiry also creates its Shipment (stage=inquiry)

POST      /quotes/generate                     advances the shipment inquiry -> quotation
GET       /quotes · /quotes/{id}
PATCH     /quotes/{id}/line-items      manual override (draft only)
POST      /quotes/{id}/send            marks sent only — no email/PDF in this MVP
POST      /quotes/{id}/accept          transactional, idempotent; allocates job_number, advances -> job_opening

GET       /shipments                   filters: stage, at_risk, mode
GET       /shipments/{id}
POST      /shipments/{id}/status/correct       ops-only repair path, job_opening or later, requires a reason
POST      /shipments/{id}/invoice              ops-only; advances arrival -> invoice_to_customer
POST      /shipments/{id}/references
POST      /shipments/{id}/risk

GET       /tracking/{reference}        public, customer-safe (job number or any reference)
GET       /meta/stages                 canonical ordered stages + human-readable labels + sub-category group

POST      /auth/login                  worker login -> bearer token
GET       /auth/me                     resolve the current token to a worker

GET       /worker/queue                requires a worker token; shipments waiting for their area
POST      /worker/shipments/{id}/complete   advances the shipment into the worker's area stage

POST      /customer/login              customer login -> bearer token
GET       /customer/me                 resolve the current token to a customer

GET       /customer/shipments          requires a customer token; own shipments only, ?completed=true|false
GET       /customer/shipments/{id}     customer-safe (same shape as GET /tracking/{reference})
GET       /customer/quotes             requires a customer token; own quotes only, full pricing
GET       /customer/quotes/{id}

GET       /areas                       admin, unauthenticated (same trust level as ops)
GET/POST  /workers · PATCH /workers/{id}    admin: create/list/(de)activate worker accounts
```

Full request/response shapes are in `backend/schemas/`; interactive docs are available at
`/docs` once the server is running.

### The inquiry → quote → shipment seam

A Shipment is created the moment an Inquiry comes in (`POST /inquiries`), starting at the
`inquiry` stage — there's no separate "shipment doesn't exist yet" period before a quote is
accepted. `POST /quotes/generate` advances that same shipment to `quotation`; regenerating
a quote for an inquiry that already has one does not re-advance or duplicate events.
Accepting a quote (`POST /quotes/{id}/accept`) allocates the job number and advances the
shipment to `job_opening`. It is transactional and idempotent: accepting the same quote
twice returns the same shipment rather than creating a second one or reallocating a job
number, and if anything fails partway through, the entire operation (including the job
number counter increment) rolls back together. A failed acceptance attempt never
permanently consumes a job number sequence value.

### Shipment stages

Fixed, ordered, 17-value enum, grouped into the pipeline the business actually walks:

```
Inquiry → Quotation → Job Opening
  → Documentation:  Airway Bill → GD → Pickup
  → Airport:        Gate In → Shipment Receipt → Weighment → Customs Examination
                     → Customs Clearance → Scanning → Handover
  → Airline:         Departure → Transhipment → Arrival
  → Invoice to Customer
```

`Inquiry`, `Quotation`, and `Job Opening` are system-driven (advanced by the quote flow,
not a worker). Every stage from `Airway Bill` through `Arrival` is worker-assignable — each
has its own Area and is marked done by a worker in that area, individually tracked with its
own timestamp (not a checklist item within a bigger stage). `Invoice to Customer` is the
one exception: ops marks it directly via `POST /shipments/{id}/invoice`, since invoicing
isn't a warehouse/operational task. The grouping into Documentation/Airport/Airline is
purely presentational (`STAGE_GROUPS` in `backend/models/enums.py`, surfaced as `group` on
`GET /meta/stages`) — it does not change the linear progression rule.

Normal progression only ever accepts the immediate next stage — no skipping ahead, no
going backwards — enforced in `services.transitions.advance_stage`. Every `StatusEvent`
records when a shipment entered that stage, which is what powers the completion timestamp
shown next to each stage on both the ops detail page and the public tracking checklist.
If an operational mistake needs correcting, ops's `POST /shipments/{id}/status/correct` can
move a shipment to any stage from `job_opening` onward (not `inquiry`/`quotation`, since
those are system transitions, not worker/ops corrections), but requires a reason and always
adds a new event; it never edits or deletes history. `StatusEvent` rows are append-only
everywhere — there is no endpoint that updates or deletes one.

### At-risk shipments

`is_at_risk` / `risk_reason` are independent of stage — there is no `delayed` stage.
`risk_reason` is internal-only and is never returned by the customer tracking endpoint,
only the `at_risk` boolean is.

## Worker portal & areas

Each of the 13 worker-assignable stages (Airway Bill through Arrival — see "Shipment
stages") has exactly one **Area**. A **Worker** account belongs to exactly one Area. Any
worker in an Area can see and act on any shipment waiting for that Area's stage — "anyone
in Customs Clearance" rather than one fixed person per stage, so a warehouse team can share
the queue (the seed data gives Customs Clearance two workers to demonstrate this).

A worker signs in at `/worker/login` (real username/password — see
`backend/utils/security.py` for JWT + bcrypt) and lands on `/worker/queue`: every shipment
currently sitting one stage before theirs, oldest first. Marking one "Done" calls
`POST /worker/shipments/{id}/complete`, which is a thin wrapper around
`services.transitions.advance_stage` with the worker's area stage as the fixed target and
the worker's name as the actor. That reuse is what enforces the restriction — a worker can
never advance a shipment into any stage but their own, because `advance_stage` already
rejects anything that isn't the shipment's immediate next stage; there's no separate
authorization check to keep in sync.

Ops has no "advance to next stage" endpoint for worker-owned stages — normal progression
through Airway Bill…Arrival is worker-only. The one stage ops does drive directly is the
last one: once a shipment reaches Arrival, `POST /shipments/{id}/invoice` moves it to
Invoice to Customer, since invoicing customers isn't a warehouse task and has no worker
area. Ops also keeps `POST /shipments/{id}/status/correct` (fixing a genuine mistake, any
stage from `job_opening` onward, reason required) as the one remaining way ops can move a
shipment's stage backward or sideways, plus risk-flagging and reference management, which
are independent of stage. Admins manage worker accounts at `/workers` (`POST /workers`,
`PATCH /workers/{id}` to deactivate/reassign) — that side stays unauthenticated like the
rest of ops, matching `current_actor`.

## Customer portal

Most customers have no login at all — they're tracked by ops and use the public
`/track/:reference` page if they want to check status themselves. For higher-volume
clients, ops can grant a portal login from `/customers` (`POST /customers/{id}/portal-access`),
which sets a username/password on the existing `Customer` row directly (`username`,
`password_hash`, `portal_active` — nullable, so most customers simply never have them set).
There is no self-service signup; a customer can never create or change their own
credentials.

A customer signs in at `/customer/login` and lands on `/customer/shipments`: every
shipment that belongs to them, split into **Active** and **Completed** tabs (`?completed=`
on `GET /customer/shipments`) so a client with many shipments a day isn't stuck scrolling
past ones that are already done. Shipment detail (`GET /customer/shipments/{id}`) reuses
the exact same customer-safe shape as the public tracking endpoint — pricing, internal
notes, and `risk_reason` never reach it — just scoped to a logged-in identity instead of a
reference lookup. `/customer/quotes` additionally shows the customer their own quotes with
full pricing, since (unlike a shipment) a quote is inherently theirs to see priced out.

Every route in `backend/api/customer_portal.py` resolves the customer from the bearer
token via `get_current_customer`, then scopes its query to that customer's id in
`services.customers` — no route accepts a customer id from the request, so one customer
can never address another's data by guessing an id (`GET /customer/shipments/3` for a
shipment that isn't yours returns a plain 404, identical to a nonexistent id). Worker and
customer tokens carry a `typ` claim and are checked against it on decode (see
`backend/utils/security.py`), so a worker's token can never be replayed against a customer
route or vice versa.

Ops sees the same Active/Completed split on the main `/shipments` dashboard (a client-side
tab over the already-loaded list, keyed on `stage === "invoice_to_customer"`) rather than
having to remember to set the stage filter manually.

## Air freight only

Raaziq currently only forwards air freight. `TransportMode` still has `sea` and `road` in
the schema (so the data model doesn't need to change if that expands later), but no rate
card exists for either, the quote form only offers Air, and the ops shipment list has no
mode filter — there's nothing else to filter by right now.

## Tracking adapter architecture

Raaziq does not integrate a real tracking provider (ShipsGo, a carrier API, WeBOC, PSW,
...) in this MVP. Instead, there's a small interface that a future integration plugs
into without touching the shipment/status data model:

```
Carrier / Tracking Provider
        ↓
TrackingAdapter.get_status(reference) -> NormalizedStatus | None
        ↓
services.tracking.ingest_adapter_update()
        ↓  (goes through the same rules as a manual update)
services.transitions.advance_stage()
        ↓
StatusEvent (source=automated)
        ↓
Shipment.stage
        ↓
Ops dashboard + customer tracking
```

`backend/integrations/tracking/protocol.py` defines the `TrackingAdapter` protocol and the
`NormalizedStatus` shape it returns — provider-specific status codes are normalized into
Raaziq's own `ShipmentStage` at this boundary and never leak further into the application.
`backend/integrations/tracking/mock.py` provides `MockTrackingAdapter`, a fake adapter with
canned responses, for local development and tests.

Ingestion never writes to `Shipment.stage` or `StatusEvent` directly — it always goes
through `services.transitions.advance_stage`, the same function a manual status update
uses. If a provider reports an invalid or backwards stage, nothing is mutated; the update
is treated as an ingestion failure (`TrackingIngestionFailed`), not silently applied or
used to bypass the transition rules.

A future real adapter looks conceptually like:

```python
class ShipsGoAdapter(TrackingAdapter):
    def get_status(self, reference: str) -> NormalizedStatus | None:
        # call the provider, normalize its status into ShipmentStage
        ...
```

No ETA prediction, GPS/IoT tracking, or live WeBOC/PSW integration is implemented —
customs updates are entered manually by ops for this MVP, through the same status-update
path as any other stage change.

## What's out of scope for this MVP

Ops-side login (still `current_actor`, unauthenticated — only the worker and customer
portals have real accounts), self-service customer signup (portal access is ops-granted
only), predictive ETA, AI pricing or shipment prediction, GPS/IoT, live WeBOC/PSW
integration, ShipsGo/carrier API integration, multi-carrier RFQ automation, live spot-rate
feeds, accounting/ERP integration, actual invoice generation/PDF/email (the "Invoice to
Customer" stage only records that ops sent one — it doesn't produce or send anything
itself), payments, microservices, event buses, Redis, Celery, Kubernetes.
