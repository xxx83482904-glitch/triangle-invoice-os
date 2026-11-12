"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeOwnPasswordAction } from "./actions";

export function OwnPasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPasswordAction, { error: "" });
  // A successful change clears the fields by remounting the form.
  return <form key={state.success ? "done" : "form"} action={action} className="max-w-md space-y-4">
    <label className="block space-y-1 text-sm"><span>今のパスワード</span><Input name="current" type="password" autoComplete="current-password" required disabled={pending} /></label>
    <label className="block space-y-1 text-sm"><span>新しいパスワード</span><Input name="next" type="password" autoComplete="new-password" minLength={8} maxLength={72} required disabled={pending} />
      <span className="block text-xs text-muted-foreground">8文字以上・72文字以内</span></label>
    <label className="block space-y-1 text-sm"><span>新しいパスワード（確認）</span><Input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required disabled={pending} /></label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="signOutOthers" defaultChecked disabled={pending} />ほかの端末（スマホなど）はログアウトする</label>
    <Button type="submit" disabled={pending}>{pending ? "変更中…" : "パスワードを変更"}</Button>
    {state.success ? <p role="status" className="flex items-center gap-1 text-sm text-muted-foreground"><Check className="size-4" />パスワードを変更しました。この端末はログインしたままです。</p> : null}
    {state.error ? <p role="alert" className="break-words text-sm text-destructive">{state.error}</p> : null}
  </form>;
}
