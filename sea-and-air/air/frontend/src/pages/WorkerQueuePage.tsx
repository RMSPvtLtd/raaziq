import { useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { ArrowClockwise, CheckCircle, ClipboardText, SignOut, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/States"
import { useAsync } from "@/hooks/useAsync"
import { useWorkerAuth } from "@/hooks/useWorkerAuth"
import { ApiError, workerPortalApi } from "@/lib/api/client"
import { formatRelativeTime } from "@/lib/format"
import type { WorkerQueueItem } from "@/lib/api/types"

type QueueTab = "remaining" | "completed"

export function WorkerQueuePage() {
  const { worker, token, logout } = useWorkerAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState<QueueTab>("remaining")
  const [customer, setCustomer] = useState<string>("all")

  const remaining = useAsync(() => workerPortalApi.queue(token!), [token])
  const completed = useAsync(() => workerPortalApi.completed(token!), [token])
  const active = tab === "remaining" ? remaining : completed

  // Per-customer filter chips, derived from whichever list is currently
  // loaded rather than a hardcoded "main customers" list -- scales to
  // whatever real customers actually have shipments in this worker's view.
  const customerNames = useMemo(
    () => Array.from(new Set((active.data ?? []).map((item) => item.customer_name))).sort(),
    [active.data],
  )
  const visibleItems = (active.data ?? []).filter((item) => customer === "all" || item.customer_name === customer)

  if (!worker || !token) return null // route guard already redirects; guards a render-before-redirect flash

  function handleLogout() {
    logout()
    navigate("/worker/login")
  }

  function handleTabChange(next: string) {
    setTab(next as QueueTab)
    setCustomer("all") // a customer selected on one tab may not exist on the other
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{worker.name}</p>
            <p className="text-xs text-muted-foreground">{worker.area.name}</p>
          </div>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Sign out" onClick={handleLogout}>
            <SignOut size={18} />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-heading text-lg font-semibold text-foreground">Waiting for {worker.area.name}</h1>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Refresh" onClick={active.reload}>
            <ArrowClockwise size={18} />
          </Button>
        </div>

        <Tabs value={tab} onValueChange={handleTabChange} className="mb-3">
          <TabsList>
            <TabsTrigger value="remaining">Remaining <span className="tabular-nums text-muted-foreground">{remaining.data?.length ?? 0}</span></TabsTrigger>
            <TabsTrigger value="completed">Completed <span className="tabular-nums text-muted-foreground">{completed.data?.length ?? 0}</span></TabsTrigger>
          </TabsList>
        </Tabs>

        {!active.loading && !active.error && customerNames.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Button
              variant={customer === "all" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCustomer("all")}
            >
              All customers
            </Button>
            {customerNames.map((name) => (
              <Button
                key={name}
                variant={customer === name ? "secondary" : "outline"}
                size="sm"
                onClick={() => setCustomer(name)}
              >
                {name}
              </Button>
            ))}
          </div>
        )}

        {active.loading && <LoadingState rows={3} />}

        {!active.loading && active.error && (
          <ErrorState
            message={active.error}
            onRetry={() => {
              if (active.error?.toLowerCase().includes("session")) {
                logout()
                navigate("/worker/login")
              } else {
                active.reload()
              }
            }}
          />
        )}

        {!active.loading && !active.error && visibleItems.length === 0 && (
          <EmptyState
            icon={<ClipboardText size={32} />}
            title={tab === "remaining" ? "Nothing waiting right now" : "Nothing completed yet"}
            description={
              tab === "remaining"
                ? `Shipments will show up here as soon as they're ready for ${worker.area.name}.`
                : `Shipments you mark done for ${worker.area.name} will show up here.`
            }
          />
        )}

        {!active.loading && !active.error && visibleItems.length > 0 && (
          <div className="space-y-3">
            {tab === "remaining"
              ? visibleItems.map((item) => (
                  <QueueItemCard key={item.id} item={item} token={token} onCompleted={() => { remaining.reload(); completed.reload() }} />
                ))
              : visibleItems.map((item) => <CompletedItemCard key={item.id} item={item} />)}
          </div>
        )}
      </main>
    </div>
  )
}

function CompletedItemCard({ item }: { item: WorkerQueueItem }) {
  const label = item.job_number ?? `Shipment #${item.id}`
  return (
    <Card className="opacity-80">
      <CardContent className="space-y-2 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-heading text-base font-semibold tabular-nums text-foreground">
              <CheckCircle size={16} weight="fill" className="text-status-success" />
              {label}
            </p>
            <p className="text-sm text-muted-foreground">
              {item.customer_name} · {item.origin} → {item.destination}
            </p>
            <p className="text-sm text-muted-foreground">{item.cargo_type}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(item.waiting_since)}</span>
        </div>
        {item.last_note && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">"{item.last_note}"</p>
        )}
      </CardContent>
    </Card>
  )
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

