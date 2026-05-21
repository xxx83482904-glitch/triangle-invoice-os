"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { yen } from "@/lib/format";

type DropResult = {
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
  warnings?: string[];
};

export function ReceivedInvoiceDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState<DropResult[]>([]);

  const upload = (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    setError("");

    startTransition(async () => {
      const formData = new FormData();
      for (const file of selected) formData.append("files", file);

      const response = await fetch("/api/uploads/received-invoices/ocr-drop", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "OCR仕分けに失敗しました。");
        return;
      }

      setResults(body.results ?? []);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div
          className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-6 text-center transition ${
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
          <UploadCloud className="mb-3 h-8 w-8 text-muted-foreground" />
          <div className="font-medium">受領請求書をここにドロップ</div>
          <div className="mt-1 text-sm text-muted-foreground">PDF / JPEG / PNGをOCRして自動仕分けします</div>
          <Button type="button" variant="outline" size="sm" className="mt-4" disabled={isPending}>
            {isPending ? "OCR中..." : "ファイルを選択"}
          </Button>
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
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {results.length ? (
          <div className="mt-4 space-y-2">
            {results.map((result) => (
              <div key={result.fileName} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{result.fileName}</span>
                  <span className={result.error ? "text-red-700" : "text-muted-foreground"}>
                    {result.error ? "要確認" : `信頼度 ${result.confidence ?? 0}%`}
                  </span>
                </div>
                {result.invoice ? (
                  <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                    <div>支払先: {result.invoice.vendorName}</div>
                    <div>案件: {result.invoice.projectName}</div>
                    <div>請求日: {result.invoice.issueDate}</div>
                    <div>支払期限: {result.invoice.dueDate}</div>
                    <div>金額: {yen.format(result.invoice.total)}</div>
                  </div>
                ) : null}
                {result.error ? <div className="mt-2 text-red-700">{result.error}</div> : null}
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
