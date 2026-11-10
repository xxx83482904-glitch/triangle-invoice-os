"use client";

import { useEffect, useState } from "react";
import { Archive, Pause, Play, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

type Progress = {
  state: "idle" | "running" | "paused" | "partial";
  phase?: "discovery" | "messages"; discovered: number; processed: number;
  saved: number; pages: number; failed?: number; ambiguous?: number; complete: false; error?: string | null;
};
type History = {
  supported: boolean; sync: Progress | null;
  reason?: string;
  backup: { files: number; logical_bytes: number; session_candidates: number; imported_messages: number;
    inventory_complete: boolean; inspected_at: string; header_counts: Record<string,number> } | null;
};
const states = {idle:"未開始",running:"取り込み中",paused:"一時停止",partial:"巡回終了・取得範囲は一部"};

export default function HistorySync() {
  const [data,setData]=useState<History|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result=await api<History>("/history");
        if(alive) { setData(result); setError(""); }
      } catch { if(alive) setError("履歴の取り込み状況を取得できません。接続を確認してください。"); }
      finally { if(alive) timer=setTimeout(refresh,5000); }
    }
    void refresh();
    return ()=>{alive=false;clearTimeout(timer);};
  },[]);
  async function control(action:"start"|"pause"|"resume") {
    setBusy(true);setError("");
    try {
      const result=await api<Progress>("/history",{action});
      setData(previous=>previous ? {...previous,sync:result}:previous);
    } catch(e) {setError(e instanceof Error?e.message:"取り込み操作に失敗しました。");}
    finally {setBusy(false);}
  }
  const sync=data?.sync;
  return <article className="settings-card" aria-label="過去履歴の取り込み">
    <div className="card-heading"><Archive size={21}/><h2>過去履歴の取り込み</h2></div>
    <p>{data?.reason==="ui_access_disabled" ? "画面経由の履歴取得は無効です。ファイルから直接読み込める方法を調査しています。" : "PC版WeChatにある会話を順番に開き、過去へスクロールして保存します。PCを操作するときは一時停止してください。"}</p>
    {sync ? <><p role="status">{states[sync.state]}{sync.state==="running" ? ` · ${sync.phase==="discovery"?"会話一覧を調べています":"過去のメッセージを読んでいます"}`:""}</p>
      <dl><div><dt>発見した会話候補</dt><dd>{sync.discovered.toLocaleString()}件</dd></div>
        <div><dt>巡回した会話</dt><dd>{sync.processed.toLocaleString()}件</dd></div>
        <div><dt>今回の読み取り済みメッセージ</dt><dd>{sync.saved.toLocaleString()}件</dd></div>
        <div><dt>同名・読み取り失敗</dt><dd>{(sync.ambiguous||0)+(sync.failed||0)}件</dd></div></dl>
      <div className="history-actions">
        {sync.state==="running" ? <button className="secondary" disabled={busy} onClick={()=>control("pause")}><Pause size={15}/>一時停止</button>
        : <>{sync.state==="paused" ? <button className="primary" disabled={busy} onClick={()=>control("resume")}><Play size={15}/>続きから再開</button>:null}
          <button className="secondary" disabled={busy} onClick={()=>control("start")}><RefreshCw size={15}/>{sync.state==="idle"?"PC内の会話・履歴を取り込む":"会話一覧から再確認"}</button></>}
      </div>
      {sync.error ? <p className="help">{sync.error==="history_scope_changed"?"WeChatの起動状態が変わりました。「会話一覧から再確認」で新しい範囲を読み取れます。":sync.error==="interrupted"?"アプリの再起動で停止しました。読み取り済みの履歴は保持しています。":"取得できない範囲があります。保存済み履歴は保持しています。"}</p>:null}</>:<p className="help">{data?.reason==="ui_access_disabled"?"新しい履歴は取り込んでいません。既存の保存済み履歴は保持しています。":data&&!data.supported?"この機能はPlus接続で利用できます。":"状況を確認しています…"}</p>}
    {data?.reason!=="ui_access_disabled" ? <><p className="help">取り込んだ会話は「保存履歴」と表示します。送信先の誤結合を防ぐためライブ会話とは自動統合せず、返信には監視中の会話を使います。過去履歴では通知・未読を増やしません。</p>
    <p className="help">一覧の末尾や読み取りの停止だけでは全履歴取得の証明になりません。監視外・折りたたみ・未表示の会話、削除済みの履歴、添付本体は取得できない場合があります。</p></>:null}
    {data?.backup ? <details><summary>バックアップの確認結果</summary><dl>
      <div><dt>会話候補のフォルダー</dt><dd>{data.backup.session_candidates.toLocaleString()}件</dd></div>
      <div><dt>ファイル数</dt><dd>{data.backup.files.toLocaleString()}件</dd></div>
      <div><dt>ファイルの論理サイズ</dt><dd>{(data.backup.logical_bytes/1024**3).toFixed(1)} GiB</dd></div>
      <div><dt>バックアップから本文を直接取得</dt><dd>{data.backup.imported_messages}件</dd></div></dl>
      <p className="help">専用形式のバックアップを検出しました。フォルダー数は読めた会話数ではありません。本文の直接取り込みには未対応です。{data.reason!=="ui_access_disabled" ? "スマートフォンの全履歴を、PC版の「聊天记录管理 → 导入聊天记录」でコピーしてから巡回してください。":"この画面ではバックアップの検査結果だけを表示しています。"}</p>
    </details>:null}
    {error ? <p role="alert" className="error-text">{error}</p>:null}
  </article>;
}
