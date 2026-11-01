"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePayrollSettingsAction } from "@/app/banking/payroll/actions";
import { Button } from "@/components/ui/button";
import type { CompanyScope } from "@/lib/company";
import type { PayrollSettingsInput, PayrollSettingsView } from "@/lib/payroll-settings";

export function PayrollTargetSettings({ company, settings, onSaved }: { company: CompanyScope; settings: PayrollSettingsView; onSaved: (message: string) => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState(settings.categoryIds), [pending, setPending] = useState(false), [error, setError] = useState("");
  const save = async (input: PayrollSettingsInput) => {
    setPending(true); setError("");
    try {
      const result = await savePayrollSettingsAction(company, input);
      if (!result.success) { setError(result.error); return; }
      onSaved(input.mode === "DEFAULT" ? "対象科目を初期対象に戻しました" : `対象科目を保存しました（${input.categoryIds.length}科目）`);
      router.refresh();
    } catch { setError("保存できませんでした。選択を保持しています。再度お試しください"); }
    finally { setPending(false); }
  };
  return <form className="min-w-0 space-y-3" onSubmit={(event) => { event.preventDefault(); void save({ mode: "CUSTOM", categoryIds: selected, updatedAt: settings.updatedAt }); }}>
    <p className="text-xs text-muted-foreground">会社全体の設定です。チェックの変更は「対象科目を保存」で反映します。初期対象は給与・給料・賞与・役員報酬・退職金・通勤手当です。</p>
    <p className="text-sm">選択中 {selected.length}科目{!selected.length ? "（保存すると集計対象なしになります）" : ""}</p>
    {settings.missingCategoryIds.length ? <p className="text-sm text-amber-800 dark:text-amber-200">削除などで使えない設定が{settings.missingCategoryIds.length}件あります。集計に含めず、次に保存すると設定から外します。</p> : null}
    <fieldset disabled={pending} className="grid max-h-72 min-w-0 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-3"><legend className="px-1 text-sm">集計する科目</legend>
      {settings.options.map((option) => <label key={option.id} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-md p-1 text-sm hover:bg-muted">
        <input type="checkbox" name="categoryIds" value={option.id} className="mt-1 size-4 shrink-0 accent-primary" checked={selected.includes(option.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} />
        <span className="min-w-0 break-words">{option.name}{option.office ? <span className="block break-all text-xs text-muted-foreground">事業者: {option.office}</span> : null}{!option.available ? <span className="block text-xs text-muted-foreground">使用停止（過去分の集計可）</span> : null}</span>
      </label>)}
      {!settings.options.length ? <p className="text-sm text-muted-foreground">選択できる科目がありません。</p> : null}
    </fieldset>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "保存中…" : "対象科目を保存"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => void save({ mode: "DEFAULT", updatedAt: settings.updatedAt })}>初期対象に戻す</Button></div>
    {error ? <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => router.refresh()}>設定を再読込</Button></div> : null}
  </form>;
}
