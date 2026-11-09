import asyncio
import json
from pathlib import Path
import subprocess
import sys
import time

from .base import AdapterError, Chat, Connection, Message, Receipt, WeChatAdapter
from .wxauto4_data import MAX_BYTES, validate_snapshot

ROOT = Path(__file__).resolve().parents[3]
HISTORY_NOTE = ("このPCのWeChatで表示したテキストのみ。画面外・未選択の会話・画像や音声は未取得です。"
                "日時・WeChatのID・自分の表示名は未取得。表示名とUIの一時IDによるローカル識別で、送信には使用できません。")
DETAILS = {
    "ready": "無料wxauto4で表示中の会話を読み取っています。実送信は無効です。",
    "foreground_required": "新しい本文の読み取り待ちです。PC上でWeChatを前面に表示してください。",
    "user_active": "PCの操作が落ち着くまで、新しい本文の読み取りを待っています。",
    "not_running": "Windows版WeChatが起動していません。保存済みの履歴は閲覧できます。",
    "login_required": "正規WeChatで本人のログインが必要です。",
    "conversation_required": "PC上のWeChatで読み取る個人・グループ会話を開いてください。",
    "ambiguous_chat": "同名会話などで表示中の宛先を一意に照合できないため、読み取りを停止しました。",
    "scope_changed": "WeChatの起動状態が変わりました。別アカウントの履歴と混ざらないよう再接続の確認が必要です。",
    "dependency_missing": "無料wxauto4の隔離環境が未設定です。setup-wxauto4.ps1を実行してください。",
    "unsupported_version": "このReaderで検証済みの組み合わせはWeChat 4.1.8.107とwxauto4 41.1.7です。",
    "unsupported_os": "このReaderにはWindowsが必要です。",
    "reader_busy": "別の読み取り処理の終了を待っています。",
    "reader_timeout": "WeChatの応答が時間内に完了しませんでした。送信は行っていません。",
    "reader_failed": "WeChatの画面情報を取得できません。保存済み履歴と実機状態は分けて表示します。",
}


class WindowsWxauto4Adapter(WeChatAdapter):
    """Read-only, bounded worker. Existing send queue cannot invoke a sender here."""
    def __init__(self, poll_seconds=10, runner=None):
        self.poll_seconds = max(10, poll_seconds)
        self.runner = runner or self._run
        self.enabled = False
        self.lock = asyncio.Lock()
        self.snapshot = validate_snapshot({"state": "conversation_required"})
        self.checked_at = 0.0

    @staticmethod
    def _run():
        if sys.platform != "win32":
            return {"state": "unsupported_os"}
        python = ROOT / ".runtime/wxauto-venv/Scripts/python.exe"
        if not python.is_file():
            return {"state": "dependency_missing"}
        try:
            process = subprocess.run([str(python), "-X", "utf8", "-m", "app.adapters.wxauto4_worker"],
                                     cwd=ROOT / "backend", capture_output=True, timeout=18,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            if process.returncode or len(process.stdout) > MAX_BYTES:
                return {"state": "reader_failed"}
            return json.loads(process.stdout)
        except subprocess.TimeoutExpired:
            return {"state": "reader_timeout"}
        except Exception:
            return {"state": "reader_failed"}

    async def refresh(self):
        async with self.lock:
            if not self.enabled:
                return
            try:
                self.snapshot = validate_snapshot(await asyncio.to_thread(self.runner))
            except Exception:
                self.snapshot = validate_snapshot({"state": "reader_failed"})
            self.checked_at = time.monotonic()

    async def connect(self):
        self.enabled = True
        await self.refresh()
        return await self.get_connection_status()

    async def disconnect(self):
        self.enabled = False

    async def get_connection_status(self):
        if not self.enabled:
            return Connection("disconnected", "wxauto4", "無料wxauto4 Readerを停止中です。")
        code = self.snapshot["state"]
        stale = time.monotonic() - self.checked_at > self.poll_seconds + 25
        if stale:
            code = "reader_timeout"
        readable = self.snapshot["chat"] is not None and code in ("ready", "foreground_required", "user_active")
        state = "connected" if code == "ready" else "login_required" if code == "login_required" else "disconnected" if code == "not_running" else "limited"
        return Connection(state, "wxauto4", DETAILS[code], False, readable, "4.1.8.107", [
            HISTORY_NOTE,
            "新しい発言の解析ではメニューを開閉します。WeChatが前面でPC操作が落ち着いた時だけ、10秒以上の間隔で最大1件を読み取ります。",
            "同じUI部品・本文の再取得は重複保存しません。WeChat再起動・ログアウト時は自動で履歴を結合せず停止します。",
            "UI一時IDの再利用、同文の再表示、会話の改名では完全な識別を保証できません。アカウントIDは未取得です。",
        ])

    async def get_chats(self):
        if not (await self.get_connection_status()).can_read:
            return []
        chat = self.snapshot["chat"]
        return [Chat(chat["external_id"], chat["name"], chat["type"], history_note=HISTORY_NOTE,
                     member_count=chat["member_count"])]

    async def get_messages(self, chat_id):
        if not self.snapshot["chat"] or self.snapshot["chat"]["external_id"] != chat_id:
            raise AdapterError("chat_not_current")
        return [Message(chat_id, row["content"], "", row["sender_name"], row["direction"], None,
                        occurrence=row["source_key"], timestamp_quality="unavailable", source_key=row["source_key"],
                        identity_quality="uia_runtime", delivery_status="received" if row["direction"] == "incoming" else "unknown")
                for row in self.snapshot["messages"]]

    async def watch_messages(self):
        while self.enabled:
            await asyncio.sleep(self.poll_seconds)
            await self.refresh()
            if (await self.get_connection_status()).can_read:
                for message in await self.get_messages(self.snapshot["chat"]["external_id"]):
                    yield message

    async def send_message(self, chat_id, text):
        return Receipt("failed", error="real_sending_not_validated")
