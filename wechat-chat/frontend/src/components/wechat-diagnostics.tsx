"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw, ShieldCheck } from "lucide-react";
import { api, Status, time } from "@/lib/api";

type Diagnostic = {
  connection: Pick<Status, "state" | "detail" | "version" | "can_read" | "can_send">;
  diagnostic: {state: string; process_count?: number; window_count?: number; node_count?: number; interactive_node_count?: number};
  active_adapter: string;
  active_connection?: Status;
  checked_at: string;
};

type FreeTrial = {
  state: "available" | "unavailable";
  report: null | {
    checked_at: string;
    package_version: string | null;
    wechat_version: string | null;
    attempts: {variant: "en" | "cn" | "international"; initialized: boolean; error_code: string | null; visible_message_count: number | null}[];
  };
};

const variants = {en: "英語設定", cn: "中国語設定", international: "国際版指定"};

function FreeTrialResult() {
  const [trial, setTrial] = useState<FreeTrial | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api<FreeTrial>("/wechat/free-trial").then(value => { if (active) setTrial(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  const report = trial?.report;
  const hasText = report?.attempts.some(item => !item.error_code && (item.visible_message_count || 0) > 0);
  return <section aria-label="無料版の検証記録"><h3>無料版の検証記録</h3>{report ? <>
    <p className="assist-reason">{hasText ? "標準設定の試験で、表示中の本文を取得できた記録です。" : "標準設定による過去の試験では、無料版による本文の取得は確認できていません。現在のReaderの接続状態とは別の記録です。"}</p>
    <p className="assist-caption">wxauto4 {report.package_version || "版不明"} · WeChat {report.wechat_version || "版不明"}<br/>検証日時：{new Date(report.checked_at).toLocaleString("ja-JP")}。現在の接続状態ではなく、PCで実行した試験の記録です。</p>
    <dl>{report.attempts.map(item => <div key={item.variant}><dt>{variants[item.variant]}</dt><dd>{item.error_code === "main_window_not_found" ? "会話画面を認識できず" : item.error_code ? "検証できず" : (item.visible_message_count || 0) > 0 ? "表示中の本文を取得" : "本文は未確認"}</dd></div>)}</dl>
    <p className="help">この試験記録は送信許可ではありません。英語UIへの互換対応を加えたReaderの状態は、現在のアプリの接続表示を確認してください。</p>
  </> : <p className="help">{failed ? "検証記録を取得できませんでした。" : trial ? "このPCには無料版の検証記録がありません。" : "検証記録を確認しています…"}</p>}</section>;
}

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
  const activeReader = result && ["wxauto4", "wxautox4"].includes(result.active_adapter);
  const current = activeReader ? result.active_connection : result?.connection;
  const label = !result ? "未確認" : current?.can_send ? "手動送信有効" : current?.can_read ? "読取専用" : current?.state === "limited" ? "読み取り制限" : current?.state === "login_required" ? "ログイン待機" : current?.state === "error" ? "診断エラー" : "画面を確認";
  return <article className="settings-card wechat-diagnostics"><div className="card-heading"><Monitor size={21}/><h2>実際のWeChatとの接続</h2><span className="sync-label">{label}</span></div><p>PC上のWeChatを読み取り専用で診断します。Mockで動くことと、実際の会話を取得できることは別です。</p><button className="secondary" disabled={busy} onClick={() => void diagnose()}><RefreshCw size={15} className={busy ? "spin" : ""}/>{busy ? "WeChatを確認しています…" : "WeChatの読み取りを診断"}</button>{error && <p role="alert">{error}</p>}{result && <><p className="assist-reason" role="status">{current?.detail}</p><dl><div><dt>現在のアプリ</dt><dd>{result.active_adapter === "mock" ? "Mockシミュレーター" : result.active_adapter === "windows-ocr" ? "画面OCR・手動" : result.active_adapter === "wxautox4" ? "Plus連携" : result.active_adapter === "wxauto4" ? "無料wxauto4・読取" : "Windows UIA"}</dd></div><div><dt>WeChatバージョン</dt><dd>{result.connection.version || "取得できません"}</dd></div><div><dt>表示中のテキスト読み取り</dt><dd>{activeReader ? result.active_connection?.can_read ? "限定範囲で有効" : "接続状態を確認" : "未対応"}</dd></div><div><dt>実メッセージの送信</dt><dd>{activeReader && current?.can_send ? "本人の確認後に有効" : "無効"}</dd></div><div><dt>最終診断</dt><dd>{time(result.checked_at)}</dd></div></dl>{result.diagnostic.state === "ui_tree_unavailable" && <p>ログイン済みでも、WeChatが画面情報を公開しない状態があります。同期済みとは扱わず、現在のアプリはそのまま利用できます。</p>}<details><summary>診断の詳細</summary><p className="assist-caption">読み取り可能な画面部品 {result.diagnostic.interactive_node_count ?? 0}件 / 検出した画面要素 {result.diagnostic.node_count ?? 0}件。部品を検出できても、その版のReader検証が完了するまで読み取りは有効にしません。</p></details></>}<FreeTrialResult/><p className="inline"><ShieldCheck size={15}/>この診断ボタンは認証・送信・画面操作を行いません。本文やアカウント情報も診断結果に含めません。</p></article>;
}
