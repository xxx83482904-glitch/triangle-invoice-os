"use client";

import { useEffect, useRef, useState } from "react";
import { ScanText, ShieldCheck } from "lucide-react";
import { api, ApiError, Chat } from "@/lib/api";

type Preview = { id: string; image: string; width: number; height: number; expires_in: number; lines: {id: number; text: string; box: number[]}[] };
type ImportBody = { preview_id: string; line_ids: number[]; chat_id: string | null; expected_external_id: string | null; chat_name: string; chat_type: "individual" | "group"; content: string; sender_name: string; direction: "incoming" | "outgoing"; reviewed: true; client_request_id: string };
type Receipt = {chat_id: string; message_id: number; duplicate: boolean};

export default function OcrImport({mode, chats, onSaved, onOpen, onError}: {mode?: string; chats: Chat[]; onSaved: () => Promise<void>; onOpen: (id: string) => void; onError: (error: unknown) => void}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [language, setLanguage] = useState("ja");
  const [delay, setDelay] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"individual" | "group">("individual");
  const [sender, setSender] = useState("送信者不明");
  const [direction, setDirection] = useState<"" | "incoming" | "outgoing">("");
  const [content, setContent] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<ImportBody | null>(null);
  const locked = useRef(false);
  const importedChats = chats.filter(c => c.external_id.startsWith("ocr:"));
  const existing = importedChats.find(c => c.id === target);
  const frozen = busy || pending !== null;

  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => { setPreview(null); setSelected([]); setContent(""); setReviewed(false); setMessage("読み取り結果の保存期限（5分）が過ぎました。もう一度読み取ってください。"); }, preview.expires_in * 1000);
    return () => clearTimeout(timer);
  }, [preview]);

  function report(error: unknown) {
    setMessage(error instanceof Error ? error.message : "処理できませんでした。");
    if (error instanceof ApiError && error.status === 401) onError(error);
  }
  async function capture() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(""); setSaved(null);
    setPreview(null); setSelected([]); setContent(""); setReviewed(false);
    try { setPreview(await api<Preview>("/wechat/ocr/preview", {language, delay})); }
    catch (error) { report(error); }
    finally { locked.current = false; setBusy(false); }
  }
  function chooseLine(id: number) {
    const next = selected.includes(id) ? selected.filter(i => i !== id) : [...selected, id].sort((a, b) => a - b);
    setSelected(next); setContent(preview?.lines.filter(line => next.includes(line.id)).map(line => line.text).join("\n") ?? ""); setReviewed(false);
  }
  async function save() {
    if (locked.current || (!pending && (!preview || !reviewed || !direction))) return;
    const body: ImportBody = pending ?? { preview_id: preview!.id, line_ids: selected, chat_id: target || null, expected_external_id: existing?.external_id ?? null, chat_name: existing?.name ?? name.trim(), chat_type: existing?.type ?? type, content: content.trim(), sender_name: sender.trim(), direction: direction as "incoming" | "outgoing", reviewed: true, client_request_id: crypto.randomUUID() };
    locked.current = true; setBusy(true); setPending(body); setMessage("");
    try {
      const receipt = await api<Receipt>("/wechat/ocr/import", body);
      setPending(null); setSaved(receipt); setTarget(receipt.chat_id); setSelected([]); setContent(""); setReviewed(false);
      setMessage(receipt.duplicate ? "この内容は保存済みです。重複登録していません。" : "確認したメッセージを保存しました。WeChatへの送信は行っていません。");
      await onSaved();
    } catch (error) {
      report(error);
      if (error instanceof ApiError && error.status < 500) setPending(null);
      else setMessage("保存結果を確認できません。同じ受付IDで再確認してください。");
    } finally { locked.current = false; setBusy(false); }
  }

  return <article className="settings-card ocr-import">
    <div className="card-heading"><ScanText size={21}/><h2>画面から取り込む</h2><span className="sync-label">手動OCR · 試験機能</span></div>
    <p>PCのWeChatで会話を開いてください。最小化せず、PCのロックを解除した状態で使用します。そのウィンドウに見える文字をPC内で読み取ります。自動同期ではありません。</p>
    {mode !== "windows-ocr" ? <p>現在は{mode === "mock" ? "Mock" : "UIA診断"}モードです。実データを分けて保存するため、Windowsの設定で「windows-ocr」に切り替えると使用できます。</p> : <>
      <div className="ocr-controls"><label>読み取り言語<select aria-label="OCRの言語" value={language} disabled={frozen} onChange={e => setLanguage(e.target.value)}><option value="ja">日本語</option><option value="zh-Hans-CN">中国語（簡体字）</option><option value="en-US">英語</option></select></label><label>読み取り開始<select aria-label="読み取りの待ち時間" value={delay} disabled={frozen} onChange={e => setDelay(Number(e.target.value))}><option value={0}>すぐ（携帯から操作）</option><option value={3}>3秒後（PCでWeChatに切替）</option></select></label></div>
      <button className="secondary" disabled={frozen} onClick={() => void capture()}><ScanText size={16}/>{busy && !pending ? "WeChatを読み取っています…" : "表示中のWeChatを読み取る"}</button>
      {message && <p role="status" className="assist-reason">{message}</p>}
      {saved && <button className="secondary" onClick={() => onOpen(saved.chat_id)}>保存した会話を開く</button>}
      {pending && !busy && <button className="secondary" onClick={() => void save()}>保存結果を確認・再試行</button>}
      {preview && <div className="ocr-review">
        <details><summary>読み取った画面を確認</summary><img src={preview.image} alt="今回読み取ったWeChat画面。保存前に会話と本文を照合してください。" className="ocr-snapshot"/></details>
        <h3>1. メッセージ1件の本文を選ぶ</h3><p>複数行は1件として保存します。名前・日時・会話一覧の文字を含めないでください。選び直すと本文の編集内容が置き換わります。</p>
        <fieldset disabled={frozen} className="ocr-lines"><legend className="sr-only">読み取った文字</legend>{preview.lines.map(line => <label key={line.id}><input type="checkbox" checked={selected.includes(line.id)} onChange={() => chooseLine(line.id)} disabled={!selected.includes(line.id) && selected.length >= 30}/><span>{line.text}</span></label>)}</fieldset>
        <h3>2. 保存先と内容を確認する</h3>
        <fieldset disabled={frozen} className="ocr-fields"><legend className="sr-only">取り込むメッセージの確認</legend>
          <label>保存先の会話<select aria-label="OCRの保存先" value={target} onChange={e => {setTarget(e.target.value); setReviewed(false);}}><option value="">新しい会話として保存</option>{importedChats.map(c => <option key={c.id} value={c.id}>{c.name}（{c.type === "group" ? "グループ" : "個人"}） · {c.id.slice(0, 6)}</option>)}</select></label>
          {!target && <div className="ocr-controls"><label>会話名<input aria-label="取り込む会話名" value={name} maxLength={100} onChange={e => {setName(e.target.value); setReviewed(false);}}/></label><label>会話の種類<select aria-label="取り込む会話の種類" value={type} onChange={e => {setType(e.target.value as "individual" | "group"); setReviewed(false);}}><option value="individual">個人</option><option value="group">グループ</option></select></label></div>}
          <div className="ocr-controls"><label>送受信<select aria-label="取り込むメッセージの方向" value={direction} onChange={e => {setDirection(e.target.value as typeof direction); setSender(e.target.value === "outgoing" ? "自分（手動指定）" : "送信者不明"); setReviewed(false);}}><option value="">選択してください</option><option value="incoming">相手からの受信</option><option value="outgoing">自分の発言</option></select></label><label>送信者名<input aria-label="取り込む送信者名" value={sender} maxLength={100} onChange={e => {setSender(e.target.value); setReviewed(false);}}/></label></div>
          <label>本文（誤認識を修正）<textarea aria-label="取り込む本文" value={content} maxLength={4000} rows={4} onChange={e => {setContent(e.target.value); setReviewed(false);}}/></label>
          <p>正確な日時とWeChat IDは取得しません。同名の会話を自動で結合しません。同じ文章の再投稿は重複として扱われる場合があります。</p>
          <label className="ocr-confirm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/><span>画面と照合し、会話・本文・方向・送信者を確認しました</span></label>
        </fieldset>
        <button className="secondary" disabled={frozen || !reviewed || !selected.length || !direction || !content.trim() || content.length > 4000 || !sender.trim() || !(existing || (!target && name.trim()))} onClick={() => void save()}>確認した1件を保存</button>
      </div>}
    </>}
    <p className="inline"><ShieldCheck size={15}/>画像はファイルに保存しません。読み取り結果の保存期限は5分です。確認した本文と会話情報だけがこのPCに残ります。実送信は無効です。</p>
  </article>;
}
