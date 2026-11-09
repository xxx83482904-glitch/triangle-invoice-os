export type Chat = {
  id: string; external_id: string; name: string; type: "individual" | "group";
  last_message_at: string | null; sync_status: string; history_note: string;
  member_count: number | null; unread_count: number; last_message: string | null;
  last_sync_at: string | null; connection_status: string; last_delivery_status: string;
};
export type Message = {
  id: number; chat_id: string; content: string; sender_name: string; sender_id: string;
  direction: "incoming" | "outgoing"; timestamp: string | null; observed_at: string;
  timestamp_quality: string; delivery_status: string; identity_quality: string;
  chat_name?: string; chat_type?: string;
};
export type Status = {
  state: string; mode: string; detail: string; can_send: boolean; can_read: boolean;
  version: string | null; limitations: string[]; queue_pending: number; unknown_count: number;
  sync_error: string | null;
};
export type QueueItem = { id: string; client_request_id: string; chat_id: string; chat_name: string; status: string; content: string; error_message: string | null; created_at: string };
export type Priority = "high" | "normal" | "low";
export type AttentionItem = {
  chat_id: string; chat_name: string; chat_type: "individual" | "group";
  source_message_id: number | null; source_content: string; source_at: string | null;
  latest_message_id: number | null; priority: Priority; priority_origin: "manual" | "rule";
  state: "reply_candidate" | "review_send" | "no_candidate"; reasons: string[];
  suggestions: {label: string; text: string}[]; task_title: string | null;
};
export type Attention = { provider: string; ai_connected: boolean; history_scope: string; items: AttentionItem[] };
export type Task = {
  id: string; chat_id: string; chat_name: string; source_message_id: number; source_content: string;
  title: string; due_date: string | null; status: "open" | "done"; created_at: string; updated_at: string;
};
export const priorityLabels: Record<Priority, string> = { high: "優先", normal: "通常", low: "あとで" };
export const priorityOrder: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export const delivery: Record<string, string> = { received: "受信", pending: "未送信", sending: "送信処理中", confirmed: "送信確認済み", unknown: "確認不能", failed: "失敗" };
const errors: Record<string, string> = {
  authentication_required: "接続キーでログインしてください。", invalid_access_token: "接続キーが一致しません。",
  destination_mismatch: "宛先が一致しないため、送信を中止しました。", sending_unavailable: "送信できる接続がありません。下書きは保持しています。",
  queue_full: "送信待ちが多いため、少し待ってからお試しください。", rate_limited: "操作が続いています。1分ほど待ってください。",
  idempotency_conflict: "受付IDが重複しています。送信状態を確認してください。", mock_offline: "Mockを再接続してからお試しください。",
  invalid_request: "入力を確認してください。", empty_message: "メッセージを入力してください。",
  origin_not_allowed: "この接続元は許可されていません。設定の接続元URLを確認してください。",
  empty_task: "タスク名を入力してください。", source_mismatch: "元のメッセージと会話が一致しません。",
  task_already_exists: "このメッセージはタスクに追加済みです。タスク画面で確認してください。",
  task_not_found: "タスクが見つかりません。画面を更新してください。",
};
export class ApiError extends Error { constructor(public status: number, public code: string) { super(errors[code] || "処理できませんでした。接続状態を確認してください。"); } }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: body === undefined ? undefined : {"Content-Type": "application/json"}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.detail || "request_failed");
  return result as T;
}
export function time(value: string | null) { return value ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "時刻不明"; }
export function day(value: string | null) { return value ? new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(value)) : "日時不明"; }
