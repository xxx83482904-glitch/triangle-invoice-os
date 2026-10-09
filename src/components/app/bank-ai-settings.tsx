"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

export function BankAiSettings({ configured, model, keyFromEnv, modelFromEnv, disabled }: { configured: boolean; model: string; keyFromEnv: boolean; modelFromEnv: boolean; disabled?: boolean }) {
  const router = useRouter(), [pending, startTransition] = useTransition(), [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState(""), [nextModel, setNextModel] = useState(model), [error, setError] = useState("");
  function save() {
    startTransition(async () => {
      try {
        const body = { ...(!keyFromEnv && apiKey.trim() ? { openAiApiKey: apiKey.trim() } : {}), ...(!modelFromEnv ? { ocrAiModel: nextModel.trim() } : {}) };
        const response = await fetch("/api/system/ocr-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) { setError("設定を保存できませんでした。管理者権限と接続状態を確認してください。"); return; }
        setApiKey(""); setOpen(false); router.refresh(); toast({ title: "AI設定を保存しました", variant: "success" });
      } catch { setError("設定を保存できませんでした。通信状態を確認してください。"); }
    });
  }
  return <>
    <Button className="min-h-11 lg:min-h-11" variant="outline" disabled={disabled} onClick={() => { setApiKey(""); setNextModel(model); setError(""); setOpen(true); }}><Settings className="size-4" />AI設定</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending) { setOpen(value); if (!value) setApiKey(""); } }}>
      <DialogContent showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>AI設定</DialogTitle><DialogDescription>OCRのAI分類と共通のOpenAI API設定です。保存だけでは分析データを送信しません。</DialogDescription></DialogHeader>
        <p className="text-sm">APIキー: {configured ? "設定済み" : "未設定"}{keyFromEnv ? "（環境変数）" : ""}</p>
        <label className="grid gap-1 text-sm">OpenAI APIキー<Input className="min-h-11" type="password" autoComplete="new-password" value={apiKey} maxLength={500} disabled={pending || keyFromEnv} onChange={(e) => setApiKey(e.target.value)} placeholder={configured ? "変更する場合のみ入力" : "APIキーを入力"} /></label>
        <label className="grid gap-1 text-sm">モデル<Input className="min-h-11" value={nextModel} maxLength={100} disabled={pending || modelFromEnv} onChange={(e) => setNextModel(e.target.value)} /></label>
        {keyFromEnv || modelFromEnv ? <p className="text-xs text-muted-foreground">環境変数で指定された項目はSynologyのコンテナ設定が優先されるため、この画面では変更できません。</p> : null}
        <p className="text-xs text-muted-foreground">JSON Schema形式の出力に対応した、利用可能なモデルを指定してください。APIキーは再表示しません。接続確認はデータ送信に同意してAIを実行した時に行います。</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button className="min-h-11 lg:min-h-11" disabled={pending || !nextModel.trim() || keyFromEnv && modelFromEnv || !configured && !apiKey.trim()} onClick={save}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存</Button>
      </DialogContent>
    </Dialog>
  </>;
}
