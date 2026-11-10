export type Chat = {
  id: string; external_id: string; name: string; type: "individual" | "group";
  last_message_at: string | null; sync_status: string; history_note: string;
  member_count: number | null; unread_count: number; last_message: string | null;
  last_sync_at: string | null; connection_status: string; last_delivery_status: string;
  last_identity_quality?: string; last_timestamp_quality?: string;
};
export type Message = {
  id: number; chat_id: string; content: string; sender_name: string; sender_id: string;
  direction: "incoming" | "outgoing"; timestamp: string | null; observed_at: string;
  timestamp_quality: string; delivery_status: string; identity_quality: string; message_type: string;
  chat_name?: string; chat_type?: string;
  attachment?: Attachment | null;
};
export type Attachment = {
  id: string; kind: "image" | "file" | "voice" | "video";
  status: "pending" | "queued" | "loading" | "ready" | "unavailable" | "too_large" | "failed";
  filename: string | null; mime_type: string | null; size_bytes: number | null;
  transcript: string | null; error_code: string | null; has_content: boolean;
};
export type Status = {
  state: string; mode: string; detail: string; can_send: boolean; can_read: boolean;
  version: string | null; limitations: string[]; queue_pending: number; unknown_count: number;
  sync_error: string | null;
  monitoring?: { registered: number; discovered: number; ambiguous: number; registration_failures: number;
    limit: number; reconnections: number; scope: "visible_sessions"; complete: false; active_chat_ids: string[] } | null;
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
  history_unavailable: "この接続では履歴の巡回を開始できません。",
  history_connection_required: "WeChatとの接続を確認してから開始してください。",
  history_scope_changed: "WeChatの起動状態が変わりました。会話一覧から再確認してください。保存済み履歴は保持されています。",
  source_unavailable: "元のメッセージをWeChatで確認できません。接続状態と監視対象を確認してください。",
  attachment_not_found: "添付ファイルが見つかりません。",
  attachment_missing: "保存したファイルが見つかりません。",
  attachment_not_ready: "ファイルはまだ保存されていません。",
  ai_disabled: "外部AIは無効です。PC側の設定で有効化してください。",
  ai_not_configured: "PC側のOpenAI APIキーとモデルが未設定です。",
  ai_preview_expired: "確認内容の期限が切れました。送る内容を確認し直してください。",
  ai_preview_mismatch: "確認した機能と実行する機能が一致しません。確認し直してください。",
  ai_preview_limit: "確認中の内容が多いため、5分ほど待ってください。",
  ai_invalid_selection: "対象の会話とメッセージを確認してください。翻訳は本文1件または下書きだけを選びます。",
  ai_context_too_large: "送る内容が12,000文字を超えています。メッセージを減らしてください。",
  ai_busy: "別のAI処理が実行中です。完了後にお試しください。",
  ai_job_not_found: "AI処理の受付をまだ確認できません。自動で再実行しません。",
  authentication_required: "接続キーでログインしてください。", invalid_access_token: "接続キーが一致しません。",
  destination_mismatch: "宛先が一致しないため、送信を中止しました。", sending_unavailable: "送信できる接続がありません。下書きは保持しています。",
  queue_full: "送信待ちが多いため、少し待ってからお試しください。", rate_limited: "操作が続いています。1分ほど待ってください。",
  idempotency_conflict: "受付IDが重複しています。送信状態を確認してください。", mock_offline: "Mockを再接続してからお試しください。",
  invalid_request: "入力を確認してください。", empty_message: "メッセージを入力してください。",
  origin_not_allowed: "この接続元は許可されていません。設定の接続元URLを確認してください。",
  empty_task: "タスク名を入力してください。", source_mismatch: "元のメッセージと会話が一致しません。",
  task_already_exists: "このメッセージはタスクに追加済みです。タスク画面で確認してください。",
  task_not_found: "タスクが見つかりません。画面を更新してください。",
  diagnostic_busy: "WeChatの診断を実行中です。少し待ってからお試しください。",
  ocr_mode_required: "画面OCRモードに切り替えてください。Mockの保存先には取り込めません。",
  ocr_window_ambiguous: "WeChatの画面が複数あり、対象を特定できません。読み取りたい会話のウィンドウだけ表示してください。",
  ocr_desktop_unavailable: "PCの画面ロックを解除してから、もう一度読み取ってください。",
  ocr_window_unsupported: "WeChatの会話画面を大きく表示してください。最小化中・ログイン画面・小さなウィンドウは読み取りません。",
  ocr_window_changed: "読み取り中に画面が変わりました。WeChatを表示したまま、もう一度お試しください。",
  ocr_language_unavailable: "この言語のWindows OCRがありません。別の言語を選ぶか、WindowsのOCR言語機能を追加してください。",
  ocr_dependency_missing: "Windows OCRの依存パッケージをインストールしてください。セットアップ手順に記載しています。",
  ocr_capture_failed: "画面を読み取れませんでした。WeChatの会話画面を表示してからお試しください。",
  ocr_timeout: "文字認識が時間内に完了しませんでした。もう一度読み取ってください。",
  ocr_busy: "文字認識を実行中です。少し待ってください。",
  ocr_no_text: "画面から文字を取得できませんでした。会話を表示して、言語を確認してください。",
  ocr_too_many_lines: "画面内の文字が多すぎます。WeChatのウィンドウを小さくして再度読み取ってください。",
  ocr_preview_expired: "読み取り結果の保存期限が過ぎました。もう一度読み取ってください。",
  ocr_selection_invalid: "保存する本文の行を選び直してください。",
  ocr_source_already_imported: "この画面の本文は既に保存されています。既存の会話で内容を確認してください。",
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
