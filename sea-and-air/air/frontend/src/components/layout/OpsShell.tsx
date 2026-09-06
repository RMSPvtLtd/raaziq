import { useEffect, useRef, useState, type ComponentType, type FormEvent } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { CalendarBlank, CaretDoubleLeft, CaretDoubleRight, Key, List, MagnifyingGlass, Package, Plus, Receipt, Scales, SignOut, UserCircle, Users } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/shared/ThemeToggle"
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useOpsAuth } from "@/hooks/useOpsAuth"

type Icon = ComponentType<{ size?: number; weight?: "regular" | "fill" | "duotone"; className?: string }>

const NAV_GROUPS: { label: string; links: { to: string; label: string; icon: Icon }[] }[] = [
  { label: "Control Tower", links: [{ to: "/overview", label: "Overview", icon: List }, { to: "/shipments", label: "Shipments", icon: Package }] },
  { label: "Commercial", links: [{ to: "/quotes", label: "Quotes", icon: Receipt }, { to: "/rate-cards", label: "Rate Cards", icon: Scales }, { to: "/airline-schedules", label: "Airline Schedules", icon: CalendarBlank }, { to: "/invoices", label: "Invoices", icon: Receipt }] },
  { label: "Network", links: [{ to: "/customers", label: "Customers", icon: UserCircle }, { to: "/workers", label: "Workers", icon: Users }] },
]

