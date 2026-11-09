"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Clock3, ListTodo, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import { api, AttentionItem, day, Priority, priorityLabels, priorityOrder, Task, time } from "@/lib/api";

type Actions = {
  onDraft: (item: AttentionItem, text: string) => void;
  onTask: (item: AttentionItem) => void;
  onSource: (chatId: string, messageId: number) => void;
};

export function PriorityBadge({item}: {item: AttentionItem}) {
  return <span className={`priority-badge priority-${item.priority}`}>{priorityLabels[item.priority]}{item.priority_origin === "manual" && " · 手動"}</span>;
}

function DraftOptions({item, onDraft}: Pick<Actions, "onDraft"> & {item: AttentionItem}) {
  return <div className="draft-options"><p className="assist-caption">定型の返信案です。内容に合わせて編集してください。</p>{item.suggestions.map(s => <div className="draft-option" key={s.label}><strong>{s.label}</strong><p>{s.text}</p><button className="secondary" onClick={() => onDraft(item, s.text)}><Plus size={14}/>下書きに入れる</button></div>)}</div>;
}

export function ReplySupport({item, task, onDraft, onTask, onSource}: Actions & {item: AttentionItem; task?: Task}) {
  if (!item.source_message_id) return null;
  return <details className="reply-support"><summary><Sparkles size={15}/><span>返信・次の行動を考える</span><PriorityBadge item={item}/><ChevronDown size={14}/></summary><div className="reply-support-body"><p className="assist-caption">AI未接続 · 取得済みの直近50件を使う簡易判定</p><p className="assist-reason">{item.reasons[0]}</p><button className="source-link" onClick={() => onSource(item.chat_id, item.source_message_id!)}>参照したメッセージへ <ArrowUpRight size={13}/></button>{item.state === "review_send" ? <p className="assist-reason">送信キューの状態を確認してください。確認不能のメッセージは自動再送しません。</p> : <DraftOptions item={item} onDraft={onDraft}/>}<button className="secondary task-add" disabled={!!task} onClick={() => onTask(item)}><ListTodo size={15}/>{task ? "タスクに追加済み" : "タスク候補を確認"}</button></div></details>;
}

export function AttentionCenter({items, tasks, loading, available, onPriority, onDraft, onTask, onSource}: Actions & {
  items: AttentionItem[]; tasks: Task[]; loading: boolean; available: boolean;
  onPriority: (chatId: string, priority: Priority | "auto") => Promise<void>;
}) {
  const [sort, setSort] = useState("priority");
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const candidates = items.filter(i => i.state !== "no_candidate");
  const tasksBySource = new Map(tasks.map(task => [task.source_message_id, task]));
  const ordered = (all ? [...items] : [...candidates]).sort((a, b) => (sort === "priority" ? priorityOrder[a.priority] - priorityOrder[b.priority] : 0) || (b.source_at || "").localeCompare(a.source_at || ""));
  async function changePriority(chatId: string, value: Priority | "auto") {
    setSaving(chatId);
    try { await onPriority(chatId, value); } finally { setSaving(null); }
  }
  return <section className="content-page attention-page" aria-label="対応すること"><div className="attention-intro"><div><span className="eyebrow">A LITTLE CLARITY, EVERY DAY</span><h1>会話を、次の一歩へ。</h1><p>いま返す言葉と、あとでやることを整理しましょう。</p></div><span className="assist-mode"><Sparkles size={14}/>AI未接続 · 簡易ルールでプレビュー</span></div>
    <div className="attention-summary"><div><span>返信・確認の候補</span><strong>{candidates.length}<small>件</small></strong></div><div><span>優先して確認</span><strong>{candidates.filter(i => i.priority === "high").length}<small>件</small></strong></div><div><span>未完了のタスク</span><strong>{tasks.filter(t => t.status === "open").length}<small>件</small></strong></div></div>
    <div className="attention-toolbar"><div className="segmented"><button aria-pressed={!all} onClick={() => setAll(false)}>返信・確認の候補</button><button aria-pressed={all} onClick={() => setAll(true)}>すべての会話</button></div><label>並び順<select aria-label="対応することの並び順" value={sort} onChange={e => setSort(e.target.value)}><option value="priority">返信の優先度</option><option value="recent">受信の新しい順</option></select></label></div>
    <p className="attention-scope">未読と返信の必要性は別に扱います。取得済みの直近50件からの候補で、優先度は変更できます。</p>
    {!available && <p className="assist-reason">PCとの接続を確認してください。表示中の候補は最新ではない可能性があります。</p>}
    {loading ? <div className="list-empty">会話を整理しています…</div> : <div className="attention-cards">{ordered.map(item => {
      const task = item.source_message_id ? tasksBySource.get(item.source_message_id) : undefined;
      return <article className="attention-card" key={item.chat_id} data-testid={`attention-${item.chat_id}`}><div className="attention-card-head"><span className="attention-avatar">{item.chat_name.slice(0, 1)}</span><div><h2>{item.chat_name}</h2><span>{item.chat_type === "group" ? "グループ · 自分宛てか要確認" : "個人チャット"}{item.source_at && ` · ${day(item.source_at)} ${time(item.source_at)}`}</span></div><PriorityBadge item={item}/></div>
        <blockquote>{item.source_content || "取得済みの受信メッセージはありません。"}</blockquote>
        <div className="attention-reasons"><span>{item.state === "review_send" ? "送信状態を要確認" : item.state === "reply_candidate" ? "返信の候補" : "手動で確認"}</span><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
        <div className="attention-actions"><button className="primary" disabled={!item.suggestions.length} aria-expanded={expanded === item.chat_id} onClick={() => setExpanded(expanded === item.chat_id ? null : item.chat_id)}><Sparkles size={15}/>返信案を見る</button><button className="secondary" disabled={!item.source_message_id || !!task || !available} onClick={() => onTask(item)}><ListTodo size={15}/>{task ? "タスクに追加済み" : "タスク候補を確認"}</button>{item.source_message_id && <button className="source-link" onClick={() => onSource(item.chat_id, item.source_message_id!)}><MessageCircle size={14}/>会話を確認</button>}</div>
        {expanded === item.chat_id && <DraftOptions item={item} onDraft={onDraft}/>}
        <label className="priority-control">優先度を調整<select aria-label={`${item.chat_name}の優先度`} disabled={saving !== null || !available} value={item.priority_origin === "manual" ? item.priority : "auto"} onChange={e => void changePriority(item.chat_id, e.target.value as Priority | "auto")}><option value="auto">簡易判定に任せる</option><option value="high">優先</option><option value="normal">通常</option><option value="low">あとで</option></select></label>
      </article>;
    })}</div>}
    {!loading && ordered.length === 0 && <div className="attention-empty"><Check size={28}/><h2>今の範囲では、候補はありません。</h2><p>未取得の会話や、簡易判定で見落とした依頼がないかも確認してください。</p></div>}
  </section>;
}

