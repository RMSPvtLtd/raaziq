import { Outlet } from "react-router-dom"
import { ThemeToggle } from "@/components/shared/ThemeToggle"

// Deliberately spare -- no ops navigation, no internal terminology. This is
// the only screen an external customer ever sees.
export function PublicShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-24 max-w-[1200px] items-center gap-5 px-5 sm:px-8">
          <a href="/track" aria-label="Raaziq shipment tracking"><img src="/raaziq-logo.png" alt="Raaziq" width={161} height={133} className="h-20 w-auto bg-white p-1" /></a>
          <div className="hidden border-l border-border pl-5 sm:block"><p className="text-xs font-semibold uppercase tracking-[0.18em]">Shipment tracking</p><p className="mt-1 text-xs text-muted-foreground">Moving you since 1974</p></div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <Outlet />
      </main>
      <footer className="border-t border-border py-4">
        <p className="mx-auto max-w-[1200px] px-5 text-xs text-muted-foreground sm:px-8">
          Need help with your shipment? Contact your Raaziq account manager.
        </p>
      </footer>
    </div>
  )
}
