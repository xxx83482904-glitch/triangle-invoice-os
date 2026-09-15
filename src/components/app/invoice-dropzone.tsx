"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileUp, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";

type Result = { fileName: string; id?: string; error?: string; duplicate?: boolean; warnings?: string[]; projectId?: string; projectName?: string; projectCreated?: boolean; projectMatch?: string };
type Props = { company: CompanyScope; kind: "issued" | "received"; projects?: Array<{ value: string; label: string }> };

export function InvoiceDropzone({ company, kind, projects = [] }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const label = kind === "issued" ? "発行請求書" : "受領請求書";

  async function upload(files: FileList | File[]) {
    if (busy.current) return;
    const selected = Array.from(files);
    if (!selected.length) return;
    if (selected.length > 20) { setError("1回に20件まで選択できます"); return; }
    busy.current = true;
    setError("");
    setResults([]);
    const imported: Result[] = [];
    try {
      for (const [index, file] of selected.entries()) {
        setProgress({ current: index + 1, total: selected.length });
        if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
          imported.push({ fileName: file.name, error: "PDF・JPEG・PNG、1件10MB以内のファイルを選択してください" });
        } else {
          try {
            const form = new FormData();
            form.set("company", company);
            if (projectId) form.set("projectId", projectId);
            form.append("files", file);
            const response = await fetch("/api/uploads/" + kind + "-invoices/ocr-drop", { method: "POST", body: form });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "取込に失敗しました");
            imported.push(...(body.results || [{ fileName: file.name, error: "取込結果を確認できませんでした" }]));
          } catch (e) { imported.push({ fileName: file.name, error: e instanceof Error ? e.message : "通信に失敗しました。登録結果を確認してから再試行してください" }); }
        }
        setResults([...imported]);
      }
      router.refresh();
      const count = imported.filter((r) => !r.error).length;
      toast({ title: count + "件取込、" + (imported.length - count) + "件要確認", variant: count ? "success" : "destructive" });
    } finally { busy.current = false; setProgress(null); }
  }

  return <section aria-label={label + "取込"} className="space-y-3 border-y py-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <h2 className="shrink-0 font-semibold">{label}を取り込む</h2>
      {kind === "issued" ? <select aria-label="取込先の案件" className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:max-w-md" value={projectId} disabled={Boolean(progress)} onChange={(e) => { setProjectId(e.target.value); setError(""); }}>
        <option value="">自動判定・なければ新規案件</option>
        {projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select> : null}
    </div>
    <button type="button" disabled={Boolean(progress)} aria-label={label + "ファイルを選択"} aria-busy={Boolean(progress)}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!busy.current && e.dataTransfer.types.includes("Files")) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
      className={"flex min-h-24 w-full flex-wrap items-center justify-center gap-3 rounded-md border border-dashed px-4 py-5 text-left transition-colors disabled:cursor-wait " + (dragging ? "border-primary bg-accent" : "bg-background hover:bg-muted/50")}>
      {progress ? <LoaderCircle aria-hidden className="size-6 animate-spin" /> : <FileUp aria-hidden className="size-6 text-muted-foreground" />}
      <span className="min-w-0 break-words">{progress ? "OCR取込中 " + progress.current + " / " + progress.total : "ファイルをドロップ / 選択"}</span>
      <span className="text-xs text-muted-foreground">PDF・JPEG・PNG / 10MB</span>
    </button>
    <input ref={input} type="file" aria-label={label + "アップロード"} accept="application/pdf,image/jpeg,image/png" multiple hidden disabled={Boolean(progress)} onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
    {progress ? <progress className="h-1 w-full accent-primary" value={progress.current - 1} max={progress.total} aria-label="取込進捗" /> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {results.length ? <div className="max-h-48 space-y-2 overflow-auto" aria-live="polite">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">取込結果 {results.length}件</span><Button size="icon" variant="ghost" aria-label="取込結果を閉じる" title="取込結果を閉じる" disabled={Boolean(progress)} onClick={() => setResults([])}><X className="size-4" /></Button></div>
      {results.map((r, i) => <div key={r.fileName + i} className="flex items-start gap-2 text-sm">
        {r.error ? <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
        <div className="min-w-0"><span className="break-all">{r.fileName}</span><p className="text-xs text-muted-foreground">{r.error || (kind === "issued" ? "OCR要確認の下書きに保存しました" : "確認中として保存しました")}</p>
          {!r.error && r.projectName ? <p className="break-words text-xs">{r.projectCreated ? "新規案件: " : r.projectMatch === "manual" ? "指定案件: " : "自動判定: "}{r.projectName}</p> : null}
        </div>
      </div>)}
    </div> : null}
  </section>;
}
