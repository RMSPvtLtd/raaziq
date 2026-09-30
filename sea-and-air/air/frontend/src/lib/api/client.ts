// Thin, typed wrapper around the Raaziq backend REST API. Every call goes
// through `request`, so error handling (the backend's centralized
// `{"detail": "..."}` shape) and the base URL are each defined once, not
// repeated at every call site.

import type {
  AirlineSchedule,
  AirlineScheduleInput,
  Area,
  ChangePasswordRequest,
  Company,
  Customer,
  CustomerCreate,
  CustomerQuote,
  EmailResult,
  CustomerInvoiceDetail,
  CustomerInvoiceSummary,
  CustomerLoginResponse,
  CustomerPortalCredentials,
  CustomerShipmentSummary,
  DocumentType,
  Inquiry,
  InquiryCreate,
  Invoice,
  LineItemOverride,
  LoginResponse,
  ManualQuoteInput,
  OpsLoginResponse,
  OpsUser,
  Priority,
  Quote,
  RateCard,
  RateCardInput,
  SeaTrackingResult,
  Shipment,
  ShipmentDocument,
  ShipmentFilters,
  StageMeta,
  TrackingResult,
  Worker,
  WorkerCreate,
  WorkerQueueItem,
} from "./types"

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api"
// The sea vertical is a separate backend (see sea-and-air/sea/) reached
// through its own dev-server proxy path -- see vite.config.ts's /sea-api
// rule -- rather than air's own /api base above.
const SEA_BASE_URL = import.meta.env.VITE_SEA_API_BASE_URL ?? "/sea-api"

export class ApiError extends Error {
  status: number
  // Raw parsed response body, when the backend attaches structured detail
  // beyond the plain `detail` string (e.g. DuplicateCustomerEmail's
  // `customer_id`) -- undefined when the body was missing or non-JSON.
  body?: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.name = "ApiError"
    this.body = body
  }
}

async function request<T>(path: string, init?: RequestInit, base: string = BASE_URL): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let detail = res.statusText
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any
    try {
      body = await res.json()
      if (typeof body?.detail === "string") detail = body.detail
      else if (Array.isArray(body?.detail)) {
        // FastAPI/Pydantic validation errors: a list of {loc, msg, ...}.
        detail = body.detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join("; ") || detail
      }
    } catch {
      // response body wasn't JSON -- fall back to statusText
    }
    throw new ApiError(res.status, detail, body)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function qs(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return ""
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}

// --- ops session token ---
//
// Every ops-facing endpoint now requires a bearer token (see
// utils.security.get_current_ops_user on the backend). Unlike the worker/
// customer portals, ops API functions below don't take an explicit `token`
// parameter -- there'd be dozens of call sites across nearly every ops page
// to thread it through. Instead `useOpsAuth` calls `setOpsToken` once on
// login/logout/session-restore, and `opsRequest` (used by every ops-facing
// API object below) reads it from this module-level variable at call time.
let opsToken: string | null = null

export function setOpsToken(token: string | null) {
  opsToken = token
}

function opsAuthHeader(): HeadersInit {
  return opsToken ? { Authorization: `Bearer ${opsToken}` } : {}
}

function opsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, headers: { ...opsAuthHeader(), ...init?.headers } })
}

// Fetches a PDF/document with the ops bearer token attached (a plain <a
// href> can't carry a custom header) and opens it in a new tab as a blob
// URL. Used for quote/invoice PDF previews, all of which now require ops
// auth.
//
// The blank tab is opened *before* the (async) fetch, not after -- most
// browsers only allow window.open() as a direct result of a user gesture;
// calling it after an `await` is a background call as far as the popup
// blocker is concerned and gets silently dropped (no error, tab just never
// appears). Opening a blank tab synchronously in the click handler and
// pointing it at the blob once it's ready sidesteps that entirely.
export async function openAuthedFile(url: string): Promise<void> {
  const tab = window.open("", "_blank")
  try {
    const res = await fetch(url, { headers: opsAuthHeader() })
    if (!res.ok) {
      tab?.close()
      throw new ApiError(res.status, res.statusText)
    }
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    if (tab) tab.location.href = blobUrl
    else window.open(blobUrl, "_blank") // popup was blocked even for the blank tab -- best effort
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  } catch (err) {
    tab?.close()
    throw err
  }
}

// Same auth-header fetch, but triggers an actual file save instead of
// opening a viewer tab -- for buttons explicitly labeled "Download".
export async function downloadAuthedFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: opsAuthHeader() })
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
}

// --- customers ---

