"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, ChevronDown, ChevronRight, ImagePlus, List, Loader2, Share, Smartphone, Sparkles, Trash2, X } from "lucide-react";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ReceiptField, ReceiptReading } from "@/lib/expense-receipt-reading";
import { expenseStatusLabels } from "@/lib/expense-claims";
import { formatDate } from "@/lib/format";
import { prepareReceiptFile } from "@/lib/receipt-image";
import type { ExpenseClaimStatus, ExpensePaidWith } from "@/lib/types";

type Option = { value: string; label: string };
type Claim = { id: string; spentOn: string; payee: string; purpose: string; amount: number; status: ExpenseClaimStatus; reviewNote: string; paidAt: string };
type Fields = { amount: string; spentOn: string; payee: string; purpose: string; categoryId: string; projectId: string; paidWith: ExpensePaidWith;
  registrationNumber: string; tax10: string; tax8: string; memo: string };
type FieldKey = keyof Fields;
type Item = { key: string; file: File; preview: string; name: string; state: "preparing" | "reading" | "ready" | "sending";
  fields: Fields; auto: Partial<Record<FieldKey, "ai" | "ocr" | "history">>; touched: Partial<Record<FieldKey, true>>;
  ocrText: string; warnings: string[]; error: string; open: boolean; details: boolean };

const STORAGE_PAID_WITH = "triangle:expense-capture:paid-with";
const STORAGE_INSTALL = "triangle:expense-capture:install-hint";
const selectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const inputClass = "h-12 text-base";
const statusTone: Record<ExpenseClaimStatus, string> = {
  SUBMITTED: "text-amber-700 dark:text-amber-300", RETURNED: "text-rose-700 dark:text-rose-300", APPROVED: "text-sky-700 dark:text-sky-300",
  PAID: "text-emerald-700 dark:text-emerald-300", WITHDRAWN: "text-muted-foreground",
};
const sourceLabel = { ai: "AIで読み取り", ocr: "読み取り", history: "前回の内容" } as const;
const fieldOf: Partial<Record<ReceiptField, FieldKey>> = { spentOn: "spentOn", amount: "amount", payee: "payee", purpose: "purpose", categoryId: "categoryId", paidWith: "paidWith", registrationNumber: "registrationNumber" };

function stored(key: string) { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } }
function store(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } }

function problems(fields: Fields, today: string) {
  const list: string[] = [], amount = Number(fields.amount.replaceAll(",", ""));
  if (!fields.amount || !Number.isSafeInteger(amount) || amount <= 0) list.push("金額");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.spentOn) || fields.spentOn > today) list.push("支払日");
  if (!fields.payee.trim()) list.push("支払先");
  if (!fields.purpose.trim()) list.push("用途");
  return list;
}

