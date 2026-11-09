"use client";

import { useEffect, useRef, useState } from "react";
import { Languages, LoaderCircle, Sparkles, X } from "lucide-react";
import { api, Chat, Message } from "@/lib/api";
import type { TaskSeed } from "./attention-center";

type Operation = "translate" | "reply" | "summarize" | "tasks";
type AIStatus = {ready: boolean; enabled: boolean; configured: boolean; provider: string; model: string | null};
type Preview = {id: string; ready: boolean; provider: string; model: string | null; instructions: string; payload: {messages: {index: number; role: string; content: string}[]; draft?: string; user_instruction?: string; target_language: string; task: string}; characters: number};
type AIJob = {id: string; chat_id: string; operation: Operation; provider: string; status: "processing" | "completed" | "failed" | "unknown"; error_code: string | null; source_message_ids: number[]; source_draft?: string | null; result: null | {text?: string; candidates?: string[]; summary?: string; decisions?: string[]; tasks?: {title: string; source_message_id: number; due_date: string | null}[]}};
type Props = {chat: Chat; messages: Message[]; draft: string; onDraft: (text: string) => boolean; onTask: (seed: TaskSeed) => void};
const labels: Record<Operation, string> = {translate: "翻訳", reply: "返信案", summarize: "要約・決定事項", tasks: "タスク候補"};
const jobErrors: Record<string, string> = {
  ai_provider_rejected: "AIサービスがリクエストを受け付けませんでした。PC側のモデル・キー・利用上限を確認してください。",
  ai_result_unknown: "結果を確認できません。自動で再実行しません。",
  ai_invalid_response: "AIの応答を検証できませんでした。下書き・タスクには反映していません。",
  ai_incomplete_response: "AIの応答が完了しませんでした。自動で再実行しません。",
  ai_refused: "AIから生成結果を取得できませんでした。",
};

export function AISettings() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  useEffect(() => { let active = true; api<AIStatus>("/ai/status").then(data => { if (active) setStatus(data); }).catch(() => {}); return () => { active = false; }; }, []);
  return <article className="settings-card"><div className="card-heading"><Sparkles size={21}/><h2>AIアシスト</h2></div><p>{status?.ready ? "実行できる設定があります。会話のAIボタンから、送る内容を確認して実行します。" : "外部AIは未設定または無効です。設定するまでは、会話の本文を外部AIへ送りません。"}</p><p className="help">PC側の環境変数でAPIキー・モデル・有効化を設定します。キーはブラウザに渡しません。APIの利用料金は別途かかります。</p>{status?.model && <p className="help">設定モデル：{status.model}（設定だけでは疎通確認済みではありません）</p>}<p className="help">優先度の並び替えは引き続き端末内の簡易ルールです。翻訳・返信案・要約・タスク抽出は、選択した本文だけを送る独立した機能です。</p></article>;
}

export default function AISupport(props: Props) {
  const [open, setOpen] = useState(false);
  return <><button className="ai-launch" aria-label="AIアシストを開く" onClick={() => setOpen(true)}><Sparkles size={17}/><span>AI</span></button>{open && <AIDialog {...props} onClose={() => setOpen(false)}/>}</>;
}

