import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Airplane } from "@phosphor-icons/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useAsync } from "@/hooks/useAsync"
import { customersApi, inquiriesApi, quotesApi } from "@/lib/api/client"
import { ApiError } from "@/lib/api/client"

const INCOTERMS = ["EXW", "FOB", "CFR", "DAP", "DDP"] as const

// Raaziq currently only quotes air freight -- the backend's TransportMode
// still supports sea/road for later, but this form doesn't offer them.
const MODE = "air" as const

export function InquiryForm() {
  const navigate = useNavigate()
  const customers = useAsync(() => customersApi.list(), [])

  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing")
  const [customerId, setCustomerId] = useState<string>("")
  const [newName, setNewName] = useState("")
  const [newCompany, setNewCompany] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newPhone, setNewPhone] = useState("")

  const [origin, setOrigin] = useState("")
  const [destination, setDestination] = useState("")
  const [cargoType, setCargoType] = useState("")
  const [hsCode, setHsCode] = useState("")
  const [pieces, setPieces] = useState("")
  const [weightKg, setWeightKg] = useState("")
  const [volumeCbm, setVolumeCbm] = useState("")
  const [dimensions, setDimensions] = useState("")
  const [incoterm, setIncoterm] = useState<string>("DAP")
  const [readyDate, setReadyDate] = useState("")
  const [description, setDescription] = useState("")

  // Supplier/shipper: only needed when the billed customer isn't the party
  // the goods actually ship from (e.g. an import job) -- optional, printed
  // on the quote/invoice but not tied to any account.
  const [supplierName, setSupplierName] = useState("")
  const [supplierAddress, setSupplierAddress] = useState("")

  const [submitting, setSubmitting] = useState(false)

  const customerValid = customerMode === "existing" ? Boolean(customerId) : Boolean(newName.trim() && newEmail.trim())
  const formValid =
    customerValid &&
    /^[A-Z]{3}$/.test(origin) &&
    /^[A-Z]{3}$/.test(destination) &&
    cargoType.trim() &&
    Number(weightKg) > 0 &&
    Number(volumeCbm) > 0 &&
    incoterm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formValid || submitting) return
    setSubmitting(true)
    try {
      let resolvedCustomerId: number
      if (customerMode === "existing") {
        resolvedCustomerId = Number(customerId)
      } else {
        try {
          const created = await customersApi.create({
            name: newName.trim(),
            company_name: newCompany.trim() || null,
            email: newEmail.trim(),
            phone: newPhone.trim() || null,
          })
          resolvedCustomerId = created.id
        } catch (err) {
          // A customer with this email already exists -- the backend names
          // them in err.body.customer_id. Switch to "Existing customer" and
          // preselect them instead of just leaving the user stuck on a
          // generic conflict error.
          const body = err instanceof ApiError ? (err.body as { customer_id?: number } | undefined) : undefined
          if (err instanceof ApiError && err.status === 409 && body?.customer_id) {
            setCustomerMode("existing")
            setCustomerId(String(body.customer_id))
            toast.error(`${err.message} Switched to that customer -- review and submit again.`)
            return
          }
          throw err
        }
      }

      const inquiry = await inquiriesApi.create({
        customer_id: resolvedCustomerId,
        origin: origin.trim(),
        destination: destination.trim(),
        mode: MODE,
        cargo_type: cargoType.trim(),
        weight_kg: weightKg,
        volume_cbm: volumeCbm,
        dimensions: dimensions.trim() || null,
        incoterm,
        ready_date: readyDate || null,
        description: description.trim() || null,
        hs_code: hsCode.trim() || null,
        pieces: pieces ? Number(pieces) : null,
        supplier_name: supplierName.trim() || null,
        supplier_address: supplierAddress.trim() || null,
      })

      try {
        const quotes = await quotesApi.generate(inquiry.id)
        toast.success(quotes.length > 1 ? `${quotes.length} carrier quotes generated` : "Quote generated")
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          // No rate card matches this lane at all -- the inquiry itself was
          // still created successfully, so route to the comparison page
          // where ops can add a manual quote instead of losing the inquiry.
          toast.error("No rate card matches this lane. Enter a rate manually on the next screen.")
        } else {
          throw err
        }
      }
      navigate(`/inquiries/${inquiry.id}/quotes`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate a quote.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={customerMode === "existing" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCustomerMode("existing")}
            >
              Existing customer
            </Button>
            <Button
              type="button"
              variant={customerMode === "new" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCustomerMode("new")}
            >
              New customer
            </Button>
          </div>

          {customerMode === "existing" ? (
            <div className="space-y-1.5">
              <Label>Select customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={customers.loading ? "Loading customers…" : "Choose a customer"} />
                </SelectTrigger>
                <SelectContent>
                  {(customers.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} {c.company_name ? `· ${c.company_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Contact name" />
              </Field>
              <Field label="Company">
                <Input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Company name" />
              </Field>
              <Field label="Email" required>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@company.com" />
              </Field>
              <Field label="Phone">
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+92-..." />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shipment details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Origin" required>
              <Input value={origin} onChange={(e) => setOrigin(e.target.value.toUpperCase())} placeholder="LHE" maxLength={3} pattern="[A-Z]{3}" />
            </Field>
            <Field label="Destination" required>
              <Input value={destination} onChange={(e) => setDestination(e.target.value.toUpperCase())} placeholder="DXB / LHR" maxLength={3} pattern="[A-Z]{3}" />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Mode">
              <div className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-muted px-3 text-sm text-muted-foreground">
                <Airplane size={16} />
                Air Freight
              </div>
            </Field>
            <Field label="Cargo type" required>
              <Input value={cargoType} onChange={(e) => setCargoType(e.target.value)} placeholder="e.g. Garments" />
            </Field>
            <Field label="Incoterm" required>
              <Select value={incoterm} onValueChange={setIncoterm}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCOTERMS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Weight (kg)" required>
              <Input type="number" min="0.01" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Volume (CBM)" required>
              <Input type="number" min="0.001" step="0.001" value={volumeCbm} onChange={(e) => setVolumeCbm(e.target.value)} placeholder="0.000" />
            </Field>
            <Field label="Ready date">
              <Input type="date" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="HS Code">
              <Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="e.g. 5209.2200" />
            </Field>
            <Field label="Pieces">
              <Input type="number" min="1" step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="e.g. 27" />
            </Field>
            <Field label="Dimensions">
              <Input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="e.g. 120 x 80 x 100 cm" />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything else worth noting on this inquiry" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supplier / Shipper (optional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Only needed when the goods ship from a different party than the customer being billed (e.g. an import job).
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Supplier name">
              <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Wolmax International" />
            </Field>
            <Field label="Supplier address">
              <Input value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} placeholder="Supplier's address" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={!formValid || submitting} className="gap-1.5">
          {submitting ? "Generating quote…" : "Generate Quote"}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  )
}
