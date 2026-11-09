"use client";

import { useActionState, useRef, useState, type RefObject } from "react";
import { LogOut, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { UserAccountView } from "@/lib/user-admin";
import { endUserSessionsAction, updateUserAccountAction } from "./actions";
import { UserAccountFields, type AccountRoleOption } from "./user-account-fields";

type EditorProps = { user: UserAccountView; actorId: string; roles: AccountRoleOption[] };
type ActionState = { error: string; success?: boolean };

export function UserAccountEditor(props: EditorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={triggerRef} type="button" variant="outline" className="h-11 lg:h-9" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <Pencil className="size-4" />編集
    </Button>
    {open ? <UserAccountDialog {...props} triggerRef={triggerRef} onClose={() => setOpen(false)} /> : null}
  </>;
}

function UserAccountDialog({ user: initialUser, actorId, roles, triggerRef, onClose }: EditorProps & {
  triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  // Keep the version that was opened, even if another action refreshes the page while editing.
  const [user] = useState(initialUser);
  const isSelf = user.id === actorId;
  const [state, save, saving] = useActionState(async (previous: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      const result = await updateUserAccountAction(previous, formData);
      if (result.success) {
        toast({ title: "保存しました", variant: "success" });
        onClose();
      }
      return result;
    } catch {
      return { error: "保存できませんでした。通信を確認して、もう一度お試しください。" };
    }
  }, { error: "" });
  const [endState, endSessions, ending] = useActionState(async (previous: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      const result = await endUserSessionsAction(previous, formData);
      if (result.success) {
        toast({ title: isSelf ? "ほかの端末からログアウトしました" : "すべての端末からログアウトしました", variant: "success" });
        onClose();
      }
      return result;
    } catch {
      return { error: "ログアウトできませんでした。通信を確認して、もう一度お試しください。" };
    }
  }, { error: "" });
  const pending = saving || ending;
  const logoutHelp = isSelf
    ? "ほかの端末をすべてログアウトします。この端末はログインしたままです。パスワードは変わりません。"
    : "この人がログイン中の端末をすべてログアウトします。パスワードは変わりません。";

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[85dvh] min-w-0 overflow-y-auto font-normal sm:max-w-xl" showCloseButton={!pending}
      onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
      <DialogHeader className="min-w-0 pr-10">
        <DialogTitle className="break-words leading-relaxed [overflow-wrap:anywhere]">{user.name} の編集</DialogTitle>
        <DialogDescription>ログイン情報と権限、利用状態を変更します。</DialogDescription>
      </DialogHeader>
      <form action={save} className="min-w-0 space-y-4" aria-busy={saving}>
        <input type="hidden" name="id" value={user.id} />
        <input type="hidden" name="updatedAt" value={user.updatedAt} />
        <UserAccountFields user={user} roles={roles} pending={pending} isSelf={isSelf} />
        {state.error ? <p role="alert" className="break-words text-sm text-destructive">{state.error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} className="h-11 lg:h-9" onClick={onClose}>キャンセル</Button>
          <Button type="submit" disabled={pending} className="h-11 lg:h-9">{saving ? "保存中…" : "保存"}</Button>
        </div>
      </form>
      <form action={endSessions} className="min-w-0 space-y-2 border-t pt-4" aria-busy={ending}
        onSubmit={(event) => { if (!window.confirm(`${logoutHelp}\n編集内容は保存されません。実行しますか？`)) event.preventDefault(); }}>
        <input type="hidden" name="id" value={user.id} />
        <input type="hidden" name="updatedAt" value={user.updatedAt} />
        <Button type="submit" variant="outline" disabled={pending} className="h-11 max-w-full whitespace-normal lg:h-9"><LogOut className="size-4" />{ending ? "ログアウト中…" : "すべての端末からログアウト"}</Button>
        <p className="text-xs leading-relaxed text-muted-foreground">{logoutHelp}</p>
        {endState.error ? <p role="alert" className="break-words text-sm text-destructive">{endState.error}</p> : null}
      </form>
    </DialogContent>
  </Dialog>;
}
