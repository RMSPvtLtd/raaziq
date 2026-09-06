import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")

test("brand shell keeps the approved navigation and motion contracts", () => {
  const buttons = source("components/ui/button.tsx")
  const ops = source("components/layout/OpsShell.tsx")
  const customer = source("components/layout/CustomerShell.tsx")

  assert.equal(buttons.includes("transition-all"), false)
  assert.match(buttons, /default:\s*\n\s*"h-10/)
  assert.match(ops, /raaziq-ops-sidebar-collapsed/)
  assert.match(ops, /duration-200/)
  assert.match(ops, /Search shipments/)
  assert.match(customer, /Customer navigation/)
  assert.match(customer, /pb-24/)
})