function SidebarNav({ closeOnNavigate = false, collapsed = false }: { closeOnNavigate?: boolean; collapsed?: boolean }) {
  return (
    <nav className="space-y-5" aria-label="Operations navigation">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className={cn("mb-1.5 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground", collapsed && "sr-only")}>{group.label}</p>
          <div className="space-y-0.5">
            {group.links.map(({ to, label, icon: Icon }) => {
              const link = <NavLink to={to} end={to === "/overview"} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} className={({ isActive }) => cn("flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150", collapsed && "justify-center px-0", isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon size={18} aria-hidden="true" /><span className={collapsed ? "sr-only" : undefined}>{label}</span></NavLink>
              return closeOnNavigate ? <SheetClose asChild key={to}>{link}</SheetClose> : <div key={to}>{link}</div>
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function AccountMenu({ name, username, logout, onChangePassword, compact = false }: { name?: string; username?: string; logout: () => void; onChangePassword: () => void; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size={compact ? "icon" : "sm"} className={cn(!compact && "max-w-44 gap-1.5 px-2.5")} aria-label={compact ? (name ?? "Account") : undefined} title={compact ? (name ?? "Account") : undefined}><UserCircle size={18} aria-hidden="true" />{!compact && <span className="truncate">{name ?? "Account"}</span>}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{username ?? "Signed in"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onChangePassword} className="gap-2"><Key size={16} /> Change password</DropdownMenuItem>
        <DropdownMenuItem onClick={logout} className="gap-2"><SignOut size={16} /> Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function OpsShell() {
  const navigate = useNavigate()
  const { opsUser, logout } = useOpsAuth()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("raaziq-ops-sidebar-collapsed") === "true"
    } catch {
      return false
    }
  })
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem("raaziq-ops-sidebar-collapsed", String(sidebarCollapsed))
    } catch {
      // The shell still works when storage is blocked.
    }
  }, [sidebarCollapsed])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const term = search.trim()
    navigate(term ? `/shipments?search=${encodeURIComponent(term)}` : "/shipments")
  }

  return (
    <div className="min-h-dvh bg-background lg:flex">
      <aside data-collapsed={sidebarCollapsed} className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-card px-3 py-4 transition-[width] duration-200 ease-out data-[collapsed=true]:w-[var(--sidebar-width-collapsed)] lg:flex" aria-label="Operations sidebar">
        <div className={cn("mb-5 flex items-start gap-2", sidebarCollapsed ? "flex-col items-center" : "justify-between")}>
          <NavLink to="/overview" aria-label="Raaziq overview" className="flex min-h-12 items-center justify-center rounded-lg bg-white px-2">
            <img src="/raaziq-logo.png" alt="Raaziq" width={161} height={133} className={cn("h-auto object-contain", sidebarCollapsed ? "w-10" : "w-24")} />
          </NavLink>
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expand operations sidebar" : "Collapse operations sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <CaretDoubleRight size={17} aria-hidden="true" /> : <CaretDoubleLeft size={17} aria-hidden="true" />}
          </Button>
        </div>
        <Button asChild className={cn("mb-7 w-full gap-2", sidebarCollapsed ? "px-0" : "justify-start px-3")}><NavLink to="/quotes/new" aria-label={sidebarCollapsed ? "New Quote" : undefined} title={sidebarCollapsed ? "New Quote" : undefined}><Plus size={17} /><span className={sidebarCollapsed ? "sr-only" : undefined}>New Quote</span></NavLink></Button>
        <SidebarNav collapsed={sidebarCollapsed} />
        <div className="mt-auto space-y-3 border-t border-border pt-4">
          <a href="/track" target="_blank" rel="noreferrer" aria-label={sidebarCollapsed ? "Customer Tracking (opens in a new tab)" : undefined} title={sidebarCollapsed ? "Customer Tracking" : undefined} className={cn("flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground", sidebarCollapsed && "justify-center px-0")}><MagnifyingGlass size={17} aria-hidden="true" /><span className={sidebarCollapsed ? "sr-only" : undefined}>Customer Tracking <span aria-hidden="true">↗</span></span></a>
          <div className={cn("flex items-center px-2", sidebarCollapsed ? "justify-center" : "justify-between")}><span className={cn("text-xs text-muted-foreground", sidebarCollapsed && "sr-only")}>Theme</span><ThemeToggle /></div>
          <AccountMenu compact={sidebarCollapsed} name={opsUser?.name} username={opsUser?.username} logout={logout} onChangePassword={() => setChangePasswordOpen(true)} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[var(--topbar-height)] items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur-sm lg:px-7">
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open operations navigation"><List size={21} /></Button></SheetTrigger>
            <SheetContent side="left" className="w-[min(86vw,20rem)] p-0" aria-describedby="mobile-nav-description">
              <SheetHeader className="border-b border-border px-5 py-4"><SheetTitle><img src="/raaziq-logo.png" alt="Raaziq" width={161} height={133} className="h-auto w-20 rounded-md bg-white p-1" /></SheetTitle><SheetDescription id="mobile-nav-description">Operations navigation</SheetDescription></SheetHeader>
              <div className="overflow-y-auto px-3 py-5">
                <Button asChild className="mb-7 w-full justify-start gap-2 px-3"><SheetClose asChild><NavLink to="/quotes/new"><Plus size={17} /> New Quote</NavLink></SheetClose></Button>
                <SidebarNav closeOnNavigate />
                <div className="mt-7 border-t border-border pt-4"><SheetClose asChild><a href="/track" target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><MagnifyingGlass size={17} /> Customer Tracking ↗</a></SheetClose></div>
              </div>
            </SheetContent>
          </Sheet>
          <NavLink to="/overview" aria-label="Raaziq overview" className="rounded-md bg-white px-1.5 py-1 lg:hidden"><img src="/raaziq-logo.png" alt="Raaziq" width={161} height={133} className="h-8 w-auto" /></NavLink>
          <form onSubmit={submitSearch} className="min-w-0 max-w-md flex-1" role="search">
            <label htmlFor="ops-search" className="sr-only">Search shipments</label>
            <div className="relative"><MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input ref={searchRef} id="ops-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shipments…" className="pl-8 pr-16" /><Button type="submit" variant="outline" size="xs" className="absolute right-1 top-1/2 h-6 -translate-y-1/2 px-2"><MagnifyingGlass className="sm:hidden" aria-hidden="true" /><span className="hidden sm:inline">Search</span><span className="sr-only sm:hidden">Search shipments</span></Button></div>
          </form>
          <div className="ml-auto flex items-center gap-1"><a href="/track" target="_blank" rel="noreferrer" aria-label="Customer tracking" className="hidden rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground sm:flex sm:items-center sm:gap-1.5"><MagnifyingGlass size={16} /> Tracking ↗</a><ThemeToggle /><div className="lg:hidden"><AccountMenu name={opsUser?.name} username={opsUser?.username} logout={logout} onChangePassword={() => setChangePasswordOpen(true)} /></div></div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-7"><Outlet /></main>
      </div>
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  )
}