function QueueItemCard({
  item,
  token,
  onCompleted,
}: {
  item: WorkerQueueItem
  token: string
  onCompleted: () => void
}) {
  const label = item.job_number ?? `Shipment #${item.id}`
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)
  const [fileFeedback, setFileFeedback] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  async function handleComplete() {
    setSubmitting(true)
    try {
      await workerPortalApi.complete(token, item.id, note.trim() || undefined)
      setDone(true)
      toast.success(`${label} marked done`)
      const card = cardRef.current
      if (card && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await card.animate(
          [{ height: `${card.offsetHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }],
          { delay: 120, duration: 180, easing: "ease-in", fill: "forwards" },
        ).finished.catch(() => {})
      }
      onCompleted()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark this shipment done.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFileChosen(file: File | undefined) {
    if (!file) return
    if (file.type !== "application/pdf") {
      setFileFeedback(`${file.name}: only PDF files are accepted.`)
      toast.error("Only PDF files can be attached.")
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileFeedback(`${file.name}: exceeds the 4 MB limit.`)
      toast.error(`File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB upload limit.`)
      return
    }
    setFileFeedback(`${file.name} · ${(file.size / 1024).toFixed(0)} KB · uploading`)
    setUploading(true)
    try {
      await workerPortalApi.uploadDocument(token, item.id, file)
      setFileFeedback(`${file.name} · ${(file.size / 1024).toFixed(0)} KB · attached`)
      toast.success("Document attached")
    } catch (err) {
      setFileFeedback(`${file.name}: upload failed.`)
      toast.error(err instanceof ApiError ? err.message : "Could not attach document.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div ref={cardRef} className="overflow-hidden">
    <Card className={done ? "border-status-success bg-status-success/10" : undefined}>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 break-words">
            <p className="font-heading text-base font-semibold tabular-nums text-foreground">{label}</p>
            <p className="text-sm text-muted-foreground">
              {item.customer_name} · {item.origin} → {item.destination}
            </p>
            <p className="text-sm text-muted-foreground">{item.cargo_type}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">Waiting {formatRelativeTime(item.waiting_since)}</span>
        </div>

        {item.last_note && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">"{item.last_note}"</p>
        )}

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          rows={2}
          disabled={submitting || done}
          aria-label={`Note for ${label}`}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => handleFileChosen(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            className="h-11 gap-1.5"
            disabled={uploading || submitting || done}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadSimple size={18} />
            {uploading ? "Uploading…" : "Attach PDF"}
          </Button>
          <Button onClick={handleComplete} disabled={submitting || uploading || done} className="h-[52px] w-full gap-1.5 sm:flex-1" size="lg">
            <CheckCircle size={18} weight="fill" />
            {done ? "Done — task completed" : submitting ? "Marking done…" : "Mark Done"}
          </Button>
        </div>
        {fileFeedback && <p className="text-xs text-muted-foreground" role="status">{fileFeedback}</p>}
        {done && <p role="status" className="text-sm font-medium text-status-success">{label} completed successfully.</p>}
      </CardContent>
    </Card>
    </div>
  )
}
