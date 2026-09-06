import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function ConfirmDialog({ open, onOpenChange, title, description, pending, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string;
  pending: boolean; onConfirm: () => void
}) {
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
    <DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)} autoFocus>Cancel</Button><Button variant="destructive" disabled={pending} onClick={onConfirm}>{pending ? "Deleting…" : "Delete"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
