import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("worker completion keeps touch targets, upload safety and reduced-motion support", () => {
  const page = readFileSync(new URL("../src/pages/WorkerQueuePage.tsx", import.meta.url), "utf8")
  assert.match(page, /className="h-11 gap-1.5"/)
  assert.match(page, /h-\[52px\] w-full/)
  assert.match(page, /disabled=\{submitting \|\| uploading \|\| done\}/)
  assert.match(page, /prefers-reduced-motion: reduce/)
  assert.match(page, /delay: 120, duration: 180/)
  assert.match(page, /remaining.reload\(\); completed.reload\(\)/)
  assert.match(page, /role="status".*completed successfully/)
})