export function CaptureApp({ name, company, today, categories, projects, recentProjectIds, claims, returnedCount, summary }: {
  name: string; company: CompanyScope; today: string; categories: Option[]; projects: Option[]; recentProjectIds: string[]; claims: Claim[]; returnedCount: number;
  summary: { submittedAmount: number; submittedCount: number; approvedAmount: number; approvedCount: number };
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const reading = useRef(new Set<string>());
  const [bulk, setBulk] = useState(false);
  const camera = useRef<HTMLInputElement>(null), library = useRef<HTMLInputElement>(null);

  const update = useCallback((key: string, change: (item: Item) => Item) => setItems((rows) => rows.map((row) => row.key === key ? change(row) : row)), []);

  // Read at most two receipts at a time so a batch of photos doesn't stall the phone or the server.
  useEffect(() => {
    const waiting = items.filter((row) => row.state === "reading" && !reading.current.has(row.key));
    for (const item of waiting.slice(0, Math.max(0, 2 - reading.current.size))) {
      reading.current.add(item.key);
      const data = new FormData(); data.set("company", company); data.set("file", item.file);
      void fetch("/api/uploads/expenses/ocr", { method: "POST", body: data, signal: AbortSignal.timeout(100_000) })
        .then(async (response) => {
          const body = await response.json() as Partial<ReceiptReading> & { error?: string };
          if (!response.ok) throw new Error(body.error || "読み取れませんでした");
          return body;
        })
        .then((body) => update(item.key, (row) => {
          const fields = { ...row.fields }, auto: Item["auto"] = {};
          const fill = (key: FieldKey, value: string | undefined, source?: "ai" | "ocr" | "history") => {
            if (!value || row.touched[key]) return;
            fields[key] = value as never; if (source) auto[key] = source;
          };
          for (const [field, key] of Object.entries(fieldOf) as Array<[ReceiptField, FieldKey]>) {
            const raw = body[field as keyof ReceiptReading];
            fill(key, typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : undefined, body.sources?.[field]);
          }
          if (body.taxBreakdown?.rate10) fill("tax10", String(body.taxBreakdown.rate10), "ai");
          if (body.taxBreakdown?.rate8) fill("tax8", String(body.taxBreakdown.rate8), "ai");
          return { ...row, state: "ready", fields, auto, ocrText: body.ocrText || "", warnings: body.warnings || [] };
        }))
        .catch(() => update(item.key, (row) => ({ ...row, state: "ready", warnings: ["自動で読み取れませんでした。領収書を見ながら入力してください。"] })))
        .finally(() => { reading.current.delete(item.key); setItems((rows) => [...rows]); });
    }
  }, [items, company, update]);

  useEffect(() => () => { for (const row of itemsRef.current) URL.revokeObjectURL(row.preview); }, []);

  useEffect(() => {
    if (!items.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [items.length]);

  const add = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const paidWith = (["CASH", "PERSONAL_CARD", "OTHER"].includes(stored(STORAGE_PAID_WITH)) ? stored(STORAGE_PAID_WITH) : "CASH") as ExpensePaidWith;
    const fresh = files.map((file): Item => ({ key: crypto.randomUUID(), file, preview: file.type === "application/pdf" ? "" : URL.createObjectURL(file), name: file.name, state: "preparing",
      fields: { amount: "", spentOn: "", payee: "", purpose: "", categoryId: "", projectId: "", paidWith, registrationNumber: "", tax10: "", tax8: "", memo: "" },
      auto: {}, touched: {}, ocrText: "", warnings: [], error: "", open: false, details: false }));
    setItems((rows) => [...fresh.map((row, index) => ({ ...row, open: index === 0 })), ...rows.map((row) => ({ ...row, open: false }))]);
    for (const item of fresh) {
      try {
        const file = await prepareReceiptFile(item.file);
        update(item.key, (row) => ({ ...row, file, state: "reading" }));
      } catch (error) {
        update(item.key, (row) => ({ ...row, state: "ready", error: error instanceof Error ? error.message : "読み込めませんでした" }));
      }
    }
  };

  const remove = (key: string) => setItems((rows) => {
    const row = rows.find((item) => item.key === key);
    if (row?.preview) URL.revokeObjectURL(row.preview);
    const rest = rows.filter((item) => item.key !== key);
    // Keep the flow moving: when the open receipt goes, the next one opens.
    return row?.open && rest.length && !rest.some((item) => item.open) ? rest.map((item, index) => index === 0 ? { ...item, open: true } : item) : rest;
  });

  const send = async (item: Item) => {
    const missing = problems(item.fields, today);
    if (missing.length) { update(item.key, (row) => ({ ...row, open: true, error: `${missing.join("・")}を確認してください` })); return false; }
    update(item.key, (row) => ({ ...row, state: "sending", error: "" }));
    const data = new FormData();
    data.set("company", company); data.set("file", item.file); data.set("ocrText", item.ocrText);
    for (const [key, value] of Object.entries(item.fields)) data.set(key, key === "amount" ? value.replaceAll(",", "") : value);
    try {
      const response = await fetch("/api/uploads/expenses", { method: "POST", body: data });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error || "申請できませんでした");
      store(STORAGE_PAID_WITH, item.fields.paidWith);
      remove(item.key);
      return true;
    } catch (error) {
      update(item.key, (row) => ({ ...row, state: "ready", open: true, error: error instanceof Error ? error.message : "申請できませんでした" }));
      return false;
    }
  };

  const sendOne = async (item: Item) => {
    if (await send(item)) { toast({ title: `${item.fields.payee} の領収書を申請しました。`, variant: "success" }); router.refresh(); }
  };
  const ready = items.filter((row) => row.state === "ready" && !problems(row.fields, today).length);
  const sendAll = async () => {
    if (bulk) return;
    setBulk(true);
    let sent = 0;
    for (const item of ready) if (await send(item)) sent++;
    setBulk(false);
    if (sent) { toast({ title: `${sent}件の領収書を申請しました。`, variant: "success" }); router.refresh(); }
  };

  const projectOptions = useMemo(() => {
    const recent = recentProjectIds.map((id) => projects.find((row) => row.value === id)).filter(Boolean) as Option[];
    return { recent, rest: projects.filter((row) => !recentProjectIds.includes(row.value)) };
  }, [projects, recentProjectIds]);
  const busyCount = items.filter((row) => row.state !== "ready").length;

  return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background pb-[calc(env(safe-area-inset-bottom)+7rem)]">
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-background/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
      <div className="min-w-0"><h1 className="text-base font-semibold">経費精算</h1><p className="truncate text-xs text-muted-foreground">{name}</p></div>
      <Button asChild variant="ghost" className="min-h-11"><Link href="/expenses?view=mine"><List className="size-4" />一覧</Link></Button>
    </header>

    <section aria-label="自分の精算状況" className="grid grid-cols-3 gap-2 px-4 pt-4 text-xs text-muted-foreground">
      <div className="rounded-xl border bg-muted/20 p-3"><p>申請中</p><p className="mt-1 text-base font-semibold text-foreground"><Money value={summary.submittedAmount} /></p><p>{summary.submittedCount}件</p></div>
      <div className="rounded-xl border bg-muted/20 p-3"><p>振込待ち</p><p className="mt-1 text-base font-semibold text-foreground"><Money value={summary.approvedAmount} /></p><p>承認済み {summary.approvedCount}件</p></div>
      <a href="#recent" className={`rounded-xl border p-3 ${returnedCount ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" : "bg-muted/20"}`}><p>差戻し</p><p className={`mt-1 text-base font-semibold ${returnedCount ? "" : "text-foreground"}`}>{returnedCount}件</p><p>{returnedCount ? "直して再提出" : "なし"}</p></a>
    </section>

    <InstallHint />

    <section aria-label="領収書を追加" className="space-y-2 px-4 pt-4">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { void add(event.target.files); event.target.value = ""; }} />
      <input ref={library} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { void add(event.target.files); event.target.value = ""; }} />
      <Button type="button" className="h-16 w-full rounded-2xl text-base" onClick={() => camera.current?.click()}><Camera className="size-6" />領収書を撮影</Button>
      <Button type="button" variant="outline" className="h-12 w-full rounded-2xl" onClick={() => library.current?.click()}><ImagePlus className="size-5" />写真・PDFから選ぶ（複数可）</Button>
      {!items.length ? <p className="pt-1 text-center text-xs text-muted-foreground">撮ると日付・金額・支払先・用途を自動で読み取ります。確認して「申請」を押すだけです。</p> : null}
    </section>

    {items.length ? <section aria-label="申請前の領収書" className="space-y-3 px-4 pt-5">
      <h2 className="text-sm font-medium">確認して申請 <span className="font-normal text-muted-foreground">{items.length}件{busyCount ? `・読み取り中 ${busyCount}件` : ""}</span></h2>
      {items.map((item) => <ReceiptCard key={item.key} item={item} today={today} categories={categories} projects={projectOptions} disabled={bulk}
        onToggle={() => update(item.key, (row) => ({ ...row, open: !row.open }))}
        onDetails={() => update(item.key, (row) => ({ ...row, details: !row.details }))}
        onChange={(key, value) => update(item.key, (row) => ({ ...row, fields: { ...row.fields, [key]: value }, touched: { ...row.touched, [key]: true }, auto: { ...row.auto, [key]: undefined }, error: "" }))}
        onSend={() => void sendOne(item)} onRemove={() => remove(item.key)} />)}
    </section> : null}

    <section id="recent" aria-label="最近の申請" className="space-y-2 px-4 pt-6">
      <div className="flex items-center justify-between"><h2 className="text-sm font-medium">最近の申請</h2><Link href="/expenses?view=mine" className="text-xs text-muted-foreground underline underline-offset-4">すべて見る</Link></div>
      {claims.length ? <ul className="divide-y rounded-xl border">{claims.map((claim) => <li key={claim.id}>
        <Link href={`/expenses?${new URLSearchParams({ view: "mine", claim: claim.id })}`} className="flex min-h-14 items-center gap-3 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{claim.payee}</p><p className="truncate text-xs text-muted-foreground">{formatDate(claim.spentOn)}・{claim.purpose}</p>
            {claim.status === "RETURNED" && claim.reviewNote ? <p className="mt-1 line-clamp-2 text-xs text-rose-700 dark:text-rose-300">差戻し理由：{claim.reviewNote}</p> : null}</div>
          <div className="text-right"><Money value={claim.amount} className="font-medium" /><p className={`text-xs ${statusTone[claim.status]}`}>{claim.status === "PAID" && claim.paidAt ? `${formatDate(claim.paidAt)} 振込` : expenseStatusLabels[claim.status]}</p></div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link></li>)}</ul> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">まだ申請はありません。</p>}
    </section>

    {items.length ? <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center gap-2">
        <Button type="button" variant="outline" className="h-12 rounded-xl" aria-label="続けて撮影" onClick={() => camera.current?.click()}><Camera className="size-5" /></Button>
        <Button type="button" className="h-12 flex-1 rounded-xl text-base" disabled={!ready.length || bulk} onClick={() => void sendAll()}>
          {bulk ? <><Loader2 className="size-5 animate-spin" />申請しています…</> : ready.length ? `${ready.length}件をまとめて申請` : busyCount ? "読み取り中…" : "未入力の項目があります"}
        </Button>
      </div>
    </div> : null}
  </main>;
}

