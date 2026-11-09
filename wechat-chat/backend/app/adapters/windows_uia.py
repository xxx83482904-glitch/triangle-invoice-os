import asyncio
import json
from pathlib import Path
import subprocess
import sys
import time

from .base import AdapterError, Connection, Receipt, WeChatAdapter

DETAILS = {
    "unsupported_os": "実機AdapterにはWindows 10/11が必要です。",
    "not_running": "Windows版WeChatが起動していません。",
    "window_unavailable": "WeChatの操作可能なウィンドウが見つかりません。手動で画面を開いてください。",
    "window_minimized": "WeChatのウィンドウが最小化されています。PC上で会話画面を表示してから再確認してください。",
    "ui_tree_unavailable": "WeChatは起動していますが、会話の読み取り用UI情報が公開されていません。ログイン済みでも、この状態では本文や宛先を取得できません。",
    "dependency_missing": "任意依存のuiautomationが未導入です。requirements-windows.txtを確認してください。",
    "login_required": "WeChatはログイン待機中です。正規クライアントで手動ログインしてください。",
    "unsupported_ui": "WeChatの画面部品は検出しましたが、このバージョンのメッセージと宛先IDを解析するReaderは未対応です。",
    "probe_failed": "Windows UI Automationの状態を取得できません。",
    "probe_timeout": "WeChatのUI応答がタイムアウトしました。",
}


class WindowsUIAAdapter(WeChatAdapter):
    """Real connection diagnostics; message I/O is intentionally fail-closed.

    Earlier login sessions exposed only window/container nodes; a later 4.1.8.107
    session exposed interactive controls but free-wxauto4 initialization timed out.
    No validated conversation schema or stable IDs exist yet.
    Empty history is never reported as complete, and send_message
    never invokes a UI action.
    """
    def __init__(self, poll_seconds=3):
        self.poll_seconds = poll_seconds
        self.enabled = False
        self.checked_at = 0.0
        self.diagnostic = {"state": "not_running"}
        self.lock = asyncio.Lock()

    async def connect(self):
        self.enabled = True
        self.checked_at = 0
        return await self.get_connection_status()

    async def disconnect(self):
        self.enabled = False

    @staticmethod
    def _probe():
        if sys.platform != "win32":
            return {"state": "unsupported_os"}
        try:
            result = subprocess.run([sys.executable, "-m", "app.adapters.windows_probe"], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
            return json.loads(result.stdout) if result.returncode == 0 else {"state": "probe_failed"}
        except subprocess.TimeoutExpired:
            return {"state": "probe_timeout"}
        except Exception:
            return {"state": "probe_failed"}

    async def get_connection_status(self):
        if not self.enabled:
            return Connection("disconnected", "windows-uia", "WeChat Adapterを停止中です。")
        async with self.lock:
            if time.monotonic() - self.checked_at >= self.poll_seconds:
                self.diagnostic = await asyncio.to_thread(self._probe)
                self.checked_at = time.monotonic()
        return self.describe(self.diagnostic)

    @staticmethod
    def describe(diagnostic):
        code = diagnostic.get("state", "probe_failed")
        state = "limited" if code in ("unsupported_ui", "ui_tree_unavailable", "window_minimized") else "login_required" if code == "login_required" else "disconnected" if code in ("not_running", "window_unavailable") else "error"
        return Connection(state, "windows-uia", DETAILS.get(code, DETAILS["probe_failed"]), False, False, diagnostic.get("version"), [
            "この実機Adapterで実装済みなのは、プロセス・バージョン・ログイン待機・UI応答の診断です。",
            "個人・グループの実メッセージ読み取りと送信は未対応です。画面の目視確認、UI情報の取得、Mock動作はそれぞれ別の検証です。",
            "検証済みの宛先IDが得られるまで送信は無効です。表示名だけでは照合しません。",
            "UI自動操作はTencentの利用規約に抵触し、アカウント制限を招く可能性があります。",
        ])

    async def get_chats(self):
        raise AdapterError("conversation_discovery_unvalidated")

    async def get_messages(self, chat_id):
        raise AdapterError("message_reading_unvalidated")

    async def watch_messages(self):
        # No fabricated messages. The engine's connection monitor polls diagnostics.
        while self.enabled:
            await asyncio.sleep(self.poll_seconds)
            if False:
                yield None

    async def send_message(self, chat_id, text):
        return Receipt("failed", error="real_sending_not_validated")