export function TaskComposer({item, onClose, onSaved, onError}: {
  item: AttentionItem; onClose: () => void; onSaved: () => void; onError: (error: unknown) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [title, setTitle] = useState(item.task_title || "");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !title.trim()) return;
    submitting.current = true; setBusy(true); setError("");
    try { await api("/tasks", {chat_id: item.chat_id, source_message_id: item.source_message_id, title, due_date: due || null, client_request_id: requestId}); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした。"); onError(e); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <dialog className="task-dialog" ref={dialog} aria-labelledby="task-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={save}><header><span className="eyebrow">FROM CONVERSATION TO ACTION</span><button type="button" className="icon-button" aria-label="タスク候補を閉じる" disabled={busy} onClick={onClose}><X size={19}/></button></header><h2 id="task-dialog-title">次にやることを、タスクに。</h2><p className="assist-caption">候補を確認してから、このPCに保存します。</p><div className="task-source"><strong>{item.chat_name}</strong><blockquote>{item.source_content}</blockquote></div><label>タスク名<input aria-label="タスク名" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required disabled={busy} autoFocus/></label><label>期限（任意）<input aria-label="タスクの期限" type="date" value={due} onChange={e => setDue(e.target.value)} disabled={busy}/></label><p className="assist-caption">期限は自動確定しません。元の会話を確認して指定してください。</p>{error && <p className="error-text" role="alert">{error}</p>}<footer><button className="secondary" type="button" onClick={onClose} disabled={busy}>キャンセル</button><button className="primary" disabled={busy || !title.trim()}><Plus size={16}/>{busy ? "保存中…" : "タスクに追加"}</button></footer></form></dialog>;
}

export function TaskList({tasks, available, onState, onSource}: {
  tasks: Task[]; available: boolean; onState: (task: Task) => Promise<void>; onSource: Actions["onSource"];
}) {
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [busy, setBusy] = useState<string | null>(null);
  async function toggle(task: Task) { setBusy(task.id); try { await onState(task); } finally { setBusy(null); } }
  const filtered = tasks.filter(t => t.status === filter);
  return <section className="content-page tasks-page"><div className="page-heading"><span className="eyebrow">SMALL STEPS, CLEAR MIND</span><h1>会話から生まれたタスク</h1><p>元の言葉をすぐに確認。終わったら、ひとつずつ完了に。</p></div><div className="segmented"><button aria-pressed={filter === "open"} onClick={() => setFilter("open")}>未完了 {tasks.filter(t => t.status === "open").length}</button><button aria-pressed={filter === "done"} onClick={() => setFilter("done")}>完了 {tasks.filter(t => t.status === "done").length}</button></div><p className="attention-scope">このアプリ内のタスクです。期限が早い順に表示します。外部のタスクサービスとは未連携です。</p><div className="task-list">{filtered.map(task => <article className={`task-row ${task.status}`} key={task.id}><button className="task-toggle" aria-label={`${task.status === "open" ? "完了にする" : "未完了に戻す"}：${task.title}`} aria-pressed={task.status === "done"} disabled={!available || busy !== null} onClick={() => void toggle(task)}>{task.status === "done" && <Check size={17}/>}</button><div><h2>{task.title}</h2><div className="task-meta"><span>{task.chat_name}</span><span><Clock3 size={12}/>{task.due_date ? `${task.due_date.replaceAll("-", "/")} まで` : "期限なし"}</span></div><blockquote>{task.source_content}</blockquote><button className="source-link" onClick={() => onSource(task.chat_id, task.source_message_id)}>元のメッセージへ<ArrowUpRight size={13}/></button></div></article>)}</div>{filtered.length === 0 && <div className="attention-empty"><ListTodo size={30}/><h2>{filter === "open" ? "未完了のタスクはありません。" : "完了したタスクはまだありません。"}</h2><p>「対応すること」や会話の返信サポートから、候補を確認して追加できます。</p></div>}</section>;
}
