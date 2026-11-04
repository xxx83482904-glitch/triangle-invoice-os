"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { saveImportShipmentAction } from "@/app/imports/actions";
import { FilterPanel } from "@/components/app/filter-panel";
import { cardPressProps } from "@/components/app/list-selection";
import { MonthTabs } from "@/components/app/month-tabs";
import { OptionTabs } from "@/components/app/option-tabs";
import { RecordDetail } from "@/components/app/record-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { formatDate, yen } from "@/lib/format";
import type { ImportShipmentMutation, ImportShipmentView } from "@/lib/import-shipment-views";
import { importChecklistKinds, importDocumentKindLabels, importDocumentKinds, importShipmentStatusLabels, importShipmentStatuses, type ImportLinkedDocument } from "@/lib/import-shipments";
import { countByMonth } from "@/lib/month-tabs";
import { operationFailureToast } from "@/lib/operation-feedback";
import type { ImportDocumentKind, ImportShipmentStatus } from "@/lib/types";

type Option = { label: string; value: string };
type StatusFilter = "all" | ImportShipmentStatus | "missing";
type AmountKey = "goodsValue" | "dutyAmount" | "importTaxNational" | "importTaxLocal" | "brokerFee" | "otherCost";

const selectClass = "h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const statusFilterOptions = [["all", "すべて"], ["OPEN", "書類待ち"], ["CLEARED", "通関済み"], ["CLOSED", "完了"], ["missing", "書類不足"]] as const;
const statusTone: Record<ImportShipmentStatus, string> = {
  OPEN: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  CLEARED: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  CLOSED: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
};
const amountFields: Array<[AmountKey, string]> = [
  ["goodsValue", "課税価格（CIF）"], ["dutyAmount", "関税"], ["importTaxNational", "輸入消費税（国税）"],
  ["importTaxLocal", "地方消費税"], ["brokerFee", "通関手数料など"], ["otherCost", "その他の費用"],
];
const monthLabel = (month: string) => /^\d{4}-\d{2}$/.test(month) ? `${month.slice(0, 4)}年${Number(month.slice(5))}月` : "日付なし";

