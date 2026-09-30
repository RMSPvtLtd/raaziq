import { useState } from "react"
import { toast } from "sonner"
import { companiesApi, ApiError } from "@/lib/api/client"
import type { Company } from "@/lib/api/types"
import { useAsync } from "@/hooks/useAsync"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"

export function EmailSettings() {
  const companies = useAsync(() => companiesApi.list(), [])
  return <details className="mb-5 rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">AUTOMATIC QUOTATION &amp; INVOICE EMAIL</summary>
    <p className="my-3 text-sm text-muted-foreground">Quotations are emailed when sent; invoices when issued. Set a recipient for each billing company. Leave blank to use the configured default, or the customer email. Quotations use the default billing company.</p>
    {companies.error && <p role="alert">{companies.error}</p>}
    {companies.loading && <p>Loading email settings…</p>}
    <div className="space-y-3">{companies.data?.map((company) => <CompanyEmail key={`${company.id}-${company.notification_email}-${company.automatic_email_enabled}`} company={company} onSaved={companies.reload} />)}</div>
  </details>
}

function CompanyEmail({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [recipient, setRecipient] = useState(company.notification_email ?? "")
  const [enabled, setEnabled] = useState(company.automatic_email_enabled)
  const [saving, setSaving] = useState(false)
  return <Card><CardContent className="py-4"><form className="space-y-3" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true)
    try { await companiesApi.updateEmail(company.id, { notification_email: recipient.trim() || null, automatic_email_enabled: enabled }); toast.success("Email settings saved"); onSaved() }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not save email settings") }
    finally { setSaving(false) }
  }}><p className="font-medium uppercase">{company.name}{company.is_default ? " · DEFAULT" : ""}</p>
    <Label htmlFor={`recipient-${company.id}`}>RECIPIENT EMAIL</Label><Input id={`recipient-${company.id}`} type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="billing@example.com" className="normal-case" />
    <Label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> SEND AUTOMATICALLY</Label>
    <p className="text-xs text-muted-foreground">{company.email_configured ? "Email sender configured." : "Sender not connected. Configure Gmail sender credentials on the server to enable delivery."}</p>
    <Button type="submit" size="sm" disabled={saving}>{saving ? "SAVING…" : "SAVE EMAIL SETTINGS"}</Button>
  </form></CardContent></Card>
}

export function EmailStatus({ record }: { record: { email_status: string; email_recipient: string | null; email_error: string | null } }) {
  return <div className="my-4 rounded-lg border px-4 py-3 text-sm" role="status"><span className="font-medium uppercase">EMAIL: {record.email_status.replaceAll("_", " ")}</span>{record.email_recipient && <span className="normal-case"> · {record.email_recipient}</span>}{record.email_error && <p className="mt-1 text-muted-foreground">{record.email_error}</p>}</div>
}
