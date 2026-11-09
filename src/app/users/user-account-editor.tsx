"use client";

import { useActionState, useId, useRef, useState, type RefObject } from "react";
import { Eye, EyeOff, KeyRound, LogOut, Pencil } from "lucide-react";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { navigationGroups } from "@/lib/app-navigation";
import type { UserRole } from "@/lib/types";
import type { UserAccountStatus, UserAccountView } from "@/lib/user-admin";
import { endUserSessionsAction, updateUserAccountAction } from "./actions";

type EditorProps = { user: UserAccountView; actorId: string; roles: Array<{ value: UserRole; label: string }> };
type ActionState = { error: string; success?: boolean };

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let password = "";
  while (password.length < 14) {
    for (const value of globalThis.crypto.getRandomValues(new Uint8Array(14))) {
      if (value >= limit) continue;
      password += alphabet[value % alphabet.length];
      if (password.length === 14) break;
    }
  }
  return password;
}

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
  const fieldId = useId();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState<UserAccountStatus>(user.status);
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
  const screens = navigationGroups(role).flatMap((group) => group.items.map((item) => item.label));
  const statusOptions: Array<readonly [UserAccountStatus, string]> = [["ACTIVE", "利用中"], ["DISABLED", "停止"]];
  if (user.status === "REJECTED") statusOptions.push(["REJECTED", "申請却下（現在）"]);
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
        <label className="grid min-w-0 gap-1 text-sm">名前
          <Input name="name" autoComplete="off" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={pending} className="h-11 lg:h-9" />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">メールアドレス（ログインに使います）
          <Input name="email" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} className="h-11 lg:h-9" />
        </label>
        <div className="min-w-0 space-y-2">
          <label htmlFor={`${fieldId}-password`} className="grid min-w-0 gap-1 text-sm">新しいパスワード
            <Input id={`${fieldId}-password`} name="password" type={visible ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false}
              placeholder="変更しないときは空のまま" minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending}
              aria-describedby={`${fieldId}-password-help`} className="h-11 lg:h-9" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-11 lg:h-9" aria-controls={`${fieldId}-password`} aria-pressed={visible} disabled={pending} onClick={() => setVisible(!visible)}>
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{visible ? "隠す" : "表示"}
            </Button>
            <Button type="button" variant="outline" className="h-11 lg:h-9" disabled={pending} onClick={() => { setPassword(randomPassword()); setVisible(true); }}>
              <KeyRound className="size-4" />作成
            </Button>
          </div>
          <p id={`${fieldId}-password-help`} className="text-xs leading-relaxed text-muted-foreground">保存すると、この人はすべての端末からログアウトし、新しいパスワードでログインし直します。
            {isSelf ? "自分のパスワードを変更する場合、この端末はログインしたままです。" : null}
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          <label className="grid min-w-0 gap-1 text-sm">権限
            <select name={isSelf ? undefined : "role"} value={role} onChange={(event) => setRole(event.target.value as UserRole)} disabled={pending || isSelf}
              aria-describedby={`${fieldId}-screens${isSelf ? ` ${fieldId}-self-help` : ""}`} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50 lg:h-9">
              {roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {isSelf ? <input type="hidden" name="role" value={role} /> : null}
          <div id={`${fieldId}-screens`} className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
            <p className="font-medium">この権限で使える画面</p>
            <p className="break-words leading-relaxed">{screens.join("・") || "ゲスト用の請求書作成画面"}</p>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm">利用状態</p>
          <OptionTabs name="status" label="利用状態" value={status} options={statusOptions} disabled={pending || isSelf} onChange={setStatus} />
          {status === "DISABLED" ? <p className="text-xs leading-relaxed text-muted-foreground">停止するとログインできなくなり、ログイン中の端末もすぐに使えなくなります。</p> : null}
          {isSelf ? <p id={`${fieldId}-self-help`} className="text-xs leading-relaxed text-muted-foreground">自分の権限と利用状態は、ほかの管理者が変更します</p> : null}
        </div>
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
