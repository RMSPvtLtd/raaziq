import { useMemo, useState } from "react"
import { toast } from "sonner"
import { DotsThree, Key, MagnifyingGlass, UserCircle } from "@phosphor-icons/react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/States"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useAsync } from "@/hooks/useAsync"
import { customersApi, ApiError } from "@/lib/api/client"
import type { Customer } from "@/lib/api/types"

export function CustomersAdminPage() {
  const customers = useAsync(() => customersApi.list(), [])
  const [search, setSearch] = useState("")
  const [view, setView] = useState("all")
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return (customers.data ?? []).filter((customer) =>
      (view === "all" || (view === "enabled" ? customer.portal_active : view === "disabled" ? customer.username && !customer.portal_active : !customer.username)) &&
      (!term || [customer.name, customer.company_name, customer.email, customer.username].some((value) => String(value ?? "").toLocaleLowerCase().includes(term)))
    )
  }, [customers.data, search, view])

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Grant a portal login to higher-volume clients so they can track their own shipments and quotes."
      />

      {customers.loading && <LoadingState rows={4} />}
      {!customers.loading && customers.error && <ErrorState message={customers.error} onRetry={customers.reload} />}
      {!customers.loading && !customers.error && (customers.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={<UserCircle size={32} />}
          title="No customers yet"
          description="Customers are created from the New Quote flow."
        />
      )}

      {!customers.loading && !customers.error && (customers.data?.length ?? 0) > 0 && <>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><MagnifyingGlass size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search customers" placeholder="Search customer, company, email, or username…" className="pl-9" /></div><Select value={view} onValueChange={setView}><SelectTrigger className="w-full sm:w-52" aria-label="Portal access view"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All customers</SelectItem><SelectItem value="enabled">Portal enabled</SelectItem><SelectItem value="disabled">Portal disabled</SelectItem><SelectItem value="none">No portal access</SelectItem></SelectContent></Select></div>
        {visible.length === 0 ? <EmptyState icon={<UserCircle size={32} />} title="No customers match this view" description="Try another search or access state." /> : <CustomerRecords customers={visible} onChanged={customers.reload} />}
      </>}
    </div>
  )
}

function CustomerRecords({ customers, onChanged }: { customers: Customer[]; onChanged: () => void }) {
  return <><div className="hidden overflow-auto rounded-xl border border-border lg:block"><table className="w-full text-sm"><thead className="bg-muted/40"><tr><th className="h-10 px-3 text-left font-medium">Customer</th><th className="px-3 text-left font-medium">Company</th><th className="px-3 text-left font-medium">Email</th><th className="px-3 text-left font-medium">Portal</th><th className="px-3 text-right font-medium">Actions</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id} className="border-t border-border"><td className="p-3 font-medium">{customer.name}</td><td className="p-3 text-muted-foreground">{customer.company_name || "—"}</td><td className="p-3">{customer.email}</td><td className="p-3">{customer.username ? <><Badge variant="outline">@{customer.username}</Badge><span className="ml-2 text-xs text-muted-foreground">{customer.portal_active ? "Enabled" : "Disabled"}</span></> : <span className="text-muted-foreground">Not granted</span>}</td><td className="p-3"><CustomerActions customer={customer} onChanged={onChanged} /></td></tr>)}</tbody></table></div><div className="space-y-3 lg:hidden">{customers.map((customer) => <CustomerRow key={customer.id} customer={customer} onChanged={onChanged} />)}</div></>
}

function CustomerActions({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const [resetOpen, setResetOpen] = useState(false)
  return <div className="flex flex-wrap items-center justify-end gap-2">{customer.username ? <><PortalStatusToggle customer={customer} onChanged={onChanged} onReset={() => setResetOpen(true)} /><GrantAccessDialog customer={customer} onChanged={onChanged} resetting controlledOpen={resetOpen} onControlledOpenChange={setResetOpen} /></> : <GrantAccessDialog customer={customer} onChanged={onChanged} resetting={false} />}</div>
}

function CustomerRow({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-heading text-sm font-semibold text-foreground">{customer.name}</p>
            {customer.company_name && <span className="text-sm text-muted-foreground">{customer.company_name}</span>}
          </div>
          <p className="text-xs text-muted-foreground">{customer.email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {customer.username ? (
            <>
              <Badge variant="outline" className="gap-1 text-[11px]">
                @{customer.username}
              </Badge>
              <Badge variant={customer.portal_active ? "secondary" : "outline"}>{customer.portal_active ? "Portal enabled" : "Portal disabled"}</Badge>
              <CustomerActions customer={customer} onChanged={onChanged} />
            </>
          ) : (
            <CustomerActions customer={customer} onChanged={onChanged} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function PortalStatusToggle({ customer, onChanged, onReset }: { customer: Customer; onChanged: () => void; onReset: () => void }) {
  const [submitting, setSubmitting] = useState(false)

  async function handleToggle() {
    setSubmitting(true)
    try {
      await customersApi.setPortalActive(customer.id, !customer.portal_active)
      toast.success(customer.portal_active ? "Portal access disabled" : "Portal access enabled")
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update portal access.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Portal actions for ${customer.name}`} disabled={submitting}><DotsThree size={20} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={onReset}><Key size={14} /> Reset password</DropdownMenuItem><DropdownMenuItem onSelect={handleToggle}>{customer.portal_active ? "Disable portal access" : "Enable portal access"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  )
}

function GrantAccessDialog({
  customer,
  onChanged,
  resetting,
  controlledOpen,
  onControlledOpenChange,
}: {
  customer: Customer
  onChanged: () => void
  resetting: boolean
  controlledOpen?: boolean
  onControlledOpenChange?: (open: boolean) => void
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onControlledOpenChange ?? setLocalOpen
  const [username, setUsername] = useState(customer.username ?? "")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const valid = username.trim().length >= 3 && password.length >= 6

  async function handleSubmit() {
    if (!valid) return
    setSubmitting(true)
    try {
      await customersApi.grantPortalAccess(customer.id, { username: username.trim(), password })
      toast.success(resetting ? "Portal password reset" : "Portal access granted")
      setPassword("")
      setOpen(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not grant portal access.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && <DialogTrigger asChild>
        <Button variant={resetting ? "ghost" : "secondary"} size="sm" className="gap-1.5">
          <Key size={14} />
          {resetting ? "Reset password" : "Grant portal access"}
        </Button>
      </DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resetting ? "Reset portal password" : "Grant portal access"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="customer-username">Username</Label>
            <Input
              id="customer-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. orient.traders"
              disabled={resetting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-password">{resetting ? "New password" : "Temporary password"}</Label>
            <PasswordInput
              id="customer-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? "Saving…" : resetting ? "Reset password" : "Grant access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
