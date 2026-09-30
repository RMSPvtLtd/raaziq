import { useId } from "react"
import { Input } from "@/components/ui/input"

export function AirlineInput(props: React.ComponentProps<typeof Input>) {
  const listId = useId()
  return <><Input {...props} list={listId} /><datalist id={listId}>{["EMIRATES", "TURKISH AIRLINES", "QATAR AIRWAYS"].map((name) => <option key={name} value={name} />)}</datalist></>
}
