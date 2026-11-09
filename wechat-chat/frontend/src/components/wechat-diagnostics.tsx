"use client";

import { useRef, useState } from "react";
import { Monitor, RefreshCw, ShieldCheck } from "lucide-react";
import { api, Status, time } from "@/lib/api";

type Diagnostic = {
  connection: Pick<Status, "state" | "detail" | "version" | "can_read" | "can_send">;
  diagnostic: {state: string; process_count?: number; window_count?: number; node_count?: number; interactive_node_count?: number};
  active_adapter: string;
  checked_at: string;
};

export default function WechatDiagnostics({onError}: {onError: (error: unknown) => void}) {
  const [result, setResult] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function diagnose() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { setResult(await api<Diagnostic>("/wechat/diagnostics", {})); }
    catch (e) { setError("診断結果を取得できませんでした。接続状態を確認してからお試しください。"); onError(e); }
    finally { locked.current = false; setBusy(false); }
  }
  const label = !result ? "未確認" : result.connection.state === "limited" ? "読み取り制限" : result.connection.state === "login_required" ? "ログイン待機" : result.connection.state === "error" ? "診断エラー" : "画面を確認";
  return <article className="settings-card wechat-diagnostics"><div className="card-heading"><Monitor size={21}/><h2>実際のWeChatとの接続</h2><span className="sync-label">{label}</span></div><p>PC上のWeChatを読み取り専用で診断します。Mockで動くことと、実際の会話を取得できることは別です。</p><button className="secondary" disabled={busy} onClick={() => void diagnose()}><RefreshCw size={15} className={busy ? "spin" : ""}/>{busy ? "WeChatを確認しています…" : "WeChatの読み取りを診断"}</button>{error && <p role="alert">{error}</p>}{result && <><p className="assist-reason" role="status">{result.connection.detail}</p><dl><div><dt>現在のアプリ</dt><dd>{result.active_adapter === "mock" ? "Mockシミュレーター" : result.active_adapter === "windows-ocr" ? "画面OCR・手動" : "Windows UIA"}</dd></div><div><dt>WeChatバージョン</dt><dd>{result.connection.version || "取得できません"}</dd></div><div><dt>UIAによる自動読み取り</dt><dd>未対応</dd></div><div><dt>実メッセージの送信</dt><dd>無効</dd></div><div><dt>最終診断</dt><dd>{time(result.checked_at)}</dd></div></dl>{result.diagnostic.state === "ui_tree_unavailable" && <p>ログイン済みでも、WeChatが画面情報を公開しない状態があります。同期済みとは扱わず、現在のアプリはそのまま利用できます。</p>}<details><summary>診断の詳細</summary><p className="assist-caption">読み取り可能な画面部品 {result.diagnostic.interactive_node_count ?? 0}件 / 検出した画面要素 {result.diagnostic.node_count ?? 0}件。部品を検出できても、その版のReader検証が完了するまで読み取りは有効にしません。</p></details></>}<p className="inline"><ShieldCheck size={15}/>認証・送信・画面操作は行いません。本文やアカウント情報も診断結果に含めません。</p></article>;
}
