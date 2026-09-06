import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { useOpsAuth } from "@/hooks/useOpsAuth"
import { ApiError } from "@/lib/api/client"

export function OpsLoginPage() {
  const { opsUser, loading, login } = useOpsAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && opsUser) return <Navigate to="/shipments" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      navigate("/shipments")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <div className="mb-6 flex flex-col items-center text-center">
            <img src="/raaziq-logo.png" alt="Raaziq" width={161} height={133} className="mb-3 h-18 w-auto rounded-lg bg-white p-1" />
            <h1 className="font-heading text-lg font-semibold text-foreground">Ops Sign In</h1>
            <p className="mt-1 text-sm text-muted-foreground">Internal access for Raaziq operations staff.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting || !username || !password}>
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
