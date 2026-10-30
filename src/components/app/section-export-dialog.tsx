"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download, ExternalLink, FileArchive, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { canExportSection, exportScopes, fiscalRange, type ExportScope, type SectionExport } from "@/lib/section-export";
import { documentKindLabels } from "@/lib/documents";
import type { UserRole } from "@/lib/types";

const control = "h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
export function SectionExportDialog({ scope, role, disabled = false }: { scope: ExportScope; role: UserRole; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const year = now.getFullYear() + (now.getMonth() >= 8 ? 1 : 0);
  const [range, setRange] = useState(() => fiscalRange(scope === "all" ? year - 1 : year));
  const [basis, setBasis] = useState("document");
  const [undated, setUndated] = useState(true);
  const [response, setResponse] = useState<{ query: string; data: SectionExport | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(80);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const downloadController = useRef<AbortController | null>(null);
  const id = useId();
  const query = new URLSearchParams({ company: "JAPAN", scope, ...range, basis, undated: undated ? "1" : "0" }).toString();
  const preview = response?.query === query ? response.data : null;
  const loading = open && response?.query !== query;
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setError(""); setNotice(""); setLimit(80);
      fetch(`/api/section-export?${query}`, { signal: abort.signal, cache: "no-store" })
        .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || "一覧を読み込めませんでした"); return body; })
        .then((body: SectionExport) => { if (!abort.signal.aborted) setResponse({ query, data: body }); })
        .catch((e) => { if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : "読み込みに失敗しました"); setResponse({ query, data: null }); } });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [open, query]);
  useEffect(() => () => downloadController.current?.abort(), []);
  const count = scope === "banking" ? preview?.bank.length || 0 : preview?.documents.length || 0;
  useEffect(() => {
    if (!sentinel.current || !scroll.current || count <= limit) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setLimit((value) => value + 80); }, { root: scroll.current, rootMargin: "150px" });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [count, limit, loading]);
  if (!canExportSection({ role }, scope)) return null;
  async function download(format: "csv" | "zip") {
    setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); downloadController.current = controller;
    try {
      const response = await fetch(`/api/section-export?${query}&format=${format}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "書き出しに失敗しました"); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `triangle-${scope}-${range.start}-${range.end}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice(format === "zip" ? "ZIPをダウンロードしました。原本の欠落・読込失敗は一覧とREADMEで確認してください。" : "CSVをダウンロードしました。");
    } catch (e) { setError(controller.signal.aborted ? "書き出しを中止しました" : e instanceof Error ? e.message : "書き出しに失敗しました。期間を分けて再試行してください"); }
    finally { setBusy(false); downloadController.current = null; }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { if (value) setResponse(null); setOpen(value); } }}>
    <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled} className="min-h-11"><Download className="size-4" />書き出し</Button></DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] min-w-0 flex-col overflow-y-auto sm:max-w-4xl" onPointerDownOutside={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{exportScopes[scope]}の書き出し</DialogTitle><DialogDescription>保存済みデータ / 8月末決算{scope === "banking" ? " / 全口座・カード" : ""}</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="grid min-w-0 shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
        <label htmlFor={`${id}-period`} className="col-span-2 grid min-w-0 gap-1 text-sm sm:col-span-1">期間<select id={`${id}-period`} className={control}
          value={Array.from({ length: 8 }, (_, i) => year - i).find((y) => { const p = fiscalRange(y); return p.start === range.start && p.end === range.end; }) || "custom"}
          onChange={(e) => { if (e.target.value !== "custom") setRange(fiscalRange(Number(e.target.value))); }}>
          <option value="custom">期間を指定</option>{Array.from({ length: 8 }, (_, i) => year - i).map((y) => <option key={y} value={y}>{y}年8月期（{y - 1}/9〜{y}/8）</option>)}
        </select></label>
        <label htmlFor={`${id}-start`} className="grid min-w-0 gap-1 text-sm">開始日<Input id={`${id}-start`} className="h-11 min-w-0" type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} /></label>
        <label htmlFor={`${id}-end`} className="grid min-w-0 gap-1 text-sm">終了日<Input id={`${id}-end`} className="h-11 min-w-0" type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} /></label>
        {scope !== "banking" ? <label htmlFor={`${id}-basis`} className="col-span-2 grid min-w-0 gap-1 text-sm sm:col-span-1">日付基準<select id={`${id}-basis`} className={control} value={basis} onChange={(e) => setBasis(e.target.value)}><option value="document">書類日（郵便物・契約書は登録日）</option><option value="folder">フォルダー月（月単位）</option>{scope === "issued" || scope === "all" ? <option value="transaction">発行請求書は取引日・他は書類日</option> : null}</select></label> : null}
        <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5 shrink-0" checked={undated} onChange={(e) => setUndated(e.target.checked)} />日付未設定を「期間未判定」として含める</label>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2 border-y py-2 text-sm" aria-live="polite"><span>{loading ? "読み込み中…" : `${count.toLocaleString()}件`}{scope === "all" && preview ? ` / 口座明細 ${preview.bank.length.toLocaleString()}件` : ""}</span><span className="text-muted-foreground">状態・勘定科目は現在の保存値</span></div>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="break-words text-sm text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
      <div ref={scroll} className="min-h-24 min-w-0 flex-1 overflow-auto" aria-label="書き出し対象一覧">
        {!loading && preview && !count ? <p className="py-8 text-center text-sm text-muted-foreground">指定期間のデータはありません</p> : null}
        {preview && count > 0 ? <table className="w-full min-w-[640px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{(scope === "banking" ? ["取引日", "口座 / 摘要", "金額", "勘定科目", "確認"] : ["対象日 / 種類", "番号・件名 / 取引先", "金額", "現在の状態", "原本"]).map((label) => <th className="border-b p-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
          {scope === "banking" ? preview.bank.slice(0, limit).map((r) => <tr key={r.id}><td className="border-b p-2">{r.date || "期間未判定"}</td><td className="max-w-64 break-words border-b p-2">{r.account}<br />{r.content}</td><td className="whitespace-nowrap border-b p-2 tabular-nums">{r.side} {r.amount.toLocaleString()}</td><td className="border-b p-2">{r.category}<br />{r.treatment}</td><td className="border-b p-2">{r.reviewed}{r.sourceMissing ? " / 連携元欠落" : ""}</td></tr>) : preview.documents.slice(0, limit).map((r) => <tr key={r.id}><td className="border-b p-2">{r.exportDate || "期間未判定"}<br /><span className="text-muted-foreground">{documentKindLabels[r.kind]}</span></td><td className="max-w-64 break-words border-b p-2">{r.title}<br /><span className="text-muted-foreground">{r.counterpart} / {r.projectName}</span></td><td className="border-b p-2 tabular-nums">{r.total?.toLocaleString() ?? "—"}</td><td className="border-b p-2">{r.statusLabel}<br /><span className="text-amber-700 dark:text-amber-300">{r.warning}</span></td><td className="border-b p-2">{r.fileUrl && /^\/(?:api\/|uploads\/)/.test(r.fileUrl) ? <a className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={r.fileUrl} target="_blank" rel="noopener noreferrer">{r.fileType}<ExternalLink className="size-3" /></a> : "原本なし"}</td></tr>)}
        </tbody></table> : null}<div ref={sentinel} className="h-2" />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-3">
        {busy ? <><span role="status" className="mr-auto flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />書き出し中…</span><Button variant="outline" className="min-h-11" onClick={() => downloadController.current?.abort()}>中止</Button></> : null}
        <Button variant="outline" className="min-h-11" disabled={loading || busy || !preview || !count} onClick={() => download("csv")}><Download className="size-4" />一覧CSV</Button>
        <Button className="min-h-11" disabled={loading || busy || !preview || !(count || preview.bank.length)} onClick={() => download("zip")}><FileArchive className="size-4" />{scope === "banking" ? "明細＋照合原本ZIP" : "一覧＋原本ZIP"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
