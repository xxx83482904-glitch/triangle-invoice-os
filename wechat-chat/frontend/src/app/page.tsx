"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, CheckCheck, ChevronRight, CircleAlert, FlaskConical, Leaf, LoaderCircle, LockKeyhole, LogOut, MessageCircle, Moon, RefreshCw, Search, Settings, ShieldCheck, Sun, Users, Wifi, WifiOff, X } from "lucide-react";
import { api, ApiError, Chat, day, delivery, Message, QueueItem, Status, time } from "@/lib/api";
import MobileInstall from "@/components/mobile-install";

type View = "chats" | "search" | "settings";
type PageData = { messages: Message[]; has_more: boolean };
type Uncertain = { chatId: string; requestId: string; content: string };

function Avatar({ chat, small = false }: { chat: Pick<Chat, "name" | "type" | "external_id">; small?: boolean }) {
  const color = [...chat.external_id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5;
  return <span className={`avatar tone-${color} ${small ? "small" : ""}`} aria-hidden="true">{chat.type === "group" ? <Users size={small ? 18 : 23} strokeWidth={1.6} /> : chat.name.replaceAll(" ", "").slice(0, 1)}</span>;
}

export default function Home() {
  const [auth, setAuth] = useState<"loading" | "locked" | "ready">("loading");
  const [token, setToken] = useState("");
  const [view, setView] = useState<View>("chats");
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [olderView, setOlderView] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [wsState, setWsState] = useState<"connecting" | "live" | "offline">("connecting");
  const [reachable, setReachable] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [listQuery, setListQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [theme, setTheme] = useState("system");
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const mobileOpenRef = useRef(false);
  const viewRef = useRef<View>("chats");
  const olderRef = useRef(false);
  const loadingGeneration = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const submitLock = useRef(false);
  const chat = chats.find(c => c.id === selected);
  const connected = reachable && status?.state === "connected";
  const sendEnabled = connected && status?.can_send && wsState === "live";
  const unread = chats.reduce((sum, c) => sum + c.unread_count, 0);
  const draft = selected ? drafts[selected] || "" : "";

  useEffect(() => {
    // iOS's keyboard resizes the visual viewport, not always the layout viewport.
    const viewport = window.visualViewport;
    const update = () => document.documentElement.style.setProperty("--app-height", `${viewport?.height ?? window.innerHeight}px`);
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => { viewport?.removeEventListener("resize", update); window.removeEventListener("resize", update); document.documentElement.style.removeProperty("--app-height"); };
  }, []);

  const report = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setAuth("locked"); setMessages([]); setChats([]); setQueue([]); setResults([]); setDrafts({}); setSelected(null); selectedRef.current = null; }
    setError(e instanceof Error ? e.message : "接続状態を確認してください。");
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const generation = ++loadingGeneration.current;
    const data = await api<PageData>(`/chats/${id}/messages`);
    if (selectedRef.current !== id || generation !== loadingGeneration.current || olderRef.current) return;
    setMessages(data.messages); setHasMore(data.has_more);
    if (viewRef.current === "chats" && (window.innerWidth > 760 || mobileOpenRef.current) && document.visibilityState === "visible" && data.messages.length) {
      const through = data.messages[data.messages.length - 1].id;
      await api(`/chats/${id}/read`, { through_id: through });
      setChats(items => items.map(item => item.id === id ? { ...item, unread_count: 0 } : item));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextChats, nextStatus, nextQueue] = await Promise.all([api<Chat[]>("/chats"), api<Status>("/status"), api<QueueItem[]>("/queue")]);
      setChats(nextChats); setStatus(nextStatus); setQueue(nextQueue); setReachable(true);
      if (selectedRef.current && !olderRef.current) await loadMessages(selectedRef.current);
    } catch (e) { setReachable(false); if (e instanceof ApiError && e.status === 401) report(e); }
  }, [loadMessages, report]);

  useEffect(() => {
    api<Status>("/status").then(value => { setStatus(value); setAuth("ready"); }).catch(e => { setAuth("locked"); if (!(e instanceof ApiError)) setError("バックエンドに接続できません。起動状態を確認してください。"); });
    const saved = localStorage.getItem("komorebi-theme") || "system"; setTheme(saved);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? query.matches ? "dark" : "light" : theme; };
    apply(); localStorage.setItem("komorebi-theme", theme); query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    if (auth !== "ready") return;
    let disposed = false; let socket: WebSocket | null = null; let reconnect: ReturnType<typeof setTimeout>; let refreshTimer: ReturnType<typeof setTimeout>; let lastHeartbeat = Date.now();
    const schedule = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (!disposed) void refresh(); }, 100); };
    const connect = () => {
      if (disposed) return;
      setWsState("connecting");
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.onopen = () => { if (!disposed) { lastHeartbeat = Date.now(); setWsState("live"); schedule(); } };
      socket.onmessage = event => { lastHeartbeat = Date.now(); const data = JSON.parse(event.data); if (data.type !== "heartbeat" && data.type !== "read") schedule(); if (data.type === "read") api<Chat[]>("/chats").then(setChats).catch(() => {}); };
      socket.onclose = () => { if (!disposed) { setWsState("offline"); schedule(); reconnect = setTimeout(connect, 2500); } };
      socket.onerror = () => socket?.close();
    };
    void refresh(); connect();
    const interval = setInterval(() => { if (Date.now() - lastHeartbeat > 15000) { setWsState("offline"); socket?.close(); } void refresh(); }, 10000);
    const onVisibility = () => { if (!document.hidden) { void refresh(); if (socket?.readyState === WebSocket.CLOSED) { clearTimeout(reconnect); connect(); } } };
    const offline = () => { setReachable(false); setWsState("offline"); };
    document.addEventListener("visibilitychange", onVisibility); window.addEventListener("offline", offline); window.addEventListener("online", onVisibility);
    return () => { disposed = true; clearTimeout(reconnect); clearTimeout(refreshTimer); clearInterval(interval); socket?.close(); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("offline", offline); window.removeEventListener("online", onVisibility); };
  }, [auth, refresh]);

  useEffect(() => {
    if (nearBottom.current && !olderView && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, olderView]);

  useEffect(() => {
    if (view !== "search" || !searchQuery.trim()) { setResults([]); setSearching(false); return; }
    let cancelled = false; setSearching(true);
    const timer = setTimeout(() => { api<{results: Message[]}>(`/search?q=${encodeURIComponent(searchQuery.trim())}`).then(data => { if (!cancelled) setResults(data.results); }).catch(e => { if (!cancelled) report(e); }).finally(() => { if (!cancelled) setSearching(false); }); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [view, searchQuery, report]);

  function changeView(next: View) { viewRef.current = next; setView(next); setError(""); if (next === "chats" && selectedRef.current && !olderRef.current) void loadMessages(selectedRef.current).catch(report); }
  function selectChat(id: string) { selectedRef.current = id; mobileOpenRef.current = true; setSelected(id); setMessages([]); setHasMore(false); setMobileOpen(true); setOlderView(false); olderRef.current = false; nearBottom.current = true; changeView("chats"); void loadMessages(id).catch(report); }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/auth/login", { token: token.trim() }); setToken(""); setAuth("ready"); } catch (e) { report(e); } finally { setBusy(false); }
  }
  async function send() {
    if (!chat || !draft.trim() || !sendEnabled || submitLock.current || uncertain) return;
    submitLock.current = true; setSending(true); setError("");
    const requestId = crypto.randomUUID(); const content = draft; const id = chat.id;
    try {
      await api(`/chats/${id}/send`, { content, client_request_id: requestId, expected_external_id: chat.external_id, expected_name: chat.name });
      setDrafts(items => ({ ...items, [id]: "" })); nearBottom.current = true; await refresh();
    } catch (e) {
      if (e instanceof ApiError) report(e);
      else { setUncertain({ chatId: id, requestId, content }); setError("送信の受付結果を確認できません。自動再送はしません。「受付状態を確認」を押してください。"); }
    } finally { submitLock.current = false; setSending(false); }
  }
  async function checkUncertain() {
    if (!uncertain) return;
    try {
      const found = await api<QueueItem>(`/requests/${uncertain.requestId}`);
      if (found) { setDrafts(d => ({ ...d, [uncertain.chatId]: "" })); setUncertain(null); setError(""); setNotice(`受付を確認しました。状態：${delivery[found.status]}`); await refresh(); }
      else setError("受付をまだ確認できません。再送はせず、接続回復後にもう一度確認してください。");
    } catch (e) { if (e instanceof ApiError && e.status === 404) setError("受付をまだ確認できません。自動再送はしません。接続回復後にもう一度確認してください。"); else report(e); }
  }
  async function mock(action: string, id?: string) { setBusy(true); setError(""); try { await api("/mock", { action, chat_id: id }); await refresh(); setNotice(action.startsWith("next_") ? "次のMock送信結果を変更しました。" : "Mockの状態を更新しました。"); } catch (e) { report(e); } finally { setBusy(false); } }
  async function sync() { setBusy(true); try { await api("/sync", {}); await refresh(); setNotice("取得可能な履歴を再確認しました。未取得の履歴範囲は各チャットで確認できます。"); } catch (e) { report(e); } finally { setBusy(false); } }
  async function loadOlder() {
    if (!chat || !messages.length) return; setHistoryLoading(true);
    const id = chat.id; const current = messages; nearBottom.current = false; olderRef.current = true; setOlderView(true); ++loadingGeneration.current;
    try { const data = await api<PageData>(`/chats/${id}/messages?before=${messages[0].id}`); if (selectedRef.current === id) { const seen = new Set(current.map(m => m.id)); setMessages([...data.messages.filter(m => !seen.has(m.id)), ...current]); setHasMore(data.has_more); } } catch (e) { report(e); } finally { setHistoryLoading(false); }
  }
  async function openResult(message: Message) {
    selectChat(message.chat_id); olderRef.current = true; setOlderView(true); ++loadingGeneration.current;
    try { const data = await api<PageData>(`/chats/${message.chat_id}/messages?before=${message.id + 1}`); if (selectedRef.current === message.chat_id) { setMessages(data.messages); setHasMore(data.has_more); setTimeout(() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ block: "center" }), 50); } } catch (e) { report(e); }
  }

  if (auth !== "ready") return <main className="welcome"><div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><Leaf size={100} strokeWidth={.7}/></div><form onSubmit={login} className="login-card"><div className="brand"><span className="brand-icon"><Leaf size={24}/></span><span>こもれび</span></div><span className="eyebrow">YOUR CONVERSATIONS, YOUR SPACE</span><h1>いつもの会話に、<br/>心地よい居場所を。</h1><p>あなたのWeChatを、このPCから。<br/>メッセージはローカルに保存されます。</p>{auth === "loading" ? <p className="inline"><LoaderCircle className="spin" size={18}/>接続を確認しています…</p> : <><label htmlFor="access-token">このアプリの接続キー</label><input id="access-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="接続キーを貼り付け" required/><p className="help">PC上の <code>.runtime/access-token.txt</code> を開き、キーを入力してください。WeChatのパスワードは不要です。</p><button className="primary login-button" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin"/> : <LockKeyhole size={17}/>}このPCに接続</button></>}{error && <p className="error-text" role="alert">{error}</p>}<div className="login-footer"><ShieldCheck size={15}/> ログインで保護 · 会話はWindowsに保存</div></form><span className="welcome-caption">少し、気持ちのいいコミュニケーション。</span></main>;

  const visibleChats = chats.filter(c => (!listQuery || c.name.toLowerCase().includes(listQuery.toLowerCase())) && (filter === "all" || filter === "unread" && c.unread_count > 0 || filter === "group" && c.type === "group"));
  return <main className={`app-shell ${mobileOpen ? "conversation-open" : ""}`}>
    <nav className="rail" aria-label="メインメニュー"><a className="brand-icon" href="/" aria-label="こもれび ホーム"><Leaf size={25}/></a><div className="rail-links"><button className={view === "chats" ? "active" : ""} onClick={() => { mobileOpenRef.current = false; changeView("chats"); setMobileOpen(false); }} aria-label="チャット一覧" title="チャット"><MessageCircle size={23}/>{unread > 0 && <span className="nav-dot"/>}<span>チャット</span></button><button className={view === "search" ? "active" : ""} onClick={() => changeView("search")} aria-label="メッセージ検索" title="検索"><Search size={23}/><span>検索</span></button></div><div className="rail-bottom"><button className={view === "settings" ? "active" : ""} onClick={() => changeView("settings")} aria-label="接続状態・設定" title="設定"><Settings size={23}/><span>設定</span></button><div className="self-avatar" title="自分専用">私</div></div></nav>
    <div className="workspace"><header className="topbar"><div className="wordmark">こもれび <span>あなたの会話を、ひとつに。</span></div><div className="topbar-status"><span className={`connection-pill ${connected ? "" : "disconnected"}`}><span className="status-dot"/>{!reachable ? "PCに接続できません" : connected ? wsState === "live" ? "リアルタイム接続" : "再接続中" : status?.state === "limited" ? "読み取り制限あり" : "接続停止中"}</span><button className="mode-badge" onClick={() => changeView("settings")}><FlaskConical size={13}/>{status?.mode === "mock" ? "Mockモード" : "Windows UIA"}</button></div></header>
      {error && <div className="global-banner danger" role="alert"><CircleAlert size={17}/><span>{error}</span>{uncertain && <button onClick={checkUncertain}>受付状態を確認</button>}<button className="icon-button" aria-label="エラーを閉じる" onClick={() => setError("")}><X size={16}/></button></div>}
      {notice && <div className="global-banner" role="status"><Check size={16}/><span>{notice}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => setNotice("")}><X size={16}/></button></div>}
      {view === "chats" && <div className="chat-layout"><aside className="chat-sidebar"><div className="list-heading"><div><span className="eyebrow">YOUR INBOX</span><h1>メッセージ <span>{chats.length}</span></h1></div><button className="icon-button" onClick={sync} disabled={busy || !status?.can_read} aria-label="履歴を再取得" title="取得可能な履歴を再確認"><RefreshCw size={18} className={busy ? "spin" : ""}/></button></div><label className="search-field"><Search size={17}/><input aria-label="チャットを検索" placeholder="会話を検索" value={listQuery} onChange={e => setListQuery(e.target.value)}/><span>⌕</span></label><div className="filter-tabs" role="group" aria-label="チャットの絞り込み">{[["all", "すべて"], ["unread", "未読"], ["group", "グループ"]].map(([key, label]) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}{key === "unread" && unread > 0 && <span>{unread}</span>}</button>)}</div><div className="chat-list">{visibleChats.map(c => <button key={c.id} data-testid={`chat-${c.external_id}`} className={`chat-item ${selected === c.id ? "selected" : ""}`} onClick={() => selectChat(c.id)}><Avatar chat={c}/><span className="chat-item-body"><span className="chat-item-top"><strong>{c.name}</strong><time>{c.last_message_at && time(c.last_message_at)}</time></span><span className="chat-preview">{["pending", "sending", "failed", "unknown"].includes(c.last_delivery_status) && <em>{delivery[c.last_delivery_status]} · </em>}{c.last_message || "メッセージはまだありません"}</span><span className="chat-item-bottom"><span>{c.type === "group" ? "グループ" : "個人チャット"}{c.sync_status === "partial" && " · 一部の履歴"}</span>{c.unread_count > 0 && <b className="unread-badge">{c.unread_count}</b>}</span></span></button>)}{visibleChats.length === 0 && <div className="list-empty">{chats.length ? "該当する会話はありません" : "取得できた会話はまだありません。\n接続状態を確認してください。"}</div>}</div><div className="sidebar-footer"><ShieldCheck size={16}/><span>このPCに保存されています</span><span className="tiny-dot"/></div></aside>
      <section className="conversation" aria-label="会話">{!chat ? <div className="conversation-empty"><div className="empty-art"><Leaf size={56} strokeWidth={1}/></div><span className="eyebrow">A LITTLE CLOSER, EVERY DAY</span><h2>会話の続きを、ここから。</h2><p>左の一覧からチャットを選んでください。<br/>あなたの言葉が、心地よくつながる場所。</p>{status?.mode === "mock" && <span className="soft-tag"><FlaskConical size={14}/> サンプルの会話で試せます</span>}</div> : <><header className="conversation-header"><button className="icon-button mobile-back" aria-label="一覧に戻る" onClick={() => { mobileOpenRef.current = false; setMobileOpen(false); selectedRef.current = null; setSelected(null); }}><ArrowLeft size={22}/></button><Avatar chat={chat} small/><div className="conversation-title"><h2>{chat.name}</h2><p>{chat.type === "group" ? `グループ${chat.member_count ? ` · ${chat.member_count}人` : ""}` : "個人チャット"}<span> · </span>{status?.mode === "mock" ? "サンプルの会話" : "UIで確認できた範囲"}</p></div><button className="icon-button" aria-label="この会話のメッセージを検索" onClick={() => { changeView("search"); setSearchQuery(""); }}><Search size={20}/></button><button className="icon-button" aria-label="会話の接続設定" onClick={() => changeView("settings")}><Settings size={19}/></button></header>
      <div className={`history-banner ${chat.sync_status === "partial" ? "partial" : ""}`}><ShieldCheck size={15}/><span>{chat.sync_status === "partial" ? "一部の履歴を表示しています。以前の履歴は未取得です。" : "Mockのサンプル履歴を表示しています。"}</span></div>
      <div className="message-list" ref={listRef} onScroll={e => { const element = e.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }} aria-label="メッセージ履歴" aria-live="polite">{hasMore && <button className="load-history" onClick={loadOlder} disabled={historyLoading}>{historyLoading ? "読み込み中…" : "保存済みの以前のメッセージを表示"}</button>}<div className="conversation-start"><LockKeyhole size={12}/><span>会話はあなたのPCの中に。</span></div>{messages.map((message, index) => <div key={message.id} id={`message-${message.id}`} className="message-wrapper">{(index === 0 || day(messages[index - 1].timestamp) !== day(message.timestamp)) && <div className="date-divider"><span>{day(message.timestamp)}</span></div>}<div className={`message-row ${message.direction === "outgoing" ? "outgoing" : "incoming"}`}>{message.direction === "incoming" && <span className="sender-avatar">{message.sender_name.slice(0, 1)}</span>}<div className="message-content">{message.direction === "incoming" && chat.type === "group" && <div className="sender-name">{message.sender_name}</div>}<div className={`bubble ${["failed", "unknown"].includes(message.delivery_status) ? "attention" : ""}`}>{message.content}</div><div className="message-meta"><time>{time(message.timestamp)}</time>{message.timestamp_quality !== "exact" && <span>取得時刻 / 推定</span>}{message.direction === "outgoing" && <span className={`delivery ${message.delivery_status}`} data-testid={`delivery-${message.id}`}>{message.delivery_status === "confirmed" ? <CheckCheck size={12}/> : message.delivery_status === "sending" ? <LoaderCircle size={12} className="spin"/> : ["unknown", "failed"].includes(message.delivery_status) ? <CircleAlert size={12}/> : null}{delivery[message.delivery_status]}</span>}</div></div></div></div>)}{messages.length === 0 && <p className="muted center">保存済みメッセージがありません。</p>}</div>
      {olderView && <button className="latest-button" onClick={() => { olderRef.current = false; setOlderView(false); nearBottom.current = true; void loadMessages(chat.id).catch(report); }}><ArrowDown size={14}/>最新のメッセージへ戻る</button>}
      <div className="composer-area">{!sendEnabled && <div className="send-warning"><WifiOff size={14}/>{!reachable ? "PCに接続できません。送信を停止しています。" : status?.mode !== "mock" ? "このWeChatバージョンでは安全な宛先照合が未検証のため、送信を停止しています。" : "接続が戻るまで送信を停止しています。"}</div>}<div className="composer"><textarea aria-label="メッセージを入力" placeholder="メッセージを入力…" value={draft} maxLength={4000} rows={2} onChange={e => setDrafts(items => ({ ...items, [chat.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/><div className="composer-actions"><span>{draft.length > 0 ? `${draft.length.toLocaleString()} / 4,000` : "テキストメッセージ"}</span><button className="send-button" onClick={send} disabled={!draft.trim() || !sendEnabled || sending || !!uncertain} aria-label="メッセージを送信">{sending ? <LoaderCircle size={18} className="spin"/> : <ArrowUp size={20}/>}<span>送信</span></button></div></div><div className="composer-foot"><span><LockKeyhole size={11}/>{status?.mode === "mock" ? "Mock内で送信されます" : "Windows版WeChat経由"}</span><span>⌘ / Ctrl + Enter で送信</span></div></div></> }</section>
      {chat && <aside className="detail-panel"><span className="eyebrow">ABOUT THIS CONVERSATION</span><div className="detail-profile"><Avatar chat={chat}/><h3>{chat.name}</h3><p>{chat.type === "group" ? "グループチャット" : "個人チャット"}</p></div><div className="detail-card"><span className="card-icon"><RefreshCw size={17}/></span><h4>履歴の同期</h4><span className={`sync-label ${chat.sync_status}`}>{chat.sync_status === "partial" ? "一部取得済み" : "Mock履歴を取得済み"}</span><p>{chat.history_note}</p><small>最終取得 {time(chat.last_sync_at)}</small></div><div className="detail-card"><ShieldCheck size={20}/><h4>あなたの会話は、<br/>あなたの手元に。</h4><p>メッセージはこのPCだけに保存。外部のクラウドには転送しません。</p></div>{status?.mode === "mock" && <button className="mock-receive" disabled={!connected || busy} onClick={() => mock("receive", chat.id)}><FlaskConical size={16}/><span>新着をシミュレート</span><ChevronRight size={14}/></button>}</aside>}</div>}
      {view === "search" && <section className="content-page search-page"><div className="page-heading"><span className="eyebrow">FIND A MOMENT</span><h1>メッセージ検索</h1><p>このPCに保存された会話から探します。</p></div><label className="search-field large"><Search size={22}/><input autoFocus aria-label="メッセージ検索キーワード" placeholder="キーワードを入力…" value={searchQuery} maxLength={200} onChange={e => setSearchQuery(e.target.value)}/>{searchQuery && <button className="icon-button" aria-label="検索をクリア" onClick={() => setSearchQuery("")}><X size={18}/></button>}</label><div className="search-meta">{searching ? "検索中…" : searchQuery.trim() ? `${results.length}件${results.length === 100 ? "（最大100件）" : ""}` : "すべてのチャットを検索"}<span>未取得の履歴は検索対象に含まれません</span></div><div className="search-results">{results.map(message => <button className="search-result" key={message.id} onClick={() => void openResult(message)}><span className="result-icon"><MessageCircle size={20}/></span><span><strong>{message.chat_name}<small>{message.sender_name} · {day(message.timestamp)} {time(message.timestamp)}</small></strong><span className="result-content">{message.content}</span></span><ChevronRight size={17}/></button>)}{!searching && results.length === 0 && <div className="search-empty"><Search size={36} strokeWidth={1}/><h2>{searchQuery.trim() ? "見つかりませんでした" : "あの言葉を、もう一度。"}</h2><p>{searchQuery.trim() ? "別のキーワードで試してください。" : "日本語・中国語のメッセージを検索できます。"}</p></div>}</div></section>}
      {view === "settings" && <section className="content-page settings-page"><div className="page-heading"><span className="eyebrow">YOUR PRIVATE SPACE</span><h1>接続状態・設定</h1><p>つながり方を、ひと目で。</p></div><div className="settings-grid"><article className="settings-card connection-card"><div className="card-heading"><Wifi size={21}/><h2>接続状態</h2><span className={`sync-label ${connected ? "complete" : "partial"}`}>{connected ? "接続中" : "停止 / 制限あり"}</span></div><p>{status?.detail}</p><dl><div><dt>接続先</dt><dd>{status?.mode === "mock" ? "Mockシミュレーター" : "Windows版WeChat"}</dd></div><div><dt>リアルタイム更新</dt><dd>{wsState === "live" && reachable ? "WebSocket 接続中" : "再接続を待機中"}</dd></div><div><dt>送信待ち</dt><dd>{status?.queue_pending || 0}件</dd></div>{status?.version && <div><dt>WeChatバージョン</dt><dd>{status.version}</dd></div>}</dl><button className="secondary" onClick={sync} disabled={busy || !status?.can_read}><RefreshCw size={15} className={busy ? "spin" : ""}/>取得可能な履歴を読み込む</button></article><article className="settings-card"><div className="card-heading"><Sun size={20}/><h2>表示</h2></div><p>この端末での見た目を選べます。</p><div className="theme-options">{[["light", "ライト"], ["dark", "ダーク"], ["system", "自動"]].map(([key, label]) => <button key={key} className={theme === key ? "selected" : ""} onClick={() => setTheme(key)}>{key === "dark" ? <Moon size={20}/> : key === "light" ? <Sun size={20}/> : <Settings size={20}/>}<span>{label}</span></button>)}</div><p className="help">iPhoneではSafariの共有メニューから「ホーム画面に追加」でアプリとして使えます。接続方法は「携帯でアプリとして使う」で確認できます。</p></article>
      <MobileInstall/>
      {status?.mode === "mock" && <article className="settings-card mock-card"><div className="card-heading"><FlaskConical size={21}/><h2>Mockテスト</h2><span className="soft-tag">実送信なし</span></div><p>受信・切断・送信結果をローカルで確認できます。</p><div className="test-controls"><button className="secondary" disabled={busy || !connected} onClick={() => mock("receive", selected || chats[0]?.id)}><MessageCircle size={16}/>新着メッセージを受信</button><button className="secondary" disabled={busy} onClick={() => mock(connected ? "disconnect" : "reconnect")}>{connected ? <WifiOff size={16}/> : <Wifi size={16}/>} {connected ? "接続を切断" : "再接続"}</button></div><label className="select-label">次の送信の結果<select disabled={busy} aria-label="次のMock送信結果" defaultValue="confirmed" onChange={e => mock(`next_${e.target.value}`)}><option value="confirmed">送信確認済み</option><option value="unknown">確認不能（自動再送しない）</option><option value="failed">失敗</option></select></label><small>一度の送信後、通常の結果に戻ります。</small></article>}
      <article className="settings-card"><div className="card-heading"><ShieldCheck size={21}/><h2>プライバシーと制限</h2></div><ul className="privacy-list"><li>WeChatのパスワードは取得・保存しません。</li><li>データはPC内のSQLiteに保存。OSのディスク暗号化を利用してください。</li><li>「送信確認済み」は送信側での確認です。相手の既読を意味しません。</li><li>完全な履歴同期、画像・音声・ファイルは未対応です。</li>{status?.limitations.map(item => <li key={item}>{item}</li>)}</ul></article></div>
      <article className="settings-card queue-card"><div className="card-heading"><ArrowUp size={20}/><h2>送信キュー</h2><span className="muted">直近100件</span></div><p>確認不能のメッセージは、WeChat側を確認してください。自動再送は行いません。</p>{queue.length === 0 ? <div className="queue-empty">送信履歴はまだありません。</div> : <div className="queue-list">{queue.map(item => <div className="queue-row" key={item.id}><div><strong>{item.chat_name}</strong><p>{item.content}</p><small>{day(item.created_at)} {time(item.created_at)}</small></div><span className={`delivery ${item.status}`}>{delivery[item.status]}</span></div>)}</div>}</article><div className="settings-footer"><span><Leaf size={16}/> こもれび · Personal WeChat Bridge</span><button className="text-button" onClick={async () => { try { await api("/auth/logout", {}); setAuth("locked"); setMessages([]); setChats([]); setDrafts({}); setQueue([]); setResults([]); setSelected(null); selectedRef.current = null; } catch (e) { report(e); } }}><LogOut size={15}/>この端末からログアウト</button></div></section>}
    </div>
  </main>;
}
