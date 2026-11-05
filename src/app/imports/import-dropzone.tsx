"use client";

import { Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ImportIntakeResult } from "@/lib/import-intake";
import { importDocumentKindLabels } from "@/lib/import-shipments";
import { operationFailureToast, unconfirmedUploadFiles, uploadFeedback } from "@/lib/operation-feedback";

function intakeSummary(results: ImportIntakeResult[]) {
  const saved = results.filter((row) => row.savedAs);
  const created = saved.filter((row) => row.shipmentCreated).length;
  const assigned = saved.filter((row) => row.shipmentId && !row.shipmentCreated).length;
  const unassigned = saved.filter((row) => !row.shipmentId).length;
  const details = [created ? `便を${created}つ作成` : "", assigned ? `${assigned}件を既存の便に追加` : "", unassigned ? `${unassigned}件は未割当（下の「便の候補」にまとめています）` : ""].filter(Boolean);
  return `${saved.length}件を取り込みました。${details.length ? `${details.join("、")}。` : ""}`;
}

export function ImportDropzone({ company, shipmentId, compact, onCreated }: {
  company: CompanyScope; shipmentId?: string; compact?: boolean; onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null), inFlight = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<ImportIntakeResult[]>([]);
  const [error, setError] = useState("");
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const upload = (files: FileList | File[]) => {
    if (inFlight.current) return;
    const selected = Array.from(files);
    if (!selected.length) return;
    inFlight.current = true;
    setRetryFiles(selected); setError(""); setResults([]); setProgress({ done: 0, total: selected.length });
    startTransition(async () => {
      const completed: ImportIntakeResult[] = [];
      const confirmations: Array<{ fileName: string; error?: string }> = [];
      let failure = "";
      try {
        // One request per file provides real OCR progress and an unambiguous receipt for renamed files.
        for (const file of selected) {
          const form = new FormData();
          form.append("company", company); form.append("files", file);
          if (shipmentId) form.append("shipmentId", shipmentId);
          const response = await fetch("/api/uploads/imports", { method: "POST", body: form });
          const body = await response.json() as { error?: string; results?: ImportIntakeResult[] };
          if (!response.ok) throw new Error(body.error || "輸入書類の取り込みに失敗しました");
          if (!Array.isArray(body.results) || body.results.length !== 1) throw new Error("取込結果を確認できませんでした");
          const result = body.results[0];
          completed.push(result);
          confirmations.push({ fileName: file.name, error: result.error });
          setResults([...completed]); setProgress({ done: completed.length, total: selected.length });
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : "通信に失敗し、取込結果を確認できませんでした";
      } finally {
        const retained = unconfirmedUploadFiles(selected, confirmations);
        setRetryFiles(retained);
        if (!retained.length && inputRef.current) inputRef.current.value = "";
        const feedback = uploadFeedback(completed, retained.length);
        if (failure || feedback.variant === "destructive") {
          const message = [failure, feedback.title, feedback.description].filter(Boolean).join("。");
          setError(message);
          const failureFeedback = failure ? operationFailureToast(message) : feedback;
          toast({ ...failureFeedback, description: [intakeSummary(completed), failureFeedback.description].filter(Boolean).join(" ") });
        } else {
          toast({ title: intakeSummary(completed), variant: "success" });
        }
        inFlight.current = false;
        router.refresh();
        const created = completed.find((row) => row.shipmentCreated && row.shipmentId);
        if (created?.shipmentId) onCreated?.(created.shipmentId);
      }
    });
  };

  return <Card className="min-w-0">
    <CardContent className="p-3">
      <div
        className={`flex min-w-0 cursor-pointer flex-col justify-center gap-3 rounded-md border border-dashed p-4 transition ${compact ? "" : "md:flex-row md:items-center md:justify-between"} ${dragging ? "border-primary bg-muted" : "border-border bg-muted/20"}`}
        onDragEnter={(event) => { event.preventDefault(); if (!inFlight.current) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); upload(event.dataTransfer.files); }}
        aria-busy={pending}
        onClick={() => { if (!inFlight.current) inputRef.current?.click(); }}
      >
        <div className="flex min-w-0 items-start gap-3">
          {pending ? <Loader2 className="size-7 shrink-0 animate-spin text-muted-foreground" /> : <UploadCloud className="size-7 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{compact ? "この便に書類をドロップ" : "輸入書類をドロップ（OCR）"}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{compact
              ? "読み取った許可番号や税額は、空欄の項目にだけ書き込みます。"
              : "PDF/JPEG/PNGを読み取り、輸入許可通知書・パッキングリスト・AWB/B/L・通関業者の請求書などの種類を判定します。輸入許可通知書は便を自動で作り、許可番号・関税・輸入消費税を書き込みます。申告番号・B/L/AWB番号・インボイス番号が一致する便があればその便に付き、未割当の書類は下の「便の候補」にまとめます。"}</p>
            {pending ? <p role="status" className="mt-2 text-sm text-muted-foreground">OCR処理中… {progress.done}/{progress.total}件</p> : null}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={pending}>ファイルを選択</Button>
        <input ref={inputRef} className="sr-only" type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={pending}
          aria-label={compact ? "この便に取り込む輸入書類" : "取り込む輸入書類"} onClick={(event) => event.stopPropagation()} onChange={(event) => { if (event.target.files) upload(event.target.files); }} />
      </div>
      {error ? <Alert variant="destructive" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {retryFiles.length && !pending ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <p className="text-muted-foreground">選択{retryFiles.length}件を保持しています。登録済みの内容を確認してから再試行してください。</p>
        <Button type="button" variant="outline" size="sm" className="h-auto max-w-full whitespace-normal" onClick={() => upload(retryFiles)}>保持したファイルを再試行（{retryFiles.length}件）</Button>
      </div> : null}
      {results.length ? <p role="status" className="mt-3 text-xs text-muted-foreground">{intakeSummary(results)}</p> : null}
      {results.length ? <ul className={`mt-3 grid min-w-0 gap-2 ${compact ? "" : "lg:grid-cols-2"}`} aria-label="輸入書類の取込結果">
        {results.map((result, index) => <li key={`${result.fileName}:${index}`} className="min-w-0 space-y-2 rounded-md border p-3 text-xs text-muted-foreground">
          <p className="break-all font-medium text-foreground">{result.displayName}</p>
          <p className="break-all text-[11px] text-muted-foreground">保存名: {result.fileName}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{importDocumentKindLabels[result.kind]}</Badge>
            {result.savedAs ? <Badge variant="outline">{result.savedAs === "received-invoice" ? "受領請求書" : "郵便物"}</Badge> : null}
            {result.shipmentCreated ? <Badge variant="outline">新しい便を作成</Badge> : null}
            {result.duplicate ? <Badge variant="outline" className="border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-200">重複候補</Badge> : null}
          </div>
          <p className="break-words">{result.shipmentId ? `便: ${result.shipmentTitle}` : result.savedAs ? "未割当" : "未保存"}</p>
          {result.filled.length ? <p>読み取り: {result.filled.join("・")}</p> : null}
          {result.duplicate ? <p className="break-words">{result.duplicateReason || "重複候補として保存しました"}{result.duplicateTitle ? ` / 既存: ${result.duplicateTitle}` : ""}{result.duplicateScore ? ` / 類似度 ${result.duplicateScore}%` : ""}</p> : null}
          {result.warnings?.length ? <details><summary className="cursor-pointer">詳細 {result.warnings.length}件</summary><ul className="mt-1 list-disc space-y-1 pl-4">{result.warnings.map((warning, i) => <li key={i} className="break-words">{warning}</li>)}</ul></details> : null}
          {result.error ? <p className="break-words"><Badge variant="outline" className="mr-1 border-destructive/40 text-destructive">エラー</Badge>{result.error}</p> : null}
        </li>)}
      </ul> : null}
    </CardContent>
  </Card>;
}
