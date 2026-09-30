// Mirrors backend/app/models/enums.py -- the backend is the single owner of
// these value sets; this file is a read-only reflection of them for the
// compiler, not a second definition to keep in sync by hand elsewhere in
// the UI (components read stage order/labels from the /meta/stages API,
// never redeclare it).

export type ShipmentStage =
  | "inquiry"
  | "quotation"
  | "job_opening"
  | "airway_bill"
  | "gd"
  | "pickup"
  | "gate_in"
  | "shipment_receipt"
  | "weighment"
  | "customs_examination"
  | "customs_clearance"
  | "scanning"
  | "handover"
  | "departure"
  | "transhipment"
  | "arrival"
  | "invoice_to_customer"

export type TransportMode = "air" | "sea" | "road"

export type QuoteStatus = "draft" | "sent" | "accepted" | "expired" | "rejected"

export type EventSource = "manual" | "automated" | "system" | "correction"

export type ReferenceType =
  | "JOB_NUMBER"
  | "MAWB"
  | "HAWB"
  | "MBL"
  | "HBL"
  | "CONTAINER"
  | "FORM_E"
  | "LC"
  | "PARTY_REFERENCE"

export type ChargeKind = "freight" | "documentation" | "customs" | "pickup" | "handling" | "other"

export type DocumentType =
  | "quotation"
  | "invoice"
  | "airway_bill"
  | "gd"
  | "customs"
  | "shipment_receipt"
  | "examination"
  | "delivery"
  | "other"

export type ChecklistStatus = "completed" | "current" | "upcoming"

export type Priority = "low" | "medium" | "high"

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled"

// Decimal fields are serialized by the backend as JSON strings (Pydantic's
// default), not numbers -- keeping them as `string` here avoids silent
// float-precision loss; format with `formatMoney` / `Number()` at render time.

export interface Customer {
  id: number
  name: string
  company_name: string | null
  email: string
  phone: string | null
  address: string | null
  username: string | null
  portal_active: boolean
  created_at: string
  updated_at: string
}

export interface CustomerPortalCredentials {
  username: string
  password: string
}

export interface CustomerCreate {
  name: string
  company_name?: string | null
  email: string
  phone?: string | null
  address?: string | null
}

export interface Inquiry {
  id: number
  customer_id: number
  origin: string
  destination: string
  mode: TransportMode
  cargo_type: string
  weight_kg: string
  volume_cbm: string
  dimensions: string | null
  ready_date: string | null
  incoterm: string
  description: string | null
  hs_code: string | null
  pieces: number | null
  supplier_name: string | null
  supplier_address: string | null
  created_at: string
  updated_at: string
}

export interface InquiryCreate {
  customer_id: number
  origin: string
  destination: string
  mode: TransportMode
  cargo_type: string
  weight_kg: string
  volume_cbm: string
  dimensions?: string | null
  ready_date?: string | null
  incoterm: string
  description?: string | null
  hs_code?: string | null
  pieces?: number | null
  supplier_name?: string | null
  supplier_address?: string | null
}

export interface QuoteLineItem {
  id: number
  kind: ChargeKind
  description: string
  quantity: string
  unit_price: string
  calculated_total: string
  final_total: string
  markup_amount: string
  is_manual_override: boolean
}

export interface Quote {
  id: number
  inquiry_id: number
  origin: string
  destination: string
  status: QuoteStatus
  shipment_stage: ShipmentStage | null
  invoice_id: number | null
  currency: string
  carrier: string | null
  is_manual: boolean
  subtotal: string
  markup_amount: string
  tax_amount: string
  discount_amount: string
  total: string
  valid_until: string
  clauses: string | null
  revision_number: number
  root_quote_id: number | null
  is_current: boolean
  superseded_at: string | null
  rejected_reason: string | null
  rejected_by: string | null
  rejected_at: string | null
  created_at: string
  updated_at: string
  line_items: QuoteLineItem[]
  schedule_snapshot: AirlineScheduleInput[] | null
  email_status: string
  email_recipient: string | null
  email_error: string | null
  emailed_at: string | null
}

