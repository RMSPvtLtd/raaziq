import type { AirlineSchedule, DayOfWeek } from "./api/types"

export function filterSchedules(schedules: AirlineSchedule[], { search, day, lane, carrier }: { search: string; day: DayOfWeek | "all"; lane: string; carrier: string }) {
  const term = search.trim().toLocaleLowerCase()
  return schedules.filter((schedule) =>
    (day === "all" || schedule.days_of_week.includes(day)) &&
    (lane === "all" || `${schedule.origin} → ${schedule.destination}` === lane) &&
    (carrier === "all" || schedule.airline_name === carrier) &&
    (!term || [schedule.airline_name, schedule.origin, schedule.destination, schedule.mode].some((value) => value.toLocaleLowerCase().includes(term)))
  )
}
