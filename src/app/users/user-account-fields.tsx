"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { effectiveFeatures, memberFeatures } from "@/lib/member-features";
import type { UserRole } from "@/lib/types";
import type { UserAccountStatus, UserAccountView } from "@/lib/user-admin";

export type AccountRoleOption = { value: UserRole; label: string };

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

export function UserAccountFields({ user, roles, pending, isSelf = false }: {
  user?: UserAccountView; roles: AccountRoleOption[]; pending: boolean; isSelf?: boolean;
}) {
  const fieldId = useId();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [role, setRole] = useState<UserRole>(user?.role ?? "MAIL_EDITOR");
  const [features, setFeatures] = useState(() => effectiveFeatures(role, user?.featureAccess));
  const [roleReset, setRoleReset] = useState(false);
  const [status, setStatus] = useState<UserAccountStatus>(user?.status ?? "ACTIVE");
  const defaults = effectiveFeatures(role);
  const customized = memberFeatures.some(({ key }) => features[key] !== defaults[key]);
  const statusOptions: Array<readonly [UserAccountStatus, string]> = [["ACTIVE", "利用中"], ["DISABLED", "停止"]];
  if (user?.status === "REJECTED") statusOptions.push(["REJECTED", "申請却下（現在）"]);

  return <>
    <label className="grid min-w-0 gap-1 text-sm">名前
      <Input name="name" autoComplete="off" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={pending} className="h-11 lg:h-9" />
    </label>
    <label className="grid min-w-0 gap-1 text-sm">メールアドレス（ログインに使います）
      <Input name="email" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} className="h-11 lg:h-9" />
    </label>
    <div className="min-w-0 space-y-2">
      <label htmlFor={`${fieldId}-password`} className="grid min-w-0 gap-1 text-sm">{user ? "新しいパスワード" : "初期パスワード"}
        <Input id={`${fieldId}-password`} name="password" type={visible ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false}
          required={!user} placeholder={user ? "変更しないときは空のまま" : undefined} minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending}
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
      <p id={`${fieldId}-password-help`} className="text-xs leading-relaxed text-muted-foreground">{user
        ? <>保存すると、この人はすべての端末からログアウトし、新しいパスワードでログインし直します。{isSelf ? "自分のパスワードを変更する場合、この端末はログインしたままです。" : null}</>
        : "この人に伝えてください。あとで管理者が変更できます。"}
      </p>
    </div>
    <div className="min-w-0 space-y-2">
      <label className="grid min-w-0 gap-1 text-sm">権限
        <select name={isSelf ? undefined : "role"} value={role} onChange={(event) => {
          const nextRole = event.target.value as UserRole;
          setRole(nextRole); setFeatures(effectiveFeatures(nextRole)); setRoleReset(true);
        }} disabled={pending || isSelf} aria-describedby={`${fieldId}-features-help${isSelf ? ` ${fieldId}-self-help` : ""}`}
          className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50 lg:h-9">
          {roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {isSelf ? <input type="hidden" name="role" value={role} /> : null}
      <div aria-live="polite">{roleReset ? <p className="text-xs leading-relaxed text-muted-foreground">権限を変えたので、使える機能をこの権限の標準に戻しました</p> : null}</div>
    </div>
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">使える機能</legend>
      {memberFeatures.map(({ key }) => <input key={key} type="hidden" name={`feature:${key}`} value={features[key] ? "on" : "off"} />)}
      {role === "GUEST" ? <p id={`${fieldId}-features-help`} className="text-xs leading-relaxed text-muted-foreground">ゲストは請求書作成専用のため、機能を切り替えられません。</p> : <>
        <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {memberFeatures.map(({ key, label }) => <button key={key} type="button" role="switch" aria-checked={features[key]} aria-label={label}
            aria-describedby={`${fieldId}-features-help${isSelf ? ` ${fieldId}-self-help` : ""}`} disabled={pending || isSelf}
            onClick={() => setFeatures((current) => ({ ...current, [key]: !current[key] }))}
            className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md px-1 text-left text-sm font-normal hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-9">
            <span className="min-w-0 break-words">{label}{features[key] !== defaults[key] ? <span className="ml-2 inline-block text-xs text-muted-foreground">個別</span> : null}</span>
            <span aria-hidden="true" className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${features[key] ? "bg-primary" : "bg-segmented-control-background"}`}>
              <span className={`size-4 rounded-full shadow-2xs transition-transform ${features[key] ? "translate-x-4 bg-primary-foreground" : "translate-x-0 bg-segmented-control-selected-background"}`} />
            </span>
          </button>)}
        </div>
        {customized ? <Button type="button" variant="link" disabled={pending || isSelf} className="h-11 max-w-full whitespace-normal px-0 text-xs font-normal lg:h-9"
          onClick={() => { setFeatures(defaults); setRoleReset(false); }}>この権限の標準に戻す</Button> : null}
        <p id={`${fieldId}-features-help`} className="text-xs leading-relaxed text-muted-foreground">権限の標準から、この人だけ機能を増やしたり減らしたりできます。見られる範囲（全件か担当分だけか）と利用者管理は権限で決まります。</p>
        <div aria-live="polite">{!Object.values(features).some(Boolean) ? <p className="text-xs leading-relaxed text-muted-foreground">すべてオフにすると、この人はログインしても使える画面がありません。</p> : null}</div>
      </>}
    </fieldset>
    {user ? <div className="min-w-0 space-y-2">
      <p className="text-sm">利用状態</p>
      <OptionTabs name="status" label="利用状態" value={status} options={statusOptions} disabled={pending || isSelf} onChange={setStatus} />
      {status === "DISABLED" ? <p className="text-xs leading-relaxed text-muted-foreground">停止するとログインできなくなり、ログイン中の端末もすぐに使えなくなります。</p> : null}
      {isSelf ? <p id={`${fieldId}-self-help`} className="text-xs leading-relaxed text-muted-foreground">自分の権限と利用状態は、ほかの管理者が変更します</p> : null}
    </div> : null}
  </>;
}