export type CustomerQuote = { service_charge_amount: string; mode: string; cargo_type: string; weight_kg: string; chargeable_weight_kg: string; volume_cbm: string; pieces: number | null; dimensions: string | null; description: string | null; ready_date: string | null; incoterm: string; hs_code: string | null } & Pick<Quote, "id" | "inquiry_id" | "origin" | "destination" | "status" | "invoice_id" | "currency" | "carrier" | "total" | "subtotal" | "tax_amount" | "discount_amount" | "valid_until" | "clauses" | "revision_number" | "root_quote_id" | "is_current" | "created_at" | "updated_at" | "schedule_snapshot"> & {
  line_items: Pick<QuoteLineItem, "id" | "kind" | "description" | "quantity" | "unit_price" | "final_total">[]
}

export interface QuoteAdjustments {
  tax_amount: string
  discount_amount: string
}

export interface ManualLineItemInput {
  kind: ChargeKind
  description: string
  quantity: string
  unit_price: string
  amount: string
}

export interface ManualQuoteInput {
  inquiry_id: number
  carrier: string
  currency: string
  line_items: ManualLineItemInput[]
  valid_until?: string
  clauses?: string | null
}

export interface LineItemOverride {
  line_item_id: number
  final_total: string
}

export interface ShipmentReference {
  id: number
  type: ReferenceType
  value: string
  created_at: string
}

export interface StatusEvent {
  id: number
  stage: ShipmentStage
  timestamp: string
  actor: string
  note: string | null
  source: EventSource
  is_stage_change: boolean
  is_internal: boolean
}

export interface Shipment {
  id: number
  customer_id: number
  inquiry_id: number
  quote_id: number | null
  job_number: string | null
  stage: ShipmentStage
  is_at_risk: boolean
  risk_reason: string | null
  priority: Priority
  carrier: string | null
  voyage_flight_number: string | null
  is_cancelled: boolean
  cancelled_reason: string | null
  customer_cancellation_note: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  is_on_hold: boolean
  hold_reason: string | null
  hold_created_by: string | null
  hold_created_at: string | null
  hold_removed_by: string | null
  hold_removed_at: string | null
  created_at: string
  updated_at: string
  references: ShipmentReference[]
  status_events: StatusEvent[]
}

export interface ShipmentFilters {
  stage?: ShipmentStage
  at_risk?: boolean
  mode?: TransportMode
  priority?: Priority
}

export interface ShipmentDocument {
  id: number
  shipment_id: number
  stage: ShipmentStage
  document_type: DocumentType
  filename: string
  content_type: string
  size_bytes: number
  uploaded_by: string
  created_at: string
}

export interface TrackingChecklistItem {
  stage: ShipmentStage
  status: ChecklistStatus
  timestamp: string | null
}

export interface TrackingReference {
  type: ReferenceType
  value: string
}

export interface TrackingEvent {
  stage: ShipmentStage
  timestamp: string
  note: string | null
}

export interface TrackingResult {
  job_number: string | null
  origin: string
  destination: string
  mode: TransportMode
  stage: ShipmentStage
  checklist: TrackingChecklistItem[]
  status_history: TrackingEvent[]
  references: TrackingReference[]
  at_risk: boolean
  is_cancelled: boolean
  cancellation_note: string | null
  is_on_hold: boolean
}

// --- sea vertical: container tracking (separate backend, see
// sea-and-air/sea/backend/schemas/tracking.py -- mirrors that shape
// exactly, "Sea"-prefixed here only to avoid colliding with air's own
// TrackingResult/TrackingEvent above, which are a different shape) ---

export interface SeaTrackingEvent {
  type: string
  timestamp: string | null
}

