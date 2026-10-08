"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reviewRegistrationAction } from "./actions";

export function ApprovalForm({ id, updatedAt, roles }: { id: string; updatedAt: string; roles: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(reviewRegistrationAction, { error: "" });
  return <form action={action} className="min-w-0 space-y-2">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="updatedAt" value={updatedAt} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid min-w-0 flex-1 gap-1 text-xs">承認後の権限
        <select name="role" defaultValue="MAIL_EDITOR" disabled={pending} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm" aria-label="承認後の権限">
          {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
      </label>
      <Button name="decision" value="APPROVE" disabled={pending} className="h-11"><Check className="size-4" />承認</Button>
      <Button name="decision" value="REJECT" disabled={pending} variant="outline" className="h-11"><X className="size-4" />却下</Button>
    </div>
    {state.error ? <p role="alert" className="break-words text-sm text-destructive">{state.error}</p> : null}
  </form>;
}
