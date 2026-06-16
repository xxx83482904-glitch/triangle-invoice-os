"use client";

import { FileCheck2, FolderArchive, Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { yen } from "@/lib/format";
import type { MailDocumentCategory } from "@/lib/types";

type SortResult = {
  category?: MailDocumentCategory;
  confidence?: number;
  duplicate?: boolean;
  error?: string;
  fileName: string;
  invoice?: {
    dueDate: string;
    issueDate: string;
    projectName: string;
    total: number;
    vendorName: string;
  };
  reason?: string;
  savedAs?: "received-invoice" | "other-document";
  warnings?: string[];
};

const categoryLabels: Record<MailDocumentCategory, string> = {
  INVOICE: "請求書",
  CONTRACT: "契約書",
  ESTIMATE: "見積書",
  DELIVERY_NOTE: "納品書",
  RECEIPT: "領収書",
  NOTICE: "通知",
  OTHER: "その他",
};

export function MailSorterDropzone({ company }: { company: CompanyScope }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState<SortResult[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const upload = (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    setError("");
    setProgress({ done: 0, total: selected.length });

    startTransition(async () => {
      const formData = new FormData();
      formData.append("company", company);
      for (const file of selected) formData.append("files", file);

      const response = await fetch("/api/uploads/mail-sorter", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "郵便物の仕分けに失敗しました");
        setProgress(null);
        toast({ title: "アップロード失敗", description: body.error ?? "郵便物の仕分けに失敗しました", variant: "destructive" });
        return;
      }

      const newResults: SortResult[] = body.results ?? [];
      setResults(newResults);
      setProgress({ done: selected.length, total: selected.length });
      router.refresh();

      const errorCount = newResults.filter((r) => r.error).length;
      const okCount = newResults.length - errorCount;
      if (errorCount > 0) {
        toast({ title: `${okCount}件完了、${errorCount}件エラー`, variant: "default" });
      } else {
        toast({ title: `${okCount}件の郵便物を仕分けしました`, variant: "success" });
      }

      // #10: Auto scroll to results after upload
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    });
  };

  return (
    <Card id="mail-dropzone">
      <CardContent className="p-3">
        <div
          className={`flex min-h-28 cursor-pointer flex-col justify-center gap-4 rounded-md border border-dashed p-4 transition md:flex-row md:items-center md:justify-between ${
            dragging ? "border-primary bg-muted" : "border-border bg-background"
          }`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            upload(event.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="flex items-center gap-3">
            {isPending ? (
              <Loader2 className="h-9 w-9 shrink-0 animate-spin text-primary" />
            ) : (
              <UploadCloud className="h-9 w-9 shrink-0 text-muted-foreground" />
            )}
            <div>
              <div className="font-medium">郵便物をまとめてドロップ</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {isPending && progress
                  ? `OCR処理中… ${progress.done}/${progress.total}件`
                  : "PDF/JPEG/PNGをOCRし、請求書・領収書は受領請求書へ、それ以外は月別フォルダーへ保存します。"}
              </div>
            </div>
          </div>
          {/* #15: Progress bar when uploading */}
          {isPending && progress && progress.total > 1 ? (
            <div className="w-full md:w-40">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-right text-xs text-muted-foreground">{progress.done}/{progress.total}</div>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={isPending}>
              {isPending ? "OCR仕分け中..." : "ファイルを選択"}
            </Button>
          )}
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            onChange={(event) => {
              if (event.target.files) upload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {error ? (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {results.length ? (
          <div ref={resultsRef} className="mt-3 grid gap-2 lg:grid-cols-2">
            {results.map((result) => (
              <div key={result.fileName} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{result.fileName}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {result.category ? <Badge variant="secondary">{categoryLabels[result.category]}</Badge> : null}
                    {result.savedAs === "received-invoice" ? (
                      <Badge className="gap-1">
                        <FileCheck2 className="h-3 w-3" />
                        受領請求書
                      </Badge>
                    ) : result.savedAs ? (
                      <Badge variant="outline" className="gap-1">
                        <FolderArchive className="h-3 w-3" />
                        その他保存
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 text-muted-foreground">
                  {result.error ?? `${result.reason ?? "仕分け完了"} / 信頼度 ${result.confidence ?? 0}%`}
                </div>
                {result.invoice ? (
                  <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                    <div>支払先: {result.invoice.vendorName}</div>
                    <div>案件: {result.invoice.projectName}</div>
                    <div>請求日: {result.invoice.issueDate}</div>
                    <div>支払期限: {result.invoice.dueDate}</div>
                    <div>金額: {yen.format(result.invoice.total)}</div>
                    {result.duplicate ? <div className="text-amber-700">重複候補: 既存請求書に紐づけ</div> : null}
                  </div>
                ) : null}
                {result.warnings?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-700">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