export const customersApi = {
  list: () => opsRequest<Customer[]>("/customers"),
  get: (id: number) => opsRequest<Customer>(`/customers/${id}`),
  create: (payload: CustomerCreate) =>
    opsRequest<Customer>("/customers", { method: "POST", body: JSON.stringify(payload) }),
  grantPortalAccess: (id: number, payload: CustomerPortalCredentials) =>
    opsRequest<Customer>(`/customers/${id}/portal-access`, { method: "POST", body: JSON.stringify(payload) }),
  setPortalActive: (id: number, isActive: boolean) =>
    opsRequest<Customer>(`/customers/${id}/portal-access`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    }),
}

// --- inquiries ---

export const inquiriesApi = {
  list: () => opsRequest<Inquiry[]>("/inquiries"),
  get: (id: number) => opsRequest<Inquiry>(`/inquiries/${id}`),
  create: (payload: InquiryCreate) =>
    opsRequest<Inquiry>("/inquiries", { method: "POST", body: JSON.stringify(payload) }),
}

// --- quotes ---

export const quotesApi = {
  list: () => opsRequest<Quote[]>("/quotes"),
  get: (id: number) => opsRequest<Quote>(`/quotes/${id}`),
  // One quote per carrier with a currently-valid rate card for the lane --
  // always a list, even when only one carrier matches.
  generate: (inquiryId: number) =>
    opsRequest<Quote[]>("/quotes/generate", { method: "POST", body: JSON.stringify({ inquiry_id: inquiryId }) }),
  createManual: (payload: ManualQuoteInput) =>
    opsRequest<Quote>("/quotes/manual", { method: "POST", body: JSON.stringify(payload) }),
  forInquiry: (inquiryId: number) =>
    opsRequest<Quote[]>("/quotes").then((quotes) => quotes.filter((q) => q.inquiry_id === inquiryId)),
  overrideLineItems: (id: number, overrides: LineItemOverride[]) =>
    opsRequest<Quote>(`/quotes/${id}/line-items`, { method: "PATCH", body: JSON.stringify({ overrides }) }),
  setAdjustments: (id: number, taxAmount: string, discountAmount: string) =>
    opsRequest<Quote>(`/quotes/${id}/adjustments`, {
      method: "PATCH",
      body: JSON.stringify({ tax_amount: taxAmount, discount_amount: discountAmount }),
    }),
  setClauses: (id: number, clauses: string | null) =>
    opsRequest<Quote>(`/quotes/${id}/clauses`, { method: "PATCH", body: JSON.stringify({ clauses }) }),
  email: (id: number) => opsRequest<EmailResult>(`/quotes/${id}/email`, { method: "POST" }),
  send: (id: number) => opsRequest<Quote>(`/quotes/${id}/send`, { method: "POST" }),
  accept: (id: number) => opsRequest<Shipment>(`/quotes/${id}/accept`, { method: "POST" }),
  reject: (id: number, reason: string) =>
    opsRequest<Quote>(`/quotes/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  revisions: (id: number) => opsRequest<Quote[]>(`/quotes/${id}/revisions`),
  pdfUrl: (id: number) => `${BASE_URL}/quotes/${id}/pdf`,
}

// --- companies (issuing entities) ---

export const companiesApi = {
  list: () => opsRequest<Company[]>("/companies"),
  updateEmail: (id: number, payload: { notification_email: string | null; automatic_email_enabled: boolean }) => opsRequest<Company>(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
}

// --- rate cards ---

export const rateCardsApi = {
  list: () => opsRequest<RateCard[]>("/rate-cards"),
  get: (id: number) => opsRequest<RateCard>(`/rate-cards/${id}`),
  create: (payload: RateCardInput) =>
    opsRequest<RateCard>("/rate-cards", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: number, payload: RateCardInput) =>
    opsRequest<RateCard>(`/rate-cards/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (id: number) => opsRequest<void>(`/rate-cards/${id}`, { method: "DELETE" }),
}

// --- airline schedules ---

export const airlineSchedulesApi = {
  list: () => opsRequest<AirlineSchedule[]>("/airline-schedules"),
  get: (id: number) => opsRequest<AirlineSchedule>(`/airline-schedules/${id}`),
  create: (payload: AirlineScheduleInput) =>
    opsRequest<AirlineSchedule>("/airline-schedules", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: number, payload: AirlineScheduleInput) =>
    opsRequest<AirlineSchedule>(`/airline-schedules/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (id: number) => opsRequest<void>(`/airline-schedules/${id}`, { method: "DELETE" }),
}

// --- invoices ---

export const invoicesApi = {
  list: () => opsRequest<Invoice[]>("/invoices"),
  get: (id: number) => opsRequest<Invoice>(`/invoices/${id}`),
  createFromQuote: (quoteId: number, companyId: number, replacesInvoiceId?: number, remarks?: string) =>
    opsRequest<Invoice>(`/quotes/${quoteId}/invoice`, {
      method: "POST",
      body: JSON.stringify({
        company_id: companyId,
        replaces_invoice_id: replacesInvoiceId ?? null,
        remarks: remarks || null,
      }),
    }),
  cancel: (id: number, reason: string) =>
    opsRequest<Invoice>(`/invoices/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  email: (id: number) => opsRequest<EmailResult>(`/invoices/${id}/email`, { method: "POST" }),
  pdfUrl: (id: number) => `${BASE_URL}/invoices/${id}/pdf`,
}

// --- shipments ---

export const shipmentsApi = {
  list: (filters: ShipmentFilters = {}) => opsRequest<Shipment[]>(`/shipments${qs(filters)}`),
  get: (id: number) => opsRequest<Shipment>(`/shipments/${id}`),
  correctStatus: (id: number, stage: string, reason: string) =>
    opsRequest<Shipment>(`/shipments/${id}/status/correct`, {
      method: "POST",
      body: JSON.stringify({ stage, reason }),
    }),
  addReference: (id: number, type: string, value: string) =>
    opsRequest<Shipment>(`/shipments/${id}/references`, { method: "POST", body: JSON.stringify({ type, value }) }),
  setRisk: (id: number, isAtRisk: boolean, riskReason?: string) =>
    opsRequest<Shipment>(`/shipments/${id}/risk`, {
      method: "POST",
      body: JSON.stringify({ is_at_risk: isAtRisk, risk_reason: riskReason ?? null }),
    }),
  invoice: (id: number, note?: string) =>
    opsRequest<Shipment>(`/shipments/${id}/invoice`, { method: "POST", body: JSON.stringify({ note: note || undefined }) }),
  setPriority: (id: number, priority: Priority) =>
    opsRequest<Shipment>(`/shipments/${id}/priority`, { method: "POST", body: JSON.stringify({ priority }) }),
  setRouting: (id: number, carrier: string | null, voyageFlightNumber: string | null) =>
    opsRequest<Shipment>(`/shipments/${id}/routing`, {
      method: "POST",
      body: JSON.stringify({ carrier, voyage_flight_number: voyageFlightNumber }),
    }),
  cancel: (id: number, reason: string, customerNote?: string) =>
    opsRequest<Shipment>(`/shipments/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason, customer_note: customerNote || undefined }),
    }),
  setHold: (id: number, onHold: boolean, reason?: string) =>
    opsRequest<Shipment>(`/shipments/${id}/hold`, {
      method: "POST",
      body: JSON.stringify({ on_hold: onHold, reason: reason || undefined }),
    }),
  remove: (id: number) => opsRequest<void>(`/shipments/${id}`, { method: "DELETE" }),
}

// --- shipment documents (PDFs, stored in Postgres -- see backend/services/documents.py) ---

export const documentsApi = {
  list: (shipmentId: number) => opsRequest<ShipmentDocument[]>(`/shipments/${shipmentId}/documents`),
  // Bypasses `request()`/`opsRequest()`: it unconditionally sets
  // Content-Type: application/json, which breaks multipart's required
  // `boundary` parameter. The browser must set Content-Type itself from the
  // FormData; the ops bearer token is still attached explicitly.
  upload: async (shipmentId: number, file: File, documentType?: DocumentType): Promise<ShipmentDocument> => {
    const form = new FormData()
    form.append("file", file)
    if (documentType) form.append("document_type", documentType)
    const res = await fetch(`${BASE_URL}/shipments/${shipmentId}/documents`, {
      method: "POST",
      body: form,
      headers: opsAuthHeader(),
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = await res.json()
        if (typeof body?.detail === "string") detail = body.detail
      } catch {
        // response body wasn't JSON -- fall back to statusText
      }
      throw new ApiError(res.status, detail)
    }
    return res.json() as Promise<ShipmentDocument>
  },
  downloadUrl: (documentId: number) => `${BASE_URL}/documents/${documentId}`,
}

// --- tracking ---

export const trackingApi = {
  track: (reference: string) => request<TrackingResult>(`/tracking/${encodeURIComponent(reference)}`),
}

// --- sea vertical: container tracking (separate backend, see
// sea-and-air/sea/) -- POST /tracking here maps to the sea backend's own
// POST /api/tracking, since SEA_BASE_URL already includes the /sea-api
// prefix the dev proxy rewrites to /api.
export const seaTrackingApi = {
  track: (containerNumber: string) =>
    request<SeaTrackingResult>(
      "/tracking",
      { method: "POST", body: JSON.stringify({ container_number: containerNumber }) },
      SEA_BASE_URL,
    ),
}

// --- meta ---

export const metaApi = {
  stages: () => request<{ stages: StageMeta[] }>("/meta/stages"),
}

// --- auth (worker portal login) ---

export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: (token: string) => request<Worker>("/auth/me", { headers: authHeader(token) }),
}

// --- worker portal (requires a worker's own bearer token, not an admin call) ---

export const workerPortalApi = {
  queue: (token: string) => request<WorkerQueueItem[]>("/worker/queue", { headers: authHeader(token) }),
  completed: (token: string) => request<WorkerQueueItem[]>("/worker/completed", { headers: authHeader(token) }),
  complete: (token: string, shipmentId: number, note?: string) =>
    request<WorkerQueueItem>(`/worker/shipments/${shipmentId}/complete`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ note: note || undefined }),
    }),
  listDocuments: (token: string, shipmentId: number) =>
    request<ShipmentDocument[]>(`/worker/shipments/${shipmentId}/documents`, { headers: authHeader(token) }),
  // Bypasses `request()` for the same reason documentsApi.upload does --
  // Content-Type: application/json would break multipart's boundary param.
  uploadDocument: async (token: string, shipmentId: number, file: File): Promise<ShipmentDocument> => {
    const form = new FormData()
    form.append("file", file)
    const res = await fetch(`${BASE_URL}/worker/shipments/${shipmentId}/documents`, {
      method: "POST",
      body: form,
      headers: authHeader(token),
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = await res.json()
        if (typeof body?.detail === "string") detail = body.detail
      } catch {
        // response body wasn't JSON -- fall back to statusText
      }
      throw new ApiError(res.status, detail)
    }
    return res.json() as Promise<ShipmentDocument>
  },
}

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

// --- customer auth (customer portal login) ---

export const customerAuthApi = {
  login: (username: string, password: string) =>
    request<CustomerLoginResponse>("/customer/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: (token: string) => request<Customer>("/customer/me", { headers: authHeader(token) }),
}

// --- customer portal (requires a customer's own bearer token) ---

export const customerPortalApi = {
  shipments: (token: string, completed?: boolean) =>
    request<CustomerShipmentSummary[]>(`/customer/shipments${qs({ completed })}`, { headers: authHeader(token) }),
  shipment: (token: string, id: number) =>
    request<TrackingResult>(`/customer/shipments/${id}`, { headers: authHeader(token) }),
  quotes: (token: string) => request<CustomerQuote[]>("/customer/quotes", { headers: authHeader(token) }),
  quote: (token: string, id: number) => request<CustomerQuote>(`/customer/quotes/${id}`, { headers: authHeader(token) }),
  acceptQuote: (token: string, id: number) =>
    request<CustomerShipmentSummary>(`/customer/quotes/${id}/accept`, {
      method: "POST",
      headers: authHeader(token),
    }),
  invoices: (token: string) =>
    request<CustomerInvoiceSummary[]>("/customer/invoices", { headers: authHeader(token) }),
  invoice: (token: string, id: number) =>
    request<CustomerInvoiceDetail>(`/customer/invoices/${id}`, { headers: authHeader(token) }),
}

// --- ops auth ---

export const opsAuthApi = {
  login: (username: string, password: string) =>
    request<OpsLoginResponse>("/ops/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => opsRequest<OpsUser>("/ops/me"),
  changePassword: (payload: ChangePasswordRequest) =>
    opsRequest<OpsUser>("/ops/change-password", { method: "POST", body: JSON.stringify(payload) }),
}

// --- admin: areas + workers (ops-authenticated, same as the rest of the ops API) ---

export const areasApi = {
  list: () => opsRequest<Area[]>("/areas"),
}

export const workersApi = {
  list: () => opsRequest<Worker[]>("/workers"),
  create: (payload: WorkerCreate) => opsRequest<Worker>("/workers", { method: "POST", body: JSON.stringify(payload) }),
  setActive: (id: number, isActive: boolean) =>
    opsRequest<Worker>(`/workers/${id}`, { method: "PATCH", body: JSON.stringify({ is_active: isActive }) }),
}
