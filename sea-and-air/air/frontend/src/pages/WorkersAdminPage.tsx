import { useMemo, useState } from "react"
import { toast } from "sonner"
import { MagnifyingGlass, Plus, UserCircle } from "@phosphor-icons/react"
import { PageHeader } from "@/components/shared/PageHeader"
import { LoadingState, ErrorState } from "@/components/shared/States"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useAsync } from "@/hooks/useAsync"
import { useStages } from "@/hooks/useStages"
import { areasApi, workersApi, ApiError } from "@/lib/api/client"
import type { Area, Worker } from "@/lib/api/types"

export function WorkersAdminPage() {
  const areas = useAsync(() => areasApi.list(), [])
  const workers = useAsync(() => workersApi.list(), [])
  const { groupFor } = useStages()
  const [search, setSearch] = useState("")

  const loading = areas.loading || workers.loading
  const error = areas.error ?? workers.error
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return (areas.data ?? []).flatMap<{ area: Area; worker: Worker | null }>((area) => {
      const assigned = (workers.data ?? []).filter((worker) => worker.area.id === area.id)
      const areaMatches = !term || [area.name, area.stage].some((value) => value.toLocaleLowerCase().includes(term))
      const matches = areaMatches ? assigned : assigned.filter((worker) => [worker.name, worker.username].some((value) => value.toLocaleLowerCase().includes(term)))
      return matches.length ? matches.map((worker) => ({ area, worker })) : areaMatches ? [{ area, worker: null }] : []
    })
  }, [areas.data, search, workers.data])
  const mobileAreas = rows.reduce<{ area: Area; workers: Worker[] }[]>((groups, row) => {
    let group = groups.at(-1)
    if (group?.area.id !== row.area.id) {
      group = { area: row.area, workers: [] }
      groups.push(group)
    }
    if (row.worker) group.workers.push(row.worker)
    return groups
  }, [])

  return (
    <div>
      <PageHeader
        title="Workers"
        description="Each worker belongs to one area. Anyone in an area can complete shipments waiting for that area's stage."
        action={
          !loading && !error && areas.data ? (
            <CreateWorkerDialog areas={areas.data} onCreated={workers.reload} />
          ) : undefined
        }
      />

      {loading && <LoadingState rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={() => { areas.reload(); workers.reload() }} />}

      {!loading && !error && (
        <><div className="relative mb-4"><MagnifyingGlass size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search workers" placeholder="Search worker, username, area, or stage…" className="pl-9" /></div>
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {mobileAreas.map(({ area, workers: areaWorkers }) => {
            const group = groupFor(area.stage)
            return (
              <div key={area.id}>
                {group && (
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {group}
                  </p>
                )}
                <Card>
                  <CardContent className="py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <h2 className="font-heading text-sm font-semibold text-foreground">{area.name}</h2>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {areaWorkers.filter((worker) => worker.is_active).length} active / {areaWorkers.length} total
                      </Badge>
                    </div>
                    {areaWorkers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No workers assigned yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {areaWorkers.map((w) => (
                          <li
                            key={w.id}
                            className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 text-sm"
                          >
                            <span className="flex min-w-0 flex-wrap items-center gap-2">
                              <UserCircle size={18} className="text-muted-foreground" />
                              <span className="font-medium text-foreground">{w.name}</span>
                              <span className="text-muted-foreground">@{w.username}</span>
                              <Badge variant={w.is_active ? "secondary" : "outline"}>{w.is_active ? "Active" : "Inactive"}</Badge>
                            </span>
                            <ToggleActiveButton
                              workerId={w.id}
                              isActive={w.is_active}
                              onChanged={workers.reload}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div></>
      )}
    </div>
  )
}

function ToggleActiveButton({
  workerId,
  isActive,
  onChanged,
}: {
  workerId: number
  isActive: boolean
  onChanged: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function handleToggle() {
    setSubmitting(true)
    try {
      await workersApi.setActive(workerId, !isActive)
      toast.success(isActive ? "Worker deactivated" : "Worker reactivated")
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update worker.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button variant={isActive ? "outline" : "secondary"} size="sm" disabled={submitting} onClick={handleToggle}>
      {isActive ? "Deactivate" : "Reactivate"}
    </Button>
  )
}

function CreateWorkerDialog({
  areas,
  onCreated,
}: {
  areas: { id: number; name: string }[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [areaId, setAreaId] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  const valid = name.trim() && username.trim().length >= 3 && password.length >= 6 && areaId

  function reset() {
    setName("")
    setUsername("")
    setPassword("")
    setAreaId("")
  }

  async function handleCreate() {
    if (!valid) return
    setSubmitting(true)
    try {
      await workersApi.create({ name: name.trim(), username: username.trim(), password, area_id: Number(areaId) })
      toast.success("Worker account created")
      reset()
      setOpen(false)
      onCreated()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create worker.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus size={16} />
          New Worker
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create worker account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="worker-name">Name</Label>
            <Input id="worker-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ayesha Raza" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="worker-username">Username</Label>
            <Input id="worker-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ayesha.docs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="worker-password">Temporary password</Label>
            <PasswordInput
              id="worker-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Area</Label>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-full" aria-label="Worker area">
                <SelectValue placeholder="Select an area" />
              </SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!valid || submitting}>
            {submitting ? "Creating…" : "Create Worker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