function ReceiptCard({ item, today, categories, projects, disabled, onToggle, onDetails, onChange, onSend, onRemove }: {
  item: Item; today: string; categories: Option[]; projects: { recent: Option[]; rest: Option[] }; disabled: boolean;
  onToggle: () => void; onDetails: () => void; onChange: (key: FieldKey, value: string) => void; onSend: () => void; onRemove: () => void;
}) {
  const { fields } = item, missing = problems(fields, today), sending = item.state === "sending", waiting = item.state === "preparing" || item.state === "reading";
  const lock = sending || disabled;
  const hint = (key: FieldKey) => item.auto[key] ? <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-normal text-sky-700 dark:text-sky-300"><Sparkles className="size-3" />{sourceLabel[item.auto[key]!]}</span> : null;
  const label = (key: FieldKey, text: string, required = false) => <span className="flex items-center gap-1 text-xs font-medium">{text}{required ? <span className="text-rose-600">*</span> : null}{hint(key)}</span>;
  const amount = Number(fields.amount.replaceAll(",", ""));
  return <article className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${item.error ? "border-rose-300 dark:border-rose-900" : ""}`}>
    <button type="button" className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={item.open} onClick={onToggle}>
      <div className="size-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
        {item.preview ?
          // Local object URLs are previews of the photo just taken; nothing to optimize.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.preview} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-xs text-muted-foreground">PDF</div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fields.payee || (waiting ? "読み取り中…" : "支払先を入力")}</p>
        <p className="truncate text-xs text-muted-foreground">{fields.spentOn ? formatDate(fields.spentOn) : "日付未入力"}{fields.purpose ? `・${fields.purpose}` : ""}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs">{waiting ? <><Loader2 className="size-3 animate-spin" />領収書を読み取っています</> : sending ? <><Loader2 className="size-3 animate-spin" />申請しています</>
          : missing.length ? <span className="text-amber-700 dark:text-amber-300">未入力：{missing.join("・")}</span> : <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Check className="size-3" />申請できます</span>}</p>
      </div>
      <div className="text-right"><p className="text-base font-semibold tabular-nums">{amount > 0 ? <Money value={amount} /> : "—"}</p><ChevronDown className={`ml-auto size-4 text-muted-foreground transition-transform ${item.open ? "rotate-180" : ""}`} /></div>
    </button>
    {item.open ? <div className="space-y-4 border-t p-4">
      {item.warnings.map((warning) => <p key={warning} className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{warning}</p>)}
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the photo just taken */}
      {item.preview ? <a href={item.preview} target="_blank" rel="noreferrer" className="block"><img src={item.preview} alt="撮影した領収書" className="max-h-72 w-full rounded-lg border bg-muted object-contain" /></a> : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1">{label("amount", "金額（円）", true)}<Input className={inputClass} inputMode="numeric" pattern="[0-9,]*" value={fields.amount} placeholder="0" disabled={lock} onChange={(event) => onChange("amount", event.target.value.replace(/[^\d,]/g, ""))} /></label>
        <label className="min-w-0 space-y-1">{label("spentOn", "支払日", true)}<Input className={inputClass} type="date" max={today} value={fields.spentOn} disabled={lock} onChange={(event) => onChange("spentOn", event.target.value)} /></label>
      </div>
      <label className="block space-y-1">{label("payee", "支払先", true)}<Input className={inputClass} value={fields.payee} maxLength={100} placeholder="店名・会社名" disabled={lock} onChange={(event) => onChange("payee", event.target.value)} /></label>
      <label className="block space-y-1">{label("purpose", "用途", true)}<Input className={inputClass} value={fields.purpose} maxLength={200} placeholder="例：打ち合わせのタクシー代" disabled={lock} onChange={(event) => onChange("purpose", event.target.value)} /></label>
      <label className="block space-y-1">{label("projectId", "案件")}<select className={selectClass} value={fields.projectId} disabled={lock} onChange={(event) => onChange("projectId", event.target.value)}>
        <option value="">共通経費（案件なし）</option>
        {projects.recent.length ? <optgroup label="最近使った案件">{projects.recent.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</optgroup> : null}
        <optgroup label="すべての案件">{projects.rest.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</optgroup>
      </select></label>
      <label className="block space-y-1">{label("categoryId", "勘定科目")}<select className={selectClass} value={fields.categoryId} disabled={lock} onChange={(event) => onChange("categoryId", event.target.value)}>
        <option value="">わからない（経理が設定）</option>{categories.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
      </select></label>
      <div className="space-y-1">{label("paidWith", "支払い方法")}<div role="group" aria-label="支払い方法" className="grid grid-cols-3 gap-2">
        {([["CASH", "現金"], ["PERSONAL_CARD", "個人カード等"], ["OTHER", "その他"]] as const).map(([value, text]) =>
          <button key={value} type="button" aria-pressed={fields.paidWith === value} disabled={lock} onClick={() => onChange("paidWith", value)}
            className={`h-11 rounded-lg border text-sm ${fields.paidWith === value ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{text}</button>)}
      </div></div>
      <button type="button" className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground" aria-expanded={item.details} onClick={onDetails}>
        <ChevronDown className={`size-4 transition-transform ${item.details ? "rotate-180" : ""}`} />登録番号・消費税・メモ{fields.registrationNumber ? `（${fields.registrationNumber}）` : ""}
      </button>
      {item.details ? <div className="space-y-3">
        <label className="block space-y-1">{label("registrationNumber", "インボイス登録番号")}<Input className={inputClass} value={fields.registrationNumber} placeholder="T1234567890123" maxLength={20} disabled={lock} onChange={(event) => onChange("registrationNumber", event.target.value.toUpperCase())} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="min-w-0 space-y-1">{label("tax10", "消費税 10%")}<Input className={inputClass} inputMode="numeric" value={fields.tax10} disabled={lock} onChange={(event) => onChange("tax10", event.target.value.replace(/\D/g, ""))} /></label>
          <label className="min-w-0 space-y-1">{label("tax8", "消費税 8%")}<Input className={inputClass} inputMode="numeric" value={fields.tax8} disabled={lock} onChange={(event) => onChange("tax8", event.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="block space-y-1">{label("memo", "メモ")}<Textarea className="text-base" value={fields.memo} maxLength={1000} placeholder="同席者・補足など" disabled={lock} onChange={(event) => onChange("memo", event.target.value)} /></label>
      </div> : null}
      {item.error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{item.error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="h-12" disabled={lock} onClick={onRemove} aria-label="この領収書を外す"><Trash2 className="size-4" /></Button>
        <Button type="button" className="h-12 flex-1 text-base" disabled={lock || waiting} onClick={onSend}>{sending ? <><Loader2 className="size-4 animate-spin" />申請しています…</> : waiting ? "読み取り中…" : "この内容で申請"}</Button>
      </div>
    </div> : null}
  </article>;
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function InstallHint() {
  const [mode, setMode] = useState<"" | "ios" | "prompt">(""), prompt = useRef<InstallPrompt | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone || stored(STORAGE_INSTALL) === "dismissed") return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const capture = (event: Event) => { event.preventDefault(); prompt.current = event as InstallPrompt; setMode("prompt"); };
    window.addEventListener("beforeinstallprompt", capture);
    const timer = ios ? window.setTimeout(() => setMode("ios"), 0) : undefined;
    return () => { window.removeEventListener("beforeinstallprompt", capture); if (timer) window.clearTimeout(timer); };
  }, []);
  if (!mode) return null;
  const dismiss = () => { store(STORAGE_INSTALL, "dismissed"); setMode(""); };
  return <section aria-label="ホーム画面に追加" className="mx-4 mt-4 flex items-start gap-3 rounded-xl border bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">
    <Smartphone className="mt-0.5 size-5 shrink-0" />
    <div className="min-w-0 flex-1 space-y-2">
      <p className="font-medium">ホーム画面に追加すると、アプリのようにすぐ撮影できます</p>
      {mode === "ios" ? <p className="text-xs">Safariの <Share className="inline size-3.5 align-[-2px]" /> 共有ボタン →「ホーム画面に追加」</p>
        : <Button type="button" size="sm" onClick={async () => { await prompt.current?.prompt(); dismiss(); }}>ホーム画面に追加</Button>}
    </div>
    <button type="button" aria-label="閉じる" className="-m-1 p-1" onClick={dismiss}><X className="size-4" /></button>
  </section>;
}
