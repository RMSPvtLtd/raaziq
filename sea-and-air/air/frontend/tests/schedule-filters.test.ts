import assert from "node:assert/strict"
import test from "node:test"
import { filterSchedules } from "../src/lib/schedule-filters.ts"
import type { AirlineSchedule } from "../src/lib/api/types"

test("schedule filters intersect lane, carrier, day and normalized search", () => {
  const schedules = [
    { id: 1, airline_name: "Carrier A", origin: "Lahore", destination: "Dubai", mode: "air", days_of_week: ["mon"] },
    { id: 2, airline_name: "Carrier B", origin: "Lahore", destination: "Dubai", mode: "air", days_of_week: ["tue"] },
  ] as AirlineSchedule[]
  const filters = { search: " LAHORE ", day: "mon" as const, lane: "Lahore → Dubai", carrier: "Carrier A" }
  assert.deepEqual(filterSchedules(schedules, filters).map((s) => s.id), [1])
  assert.equal(filterSchedules(schedules, { ...filters, carrier: "Carrier B" }).length, 0)
  assert.equal(filterSchedules(schedules, { search: "", day: "all", lane: "all", carrier: "all" }).length, 2)
})