export interface SeaContainerDetail {
  owner: string | null
  bl_number: string | null
  container_size_type: string | null
  category: string | null
  status_code: string | null
  vessel_voyage: string | null
  vir_number: string | null
  eta: string | null
  etd: string | null
  discharge_time: string | null
  load_time: string | null
  do_issuance_date: string | null
  do_expiry_date: string | null
  gate_in_time: string | null
  gate_out_time: string | null
  origin: string | null
  destination: string | null
  custom_seal_number: string | null
  line_seal_number: string | null
  security_seal_number: string | null
  other_seal_number: string | null
  custom_status: string | null
  current_position: string | null
  commodity: string | null
  weight: string | null
  weighment: string | null
  scanning: string | null
  present_holds: string | null
}

export interface SeaTrackingResult {
  provider: string
  terminal: string
  container_number: string
  status: string
  status_code: string | null
  events: SeaTrackingEvent[]
  details: SeaContainerDetail[]
}

export interface StageMeta {
  stage: ShipmentStage
  label: string
  group: string | null
}

// --- companies (issuing entities) and invoices ---

export interface Company {
  id: number
  name: string
  address: string
  phone: string | null
  email: string | null
  website: string | null
  tax_id_label: string | null
  tax_id: string | null
  company_reg_no: string | null
  is_default: boolean
  notification_email: string | null
  automatic_email_enabled: boolean
  email_configured: boolean
}

export interface InvoiceLineItem {
  id: number
  kind: ChargeKind
  description: string
  quantity: string
  unit_price: string
  amount: string
}

export interface Invoice {
  id: number
  invoice_number: string
  quote_id: number
  shipment_id: number
  customer_id: number
  company_id: number
  replaces_invoice_id: number | null
  status: InvoiceStatus
  cancelled_reason: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  payment_date: string | null
  amount_paid: string | null
  payment_method: string | null
  payment_reference: string | null
  issued_date: string
  currency: string
  subtotal: string
  markup_amount: string
  tax_amount: string
  discount_amount: string
  total: string
  customer_name_snapshot: string
  customer_address_snapshot: string | null
  supplier_name_snapshot: string | null
  supplier_address_snapshot: string | null
  origin_snapshot: string
  destination_snapshot: string
  mode_snapshot: string
  cargo_type_snapshot: string | null
  incoterm_snapshot: string
  hs_code_snapshot: string | null
  pieces_snapshot: number | null
  weight_kg_snapshot: string
  volume_cbm_snapshot: string
  chargeable_weight_kg_snapshot: string
  carrier_snapshot: string | null
  voyage_flight_number_snapshot: string | null
  job_number_snapshot: string | null
  remarks: string | null
  clauses_snapshot: string | null
  created_at: string
  line_items: InvoiceLineItem[]
  quote_reference_snapshot: string | null
  quote_date_snapshot: string | null
  quote_valid_until_snapshot: string | null
  dimensions_snapshot: string | null
  description_snapshot: string | null
  ready_date_snapshot: string | null
  schedule_snapshot: AirlineScheduleInput[] | null
  email_status: string
  email_recipient: string | null
  email_error: string | null
  emailed_at: string | null
}

// --- worker portal / auth ---

export interface Area {
  id: number
  name: string
  stage: ShipmentStage
}

export interface Worker {
  id: number
  name: string
  username: string
  is_active: boolean
  area: Area
  created_at: string
}

export interface WorkerCreate {
  name: string
  username: string
  password: string
  area_id: number
}

export interface LoginResponse {
  access_token: string
  token_type: string
  worker: Worker
}

export interface WorkerQueueItem {
  id: number
  job_number: string | null
  customer_name: string
  origin: string
  destination: string
  cargo_type: string
  waiting_since: string
  last_note: string | null
}

// --- customer portal ---

export interface CustomerLoginResponse {
  access_token: string
  token_type: string
  customer: Customer
}