function shipmentFields(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const amounts: Partial<Record<AmountKey, number>> = {};
  for (const [key, label] of amountFields) {
    const raw = text(key).replace(/,/g, "");
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${label}は数字で入力してください`);
    amounts[key] = value;
  }
  return {
    title: text("title"), projectId: text("projectId"), supplierName: text("supplierName"), brokerVendorId: text("brokerVendorId"), permitNumber: text("permitNumber"),
    permitDate: text("permitDate"), arrivalDate: text("arrivalDate"), folderMonth: text("folderMonth"), status: text("status") as ImportShipmentStatus, memo: text("memo"), ...amounts,
  };
}

function useShipmentSave(company: CompanyScope) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (input: ImportShipmentMutation, done: string, after?: (result: { id: string }) => void) => start(async () => {
    const result = await saveImportShipmentAction(company, input);
    if (!result.success) { toast(operationFailureToast(result.error)); return; }
    toast({ title: done, variant: "success" });
    after?.(result);
    router.refresh();
  });
  return { pending, run };
}

export function ImportsWorkspace({ initialId, canEdit, company, rows, unassigned, projects, vendors }: {
  initialId?: string; canEdit: boolean; company: CompanyScope; rows: ImportShipmentView[]; unassigned: ImportLinkedDocument[]; projects: Option[]; vendors: Option[];
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(initialId ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(initialId));
  const [creating, setCreating] = useState(false);
  const months = useMemo(() => rows.map((row) => row.month), [rows]);
  const monthCounts = useMemo(() => countByMonth(months), [months]);
  const needle = query.trim().toLocaleLowerCase("ja-JP");
  const filtered = useMemo(() => rows.filter((row) => (!month || row.month === month)
    && (status === "all" || (status === "missing" ? row.missing.length > 0 : row.status === status))
    && (!needle || [row.title, row.supplierName, row.brokerName, row.projectName, row.permitNumber, row.memo].some((text) => (text ?? "").toLocaleLowerCase("ja-JP").includes(needle)))),
  [rows, month, status, needle]);
  const activeRow = rows.find((row) => row.id === activeId) ?? null;
  // Beside the list the pane shows the first item until one is pressed; over the list it waits for a press.
  const paneRow = creating ? null : activeRow ?? (wide ? filtered[0] ?? null : null);
  const index = filtered.findIndex((row) => row.id === paneRow?.id);
  const stepFrom = (delta: number) => { const target = filtered[index + delta]; return index >= 0 && target ? () => setActiveId(target.id) : undefined; };
  const open = (id: string) => { setCreating(false); setActiveId(id); setDetailOpen(true); };
  const startCreate = () => { setCreating(true); setDetailOpen(true); };
  const totals = useMemo(() => filtered.reduce((sum, row) => ({ duty: sum.duty + row.dutyAmount, tax: sum.tax + row.importTax, cost: sum.cost + row.costTotal, missing: sum.missing + (row.missing.length ? 1 : 0) }), { duty: 0, tax: 0, cost: 0, missing: 0 }), [filtered]);
  const filtering = status !== "all" || Boolean(query);

  return <div className="space-y-6">
    {unassigned.length ? <UnassignedDocuments company={company} canEdit={canEdit} documents={unassigned} shipments={rows} onCreate={startCreate} /> : null}
    <Card variant="section">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>輸入便一覧</CardTitle>
          {canEdit ? <Button type="button" size="sm" className="gap-1" onClick={startCreate}><Plus className="size-4" />新しい便</Button> : null}
        </div>
        <section aria-label="輸入の集計" className="grid grid-cols-3 gap-2 text-xs text-muted-foreground sm:gap-3 lg:max-w-2xl">
          <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>関税</div><div className="break-all font-mono text-sm font-semibold text-foreground">{yen.format(totals.duty)}</div><div className="mt-1 hidden sm:block">表示中{filtered.length}便</div></div>
          <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>輸入消費税</div><div className="break-all font-mono text-sm font-semibold text-foreground">{yen.format(totals.tax)}</div><div className="mt-1 hidden sm:block">国税と地方消費税の合計</div></div>
          <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2"><div>諸費用合計</div><div className="break-all font-mono text-sm font-semibold text-foreground">{yen.format(totals.cost)}</div><div className="mt-1 hidden sm:block">{totals.missing ? `書類不足 ${totals.missing}便` : "書類は揃っています"}</div></div>
        </section>
      </CardHeader>
      <CardContent>
        <div className="mb-3"><MonthTabs label="輸入月" value={month} months={months} counts={monthCounts} undatedLabel="日付なし" onChange={setMonth} /></div>
        <FilterPanel
          primary={<>
            <label className="filter-panel-search relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} placeholder="便名・仕入先・許可番号・案件を検索" className="h-11 pl-9 lg:h-9" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <OptionTabs label="輸入便の状態で絞り込み" value={status} options={statusFilterOptions} onChange={setStatus} />
          </>}
          activeCount={status !== "all" ? 1 : 0}
          onReset={filtering ? () => { setStatus("all"); setQuery(""); } : undefined}
        >
          <p className="text-xs text-muted-foreground">書類不足は、仕入先インボイス・パッキングリスト・AWB/B/L・輸入許可通知書・通関業者の請求書のどれかが付いていない便です。</p>
        </FilterPanel>

        <div className="mt-3 grid lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-w-0 overflow-x-auto border-b pb-3 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3">
            {filtered.length ? (
              <table className="record-cards record-cards-stack workspace-record-table w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">便名</th>
                    <th className="px-3 py-2 text-left">許可日</th>
                    <th className="px-3 py-2 text-right">輸入消費税</th>
                    <th className="px-3 py-2 text-right">諸費用合計</th>
                    <th className="px-3 py-2 text-left">書類</th>
                    <th className="px-3 py-2 text-left">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const active = row.id === paneRow?.id;
                    return <tr key={row.id} {...cardPressProps(() => open(row.id))} data-active={active ? "" : undefined}>
                      <td className="record-card-title min-w-0 max-w-[260px] px-3 py-2 font-medium">
                        <button type="button" data-selection-open className="record-card-open block max-w-full truncate text-left" title="開く">{row.title}</button>
                        <span className="block truncate text-xs font-normal text-muted-foreground">{[row.projectName || "案件未設定", row.supplierName].filter(Boolean).join(" / ")}</span>
                      </td>
                      <td data-label="許可日" data-card-sub="" className="whitespace-nowrap px-3 py-2">{row.permitDate ? formatDate(row.permitDate) : "未定"}</td>
                      <td data-label="輸入消費税" data-card-sub="" className="whitespace-nowrap px-3 py-2 text-right font-mono">{yen.format(row.importTax)}</td>
                      <td data-label="諸費用" data-card-end="" className="whitespace-nowrap px-3 py-2 text-right font-mono">{yen.format(row.costTotal)}</td>
                      <td data-label="書類" className="whitespace-nowrap px-3 py-2">
                        <span title={row.missing.map((kind) => importDocumentKindLabels[kind]).join("、")} className={row.missing.length ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>
                          {row.documents.length}件{row.missing.length ? ` / 不足${row.missing.length}` : " / 揃い"}
                        </span>
                      </td>
                      <td className="px-3 py-2"><Badge variant="outline" className={statusTone[row.status]}>{importShipmentStatusLabels[row.status]}</Badge></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 text-center">
                <div>
                  <div className="font-medium">{rows.length ? "条件に合う輸入便がありません" : "輸入便はまだありません"}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{rows.length ? "月や絞り込みを戻すと一覧に表示されます。" : "最初の便を作ると、関税・輸入消費税と書類をまとめられます。"}</p>
                </div>
                {rows.length ? <Button type="button" variant="outline" onClick={() => { setMonth(""); setStatus("all"); setQuery(""); }}>条件をリセット</Button>
                  : canEdit ? <Button type="button" className="gap-1" onClick={startCreate}><Plus className="size-4" />最初の便を作る</Button> : null}
              </div>
            )}
          </div>

          <RecordDetail wide={wide} open={detailOpen} title={creating ? "新しい便" : paneRow?.title} label="開いている輸入便" resetKey={creating ? "new" : paneRow?.id} className="min-w-0 bg-muted/20" onClose={() => { setDetailOpen(false); setCreating(false); }} onPrevious={creating ? undefined : stepFrom(-1)} onNext={creating ? undefined : stepFrom(1)}>
            {creating ? (
              <div className="p-4"><ShipmentForm key="new" company={company} projects={projects} vendors={vendors} onSaved={(id) => { setCreating(false); setActiveId(id); }} /></div>
            ) : paneRow ? (
              <ShipmentDetail key={`${paneRow.id}:${paneRow.updatedAt}`} canEdit={canEdit} company={company} row={paneRow} unassigned={unassigned} projects={projects} vendors={vendors} onDeleted={() => { setDetailOpen(false); setActiveId(""); }} />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">便を押すと詳細を表示します。</div>
            )}
          </RecordDetail>
        </div>
      </CardContent>
    </Card>
  </div>;
}

function DocumentLine({ document, canEdit, pending, onDetach }: { document: ImportLinkedDocument; canEdit: boolean; pending: boolean; onDetach: () => void }) {
  return <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <Link href={document.href} prefetch={false} className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-foreground hover:underline underline-offset-4"><span className="truncate">{document.title}</span><ExternalLink className="size-3 shrink-0" /></Link>
    <span className="text-muted-foreground">{document.party} / {formatDate(document.date)}{document.amount !== undefined ? ` / ${yen.format(document.amount)}` : ""}</span>
    {document.source === "received" ? <Badge variant="outline" className={document.paid ? "border-emerald-200 text-emerald-700 dark:text-emerald-300" : "border-amber-200 text-amber-800 dark:text-amber-300"}>{document.paid ? "支払済" : "未払い"}</Badge> : null}
    {canEdit ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={onDetach}>外す</Button> : null}
  </div>;
}

function ShipmentDetail({ canEdit, company, row, unassigned, projects, vendors, onDeleted }: {
  canEdit: boolean; company: CompanyScope; row: ImportShipmentView; unassigned: ImportLinkedDocument[]; projects: Option[]; vendors: Option[]; onDeleted: () => void;
}) {
  const { pending, run } = useShipmentSave(company);
  const others = row.documents.filter((document) => !importChecklistKinds.includes(document.kind));
  const detach = (document: ImportLinkedDocument) => run({ action: "assign", shipmentId: null, source: document.source, documentId: document.id }, "輸入便から外しました。");
  return <div className="space-y-5 p-4">
    <section aria-label="輸入便の費用" className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
      {([["関税", row.dutyAmount], ["輸入消費税", row.importTax], ["諸費用合計", row.costTotal], ["着地原価", row.landedCost]] as const).map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-lg border bg-background/60 px-3 py-2"><div>{label}</div><div className="break-all font-mono text-sm font-medium text-foreground">{yen.format(value)}</div></div>
      ))}
    </section>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Badge variant="outline" className={statusTone[row.status]}>{importShipmentStatusLabels[row.status]}</Badge>
      <span>{monthLabel(row.month)}</span>
      {row.projectName ? <span>{row.projectName}</span> : null}
      {row.brokerName ? <span>通関: {row.brokerName}</span> : null}
      {row.permitNumber ? <span className="font-mono">許可番号 {row.permitNumber}</span> : null}
      {row.unpaidCount ? <span className="text-amber-700 dark:text-amber-300">未払いの請求書 {row.unpaidCount}件</span> : null}
    </div>

    <section aria-label="書類の揃い" className="space-y-2">
      <h3 className="text-sm font-semibold">
        書類 {row.documents.length}件
        {row.missing.length ? <span className="ml-2 font-normal text-amber-700 dark:text-amber-300">不足 {row.missing.length}</span> : <span className="ml-2 font-normal text-emerald-700 dark:text-emerald-300">揃っています</span>}
      </h3>
      <ul className="space-y-2">
        {row.checklist.map((entry) => (
          <li key={entry.kind} className="rounded-lg border bg-background/60 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className={entry.documents.length ? "font-medium" : "text-muted-foreground"}>{entry.label}</span>
              {entry.documents.length ? null : <span className="text-xs text-amber-700 dark:text-amber-300">未添付</span>}
            </div>
            {entry.documents.map((document) => <DocumentLine key={document.key} document={document} canEdit={canEdit} pending={pending} onDetach={() => detach(document)} />)}
          </li>
        ))}
        {others.length ? <li className="rounded-lg border bg-background/60 px-3 py-2 text-sm">
          <div className="font-medium">その他の書類</div>
          {others.map((document) => <DocumentLine key={document.key} document={document} canEdit={canEdit} pending={pending} onDetach={() => detach(document)} />)}
        </li> : null}
      </ul>
      {canEdit ? <AttachForm company={company} shipmentId={row.id} candidates={unassigned} /> : null}
    </section>

    {canEdit ? <ShipmentForm key={row.updatedAt} company={company} row={row} projects={projects} vendors={vendors} /> : (
      row.memo ? <p className="whitespace-pre-wrap text-sm">{row.memo}</p> : null
    )}
    {canEdit ? <div className="border-t pt-3">
      <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive" disabled={pending} onClick={() => {
        if (window.confirm("この輸入便を削除しますか？付けていた書類は未割当に戻ります。")) run({ action: "delete", id: row.id, version: row.updatedAt }, "輸入便を削除しました。", onDeleted);
      }}><Trash2 className="size-4" />この便を削除</Button>
    </div> : null}
  </div>;
}

function AttachForm({ company, shipmentId, candidates }: { company: CompanyScope; shipmentId: string; candidates: ImportLinkedDocument[] }) {
  const { pending, run } = useShipmentSave(company);
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<ImportDocumentKind | "">("");
  const chosen = candidates.find((document) => document.key === key) ?? candidates[0];
  if (!chosen) return <p className="text-xs text-muted-foreground">追加できる未割当の書類はありません。郵便仕分けで分類を「輸入・通関」にするか、受領請求書を登録すると候補に出ます。</p>;
  const effectiveKind = kind || chosen.suggestedKind || chosen.kind;
  return <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
    <label className="min-w-0 flex-1 basis-48 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">書類を追加</span>
      <select value={chosen.key} className={`${selectClass} w-full`} onChange={(event) => { setKey(event.target.value); setKind(""); }}>
        {candidates.map((document) => <option key={document.key} value={document.key}>{document.title} / {document.party}</option>)}
      </select>
    </label>
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">種類</span>
      <select value={effectiveKind} className={`${selectClass} w-full`} onChange={(event) => setKind(event.target.value as ImportDocumentKind)}>
        {importDocumentKinds.map((value) => <option key={value} value={value}>{importDocumentKindLabels[value]}</option>)}
      </select>
    </label>
    <Button type="button" size="sm" disabled={pending} onClick={() => run({ action: "assign", shipmentId, source: chosen.source, documentId: chosen.id, kind: effectiveKind }, "輸入便に追加しました。")}>追加</Button>
  </div>;
}

function ShipmentForm({ company, row, projects, vendors, onSaved }: { company: CompanyScope; row?: ImportShipmentView; projects: Option[]; vendors: Option[]; onSaved?: (id: string) => void }) {
  const { pending, run } = useShipmentSave(company);
  const [status, setStatus] = useState<ImportShipmentStatus>(row?.status ?? "OPEN");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let fields: ReturnType<typeof shipmentFields>;
    try { fields = shipmentFields(new FormData(event.currentTarget)); } catch (error) { toast(operationFailureToast(error)); return; }
    if (row) run({ action: "update", id: row.id, version: row.updatedAt, ...fields }, "保存しました。");
    else run({ action: "create", ...fields }, "輸入便を作成しました。", (result) => onSaved?.(result.id));
  };
  const field = "text-xs font-medium text-muted-foreground";
  return <form onSubmit={submit} className="workspace-detail-group space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">{row ? "便の情報" : "新しい便"}</h3>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "保存中…" : row ? "保存" : "作成"}</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 sm:col-span-2"><span className={field}>便名</span><Input name="title" required maxLength={200} defaultValue={row?.title ?? ""} placeholder="例: 照明器具 第1便" /></label>
      <label className="space-y-1"><span className={field}>案件</span>
        <select name="projectId" defaultValue={row?.projectId ?? ""} className={`${selectClass} w-full`}><option value="">未設定</option>{projects.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      <label className="space-y-1"><span className={field}>通関業者（支払先）</span>
        <select name="brokerVendorId" defaultValue={row?.brokerVendorId ?? ""} className={`${selectClass} w-full`}><option value="">未設定</option>{vendors.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      <label className="space-y-1"><span className={field}>海外の仕入先</span><Input name="supplierName" maxLength={200} defaultValue={row?.supplierName ?? ""} /></label>
      <label className="space-y-1"><span className={field}>輸入許可番号</span><Input name="permitNumber" maxLength={100} defaultValue={row?.permitNumber ?? ""} className="font-mono" /></label>
      <label className="space-y-1"><span className={field}>輸入許可日</span><Input name="permitDate" type="date" defaultValue={row?.permitDate ?? ""} /></label>
      <label className="space-y-1"><span className={field}>到着日</span><Input name="arrivalDate" type="date" defaultValue={row?.arrivalDate ?? ""} /></label>
      <label className="space-y-1"><span className={field}>表示する月（空欄なら許可日の月）</span><Input name="folderMonth" type="month" defaultValue={row?.folderMonth ?? ""} /></label>
      <div className="space-y-1"><span className={field}>状態</span>
        <OptionTabs label="輸入便の状態" name="status" value={status} options={importShipmentStatuses.map((value) => [value, importShipmentStatusLabels[value]] as const)} onChange={setStatus} />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {amountFields.map(([key, label]) => (
        <label key={key} className="space-y-1"><span className={field}>{label}</span><Input name={key} type="number" inputMode="numeric" min="0" step="1" defaultValue={row?.[key] || ""} className="font-mono" /></label>
      ))}
    </div>
    <label className="block space-y-1"><span className={field}>メモ</span><Textarea name="memo" maxLength={2000} defaultValue={row?.memo ?? ""} className="min-h-20" /></label>
  </form>;
}

function UnassignedDocuments({ company, canEdit, documents, shipments, onCreate }: {
  company: CompanyScope; canEdit: boolean; documents: ImportLinkedDocument[]; shipments: ImportShipmentView[]; onCreate: () => void;
}) {
  const { pending, run } = useShipmentSave(company);
  const [expanded, setExpanded] = useState(false);
  const [choices, setChoices] = useState<Record<string, { shipmentId: string; kind: ImportDocumentKind }>>({});
  const choice = (document: ImportLinkedDocument) => choices[document.key] ?? { shipmentId: shipments[0]?.id ?? "", kind: document.suggestedKind ?? document.kind };
  return <Card variant="section">
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>未割当の輸入関係書類 <span className="font-normal text-muted-foreground">{documents.length}件</span></CardTitle>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="lg:hidden" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "閉じる" : "開く"}</Button>
          {canEdit ? <Button type="button" size="sm" variant="outline" className="gap-1" onClick={onCreate}><Plus className="size-4" />新しい便</Button> : null}
        </div>
      </div>
      <p className={`text-xs text-muted-foreground ${expanded ? "" : "hidden lg:block"}`}>郵便仕分けの分類「輸入・通関」と、関税・通関の語がある書類です。便を選んで追加すると、その便の書類として揃い具合に数えられます。</p>
    </CardHeader>
    <CardContent className={expanded ? "" : "hidden lg:block"}>
      <ul className="divide-y">
        {documents.map((document) => {
          const current = choice(document);
          return <li key={document.key} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={document.href} prefetch={false} className="truncate font-medium hover:underline underline-offset-4">{document.title}</Link>
                <Badge variant="secondary">{importDocumentKindLabels[document.suggestedKind ?? document.kind]}</Badge>
                <span className="text-xs text-muted-foreground">{document.source === "mail" ? "郵便物" : "受領請求書"}</span>
              </div>
              <div className="text-xs text-muted-foreground">{document.party} / {formatDate(document.date)}{document.amount !== undefined ? ` / ${yen.format(document.amount)}` : ""}{document.evidence ? ` / 検出語: ${document.evidence}` : ""}</div>
            </div>
            {canEdit ? <div className="flex flex-wrap items-center gap-2">
              <select aria-label="追加する便" value={current.shipmentId} className={`${selectClass} max-w-56`} onChange={(event) => setChoices({ ...choices, [document.key]: { ...current, shipmentId: event.target.value } })}>
                {shipments.length ? null : <option value="">便がありません</option>}
                {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.title}（{monthLabel(shipment.month)}）</option>)}
              </select>
              <select aria-label="書類の種類" value={current.kind} className={selectClass} onChange={(event) => setChoices({ ...choices, [document.key]: { ...current, kind: event.target.value as ImportDocumentKind } })}>
                {importDocumentKinds.map((value) => <option key={value} value={value}>{importDocumentKindLabels[value]}</option>)}
              </select>
              <Button type="button" size="sm" disabled={pending || !current.shipmentId} onClick={() => run({ action: "assign", shipmentId: current.shipmentId, source: document.source, documentId: document.id, kind: current.kind }, "輸入便に追加しました。")}>追加</Button>
            </div> : null}
          </li>;
        })}
      </ul>
    </CardContent>
  </Card>;
}