function AIDialog({chat, messages, draft, onDraft, onTask, onClose}: Props & {onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const [operation, setOperation] = useState<Operation>("translate");
  const [source, setSource] = useState("message");
  const [ids, setIds] = useState<number[]>(() => { const last = [...messages].reverse().find(m => m.direction === "incoming" && ["text","ocr_text"].includes(m.message_type)); return last ? [last.id] : []; });
  const [target, setTarget] = useState("ja");
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<AIJob | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [recoverId, setRecoverId] = useState<string | null>(null);
  const [recent, setRecent] = useState<AIJob[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const selectedDraft = operation === "translate" && source === "draft";
  const body = {chat_id:chat.id, operation, message_ids:selectedDraft ? [] : ids, draft:selectedDraft ? draft : "", target_language:target, instruction};
  const bodyKey = JSON.stringify(body);
  const previewCurrent = preview && snapshot === bodyKey;
  const processing = busy || !!pollingId;

  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    Promise.all([api<AIStatus>("/ai/status"), api<AIJob[]>(`/ai/chats/${chat.id}/jobs`)]).then(([config, jobs]) => {
      if (!alive.current) return;
      setStatus(config); setRecent(jobs);
      const pending = jobs.find(item => item.status === "processing");
      if (pending) { setJob(pending); setPollingId(pending.id); }
    }).catch(() => { if (alive.current) setError("AIの設定を取得できませんでした。"); });
    return () => { alive.current = false; dialog.current?.close(); };
  }, [chat.id]);

  useEffect(() => {
    if (!pollingId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<AIJob>(`/ai/jobs/${pollingId}`);
        if (cancelled) return;
        setJob(next); setRecoverId(null);
        if (next.status === "processing") timer = setTimeout(poll, 1200);
        else { setPollingId(null); setRecent(rows => [next, ...rows.filter(r => r.id !== next.id)].slice(0,10)); }
      } catch {
        if (!cancelled) { setRecoverId(pollingId); setPollingId(null); setError("受付結果を取得できません。再実行せず、結果だけを確認できます。"); }
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pollingId]);

  async function prepare() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setApproved(false); setPreview(null); setJob(null); setRecoverId(null); setNotice("");
    try { const next = await api<Preview>("/ai/preview", body); if (alive.current) { setPreview(next); setSnapshot(bodyKey); } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "送信内容を準備できませんでした。"); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function execute() {
    if (!previewCurrent || !approved || !preview.ready || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice(""); setShowOriginal(false);
    try {
      const next = await api<AIJob>(`/ai/${operation}`, {preview_id:preview.id, approved:true});
      if (alive.current) { setJob(next); setPollingId(next.status === "processing" ? next.id : null); }
    } catch (e) {
      if (alive.current) { setRecoverId(preview.id); setError(e instanceof Error ? e.message : "受付結果が不明です。結果だけを確認してください。"); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function changeOperation(next: Operation) {
    setOperation(next); setPreview(null); setApproved(false); setJob(null); setRecoverId(null); setError("");
    setTarget(next === "reply" ? "zh" : "ja");
    if (next === "translate") setIds(values => values.slice(-1));
  }
  const original = job?.operation === "translate" && job.source_message_ids.length === 1 ? messages.find(m => m.id === job.source_message_ids[0])?.content : job?.source_draft;
  function draftResult(text: string) {
    if (onDraft(text)) setNotice("下書きに追加しました。会話の入力欄で確認・編集してから送信してください。");
    else setError("合計4,000文字を超えるため追加できません。会話の下書きを整理してください。");
  }
  return <dialog ref={dialog} className="ai-dialog" aria-labelledby="ai-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}><div className="ai-dialog-body">
    <header><div><span className="eyebrow">WORDS WITH A LITTLE HELP</span><h2 id="ai-dialog-title">AIアシスト</h2></div><button className="icon-button" aria-label="AIアシストを閉じる" onClick={onClose}><X size={20}/></button></header>
    <p className="ai-chat-name">{chat.name} <span>· 選択した履歴のみ</span></p>
    <p className="ai-provider-note">{status?.provider === "synthetic_test" ? "テスト応答です。外部AIには送信しません。" : status?.ready ? `OpenAI · ${status.model}` : "外部AIは未設定または無効です。送る内容の確認までは利用できます。"}</p>
    <div className="ai-operations">{(Object.keys(labels) as Operation[]).map(key => <button key={key} aria-pressed={operation === key} disabled={processing} onClick={() => changeOperation(key)}>{labels[key]}</button>)}</div>
    <fieldset disabled={processing}><legend>参照する内容</legend>
      {operation === "translate" && <div className="ai-source-options"><label><input type="radio" name="ai-source" checked={source === "message"} onChange={() => {setSource("message"); setApproved(false);}}/>メッセージ</label><label><input type="radio" name="ai-source" checked={source === "draft"} onChange={() => {setSource("draft"); setTarget("zh"); setApproved(false);}}/>入力中の下書き</label></div>}
      {selectedDraft ? <blockquote className="ai-original">{draft || "会話の入力欄に日本語の下書きを入力してください。"}</blockquote> : <div className="ai-message-picker">{messages.filter(m => ["text","ocr_text"].includes(m.message_type)).slice(-20).map(message => <label key={message.id}><input type="checkbox" aria-label={`AIに含めるメッセージ ${message.id}`} checked={ids.includes(message.id)} disabled={!ids.includes(message.id) && ids.length >= (operation === "translate" ? 1 : 10)} onChange={event => {setIds(current => event.target.checked ? [...current,message.id] : current.filter(id=>id!==message.id)); setApproved(false);}}/><span><small>{message.direction === "incoming" ? "受信" : "自分"}{message.message_type === "ocr_text" && " · OCR確認済み"}</small>{message.content}</span></label>)}</div>}
      <p className="help">{selectedDraft ? "入力中の下書きだけを使います。" : `${ids.length}件を選択。最大${operation === "translate" ? 1 : 10}件 / 合計12,000文字。未取得の履歴は含みません。`}</p>
      {(operation === "translate" || operation === "reply") && <label className="ai-field">出力言語<select aria-label="AIの出力言語" value={target} onChange={e=>{setTarget(e.target.value);setApproved(false);}}><option value="ja">日本語</option><option value="zh">中国語</option></select></label>}
      <label className="ai-field">希望する表現・補足（任意）<textarea aria-label="AIへの補足" value={instruction} maxLength={500} rows={2} onChange={e=>{setInstruction(e.target.value);setApproved(false);}} placeholder="例：丁寧で短い返事にする"/></label>
    </fieldset>
    <button className="secondary" disabled={processing || (selectedDraft ? !draft.trim() : ids.length === 0)} onClick={() => void prepare()}><Languages size={16}/>送る内容を確認</button>
    {preview && <section className="ai-preview" aria-label="AIに送る内容"><h3>実行前の確認</h3><p className="help">会話名・送信者名・外部IDは項目として送りません。本文に書かれている名前などは残ります。必要なら対象を減らしてください。</p>{preview.payload.messages.map(item=><blockquote key={item.index}><small>{item.role === "self" ? "自分" : "相手"}</small>{item.content}</blockquote>)}{preview.payload.draft && <blockquote>{preview.payload.draft}</blockquote>}{preview.payload.user_instruction && <p>補足：{preview.payload.user_instruction}</p>}<details><summary>送信するデータの詳細</summary><pre>{JSON.stringify(preview.payload,null,2)}</pre><p className="help">共通指示：{preview.instructions}</p></details><p className="help">{preview.characters}文字。確認内容は5分で期限切れになります。OpenAI側の保存・保持条件は契約と設定に従います。</p>{!previewCurrent && <p className="error-text">選択または下書きが変わりました。送る内容を確認し直してください。</p>}<label className="ai-consent"><input type="checkbox" checked={approved} disabled={!previewCurrent || processing} onChange={e=>setApproved(e.target.checked)}/>{preview.provider === "synthetic_test" ? "テスト用の内容を確認しました" : "この内容をOpenAIへ送り、生成を実行することを確認しました"}</label><button className="primary" disabled={!approved || !previewCurrent || !preview.ready || processing} onClick={() => void execute()}><Sparkles size={16}/>{preview.provider === "synthetic_test" ? "テスト生成を実行" : "確認してAIを実行"}</button></section>}
    {processing && <p className="inline" role="status"><LoaderCircle size={16} className="spin"/>結果を待っています。閉じても処理は続き、後で結果を確認できます。</p>}
    {recoverId && <button className="secondary" onClick={() => {setError("");setPollingId(recoverId);}}>AIの受付結果だけを確認</button>}
    {error && <p className="error-text" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {job && job.status !== "processing" && <section className="ai-result" aria-label="AIの結果"><h3>{labels[job.operation]}の結果</h3><p className="help">{job.provider === "synthetic_test" ? "合成データによるテスト結果です。" : "AIの生成結果です。事実や表現は必ず確認してください。"}</p>{job.status !== "completed" ? <p role="alert">{jobErrors[job.error_code || ""] || "生成結果を取得できませんでした。自動で再実行しません。"}</p> : <>
      {job.result?.text && <><div className="ai-operations"><button aria-pressed={!showOriginal} onClick={()=>setShowOriginal(false)}>訳文</button><button disabled={!original} aria-pressed={showOriginal} onClick={()=>setShowOriginal(true)}>原文</button></div><blockquote>{showOriginal ? original : job.result.text}</blockquote><button className="secondary" onClick={()=>draftResult(job.result!.text!)}>訳文を下書きに追加</button></>}
      {job.result?.candidates?.map((text,index)=><div key={index}><blockquote>{text}</blockquote><button className="secondary" onClick={()=>draftResult(text)}>返信案{index+1}を下書きに追加</button></div>)}
      {job.result?.summary && <><p className="ai-summary">{job.result.summary}</p><h4>決定事項</h4>{job.result.decisions?.length ? <ul>{job.result.decisions.map((text,index)=><li key={index}>{text}</li>)}</ul> : <p>確認できる決定事項はありません。</p>}</>}
      {job.result?.tasks && (job.result.tasks.length ? job.result.tasks.map((task,index)=>{const message=messages.find(m=>m.id===task.source_message_id);return <div key={index}><h4>{task.title}</h4><p className="help">期限候補：{task.due_date || "不明・未指定"}</p><blockquote>{message?.content || "元のメッセージを読み込んでから追加してください。"}</blockquote><button className="secondary" disabled={!message} onClick={()=>{onTask({chat_id:chat.id,chat_name:chat.name,source_message_id:task.source_message_id,source_content:message!.content,task_title:task.title,due_date:task.due_date});onClose();}}>タスク内容を確認</button></div>;}) : <p>タスクの候補はありません。</p>)}
    </>}</section>}
    {recent.length>0 && <details className="ai-recent"><summary>この会話の生成履歴</summary>{recent.map(item=><button key={item.id} className="secondary" onClick={()=>{setJob(item);setShowOriginal(false);if(item.status==="processing")setPollingId(item.id);}}>{labels[item.operation]} · {item.status === "completed" ? "生成済み" : item.status === "processing" ? "処理中" : "結果を要確認"}</button>)}</details>}
    <p className="help">生成でメッセージは送信されません。タスクも自動登録されません。APIの応答が不明でも自動で再実行しません。</p>
  </div></dialog>;
}