export interface CustomerShipmentSummary {
  id: number
  job_number: string | null
  origin: string
  destination: string
  stage: ShipmentStage
  is_at_risk: boolean
  is_cancelled: boolean
  is_on_hold: boolean
  updated_at: string
}

export interface CustomerInvoiceLineItem {
  id: number
  kind: ChargeKind
  description: string
  amount: string
  quantity: string
  unit_price: string
}

export interface CustomerInvoiceSummary {
  id: number
  invoice_number: string
  status: InvoiceStatus
  issued_date: string
  currency: string
  total: string
}

export interface CustomerInvoiceDetail {
  service_charge_amount: string
  id: number
  invoice_number: string
  status: InvoiceStatus
  issued_date: string
  currency: string
  subtotal: string
  tax_amount: string
  discount_amount: string
  total: string
  origin: string
  destination: string
  incoterm: string
  job_number: string | null
  line_items: CustomerInvoiceLineItem[]
  quote_reference: string | null
  quote_date: string | null
  quote_valid_until: string | null
  dimensions: string | null
  description: string | null
  ready_date: string | null
  schedule: AirlineScheduleInput[] | null
  carrier: string | null
  cargo_type: string | null
  mode: string
  hs_code: string | null
  pieces: number | null
  weight_kg: string
  volume_cbm: string
  chargeable_weight_kg: string
  voyage_flight_number: string | null
  clauses: string | null
  remarks: string | null
}

// --- ops auth ---

export interface OpsUser {
  id: number
  name: string
  username: string
  is_active: boolean
}

export interface OpsLoginResponse {
  access_token: string
  token_type: string
  ops_user: OpsUser
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
  confirm_new_password: string
}

// --- rate cards ---

export type UnitOfMeasure = "per_kg" | "per_cbm" | "flat"

export type ChargeBasis = "flat" | "per_kg" | "percent_of_freight"

export interface RateCardBreak {
  id: number
  min_weight: string | null
  max_weight: string | null
  min_volume: string | null
  max_volume: string | null
  unit: UnitOfMeasure
  rate: string
  description: string | null
}

export interface RateCardBreakInput {
  min_weight: string | null
  max_weight: string | null
  min_volume: string | null
  max_volume: string | null
  unit: UnitOfMeasure
  rate: string
  description: string | null
}

export interface RateCardCharge {
  id: number
  kind: ChargeKind
  description: string
  basis: ChargeBasis
  amount: string
}

export interface RateCardChargeInput {
  kind: ChargeKind
  description: string
  basis: ChargeBasis
  amount: string
}

export interface RateCard {
  id: number
  origin: string
  destination: string
  mode: TransportMode
  carrier: string | null
  currency: string
  valid_from: string
  valid_until: string
  minimum_charge: string
  breaks: RateCardBreak[]
  charges: RateCardCharge[]
  created_at: string
  updated_at: string
}

export interface RateCardInput {
  origin: string
  destination: string
  mode: TransportMode
  carrier: string | null
  currency: string
  valid_from: string
  valid_until: string
  minimum_charge: string
  breaks: RateCardBreakInput[]
  charges: RateCardChargeInput[]
}

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"

export interface AirlineSchedule {
  id: number
  airline_name: string
  origin: string
  destination: string
  mode: TransportMode
  days_of_week: DayOfWeek[]
  notes: string | null
  created_at: string
  updated_at: string
  flight_number?: string | null
  routing?: string | null
  departure_time?: string | null
  transit_time?: string | null
  valid_from?: string | null
  valid_until?: string | null
}

export interface AirlineScheduleInput {
  airline_name: string
  origin: string
  destination: string
  mode: TransportMode
  days_of_week: DayOfWeek[]
  notes: string | null
  flight_number?: string | null
  routing?: string | null
  departure_time?: string | null
  transit_time?: string | null
  valid_from?: string | null
  valid_until?: string | null
}

export interface EmailResult {
  sent: boolean
  status: string
  recipient: string | null
  error: string | null
}
