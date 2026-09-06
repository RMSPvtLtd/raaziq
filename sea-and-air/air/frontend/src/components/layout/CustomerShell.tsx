import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { FileText, Package, Receipt, SignOut } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/shared/ThemeToggle"
import { Button } from "@/components/ui/button"
import { useCustomerAuth } from "@/hooks/useCustomerAuth"

const NAV_LINKS = [
  { to: "/customer/shipments", label: "Shipments", icon: Package },
  { to: "/customer/quotes", label: "Quotes", icon: Receipt },
  { to: "/customer/invoices", label: "Invoices", icon: FileText },
]

export function CustomerShell() {
  const { customer, logout } = useCustomerAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate("/customer/login")
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:gap-6 sm:px-6">
          <NavLink
            to="/customer/shipments"
            aria-label="Raaziq customer portal"
            className="flex shrink-0 items-center rounded-md bg-white px-1.5 py-1"
          >
            <img src="/raaziq-logo.png" alt="Raaziq" width={161} height={133} className="h-9 w-auto" />
          </NavLink>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
            {NAV_LINKS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {customer && (
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">{customer.name}</span>
            )}
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={handleLogout}>
              <SignOut size={18} />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-18 grid-cols-3 border-t border-border bg-card/98 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden" aria-label="Customer navigation">
        {NAV_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn("flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors duration-150", isActive ? "text-accent-foreground" : "text-muted-foreground")}>
            <Icon size={21} weight="duotone" aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
