import asyncio
from dataclasses import asdict
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

from .base import Chat, Connection, Message, Receipt, WeChatAdapter
from .plus_core import DETAILS, HISTORY
from ..media_store import KINDS, validate_attachment

ROOT = Path(__file__).resolve().parents[3]
MAX_BYTES = 4 * 1024 * 1024


class PlusRPC:
    """One serialized process for UI/COM affinity and listener lifetime."""
    def __init__(self, store, send_enabled=False, max_listeners=8, language="cn", client_kind="微信", preferred_chats=()):
        self.process = None
        self.lock = asyncio.Lock()
        self.store, self.send_enabled, self.limit, self.language = store, send_enabled, max_listeners, language
        self.client_kind = client_kind
        self.preferred_chats = tuple(preferred_chats)

    async def close(self):
        if self.process is not None:
            if self.process.returncode is None:
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass
            await self.process.wait()
            self.process = None

    async def call(self, action, **values):
        async with self.lock:
            try:
                if self.process is None or self.process.returncode is not None:
                    await self.close()
                    env = os.environ.copy()
                    # Child does not need application/OpenAI secrets.
                    for key in tuple(env):
                        if key.startswith(("OPENAI_", "WECHAT_")):
                            env.pop(key)
                    env.update(KOMOREBI_PLUS_STORE=str(self.store), KOMOREBI_PLUS_SEND=str(self.send_enabled).lower(),
                               KOMOREBI_PLUS_LIMIT=str(self.limit), KOMOREBI_PLUS_LANGUAGE=self.language,
                               KOMOREBI_PLUS_CLIENT_KIND=self.client_kind,
                               KOMOREBI_PLUS_PREFERRED=json.dumps(self.preferred_chats, ensure_ascii=False),
                               KOMOREBI_PLUS_MEDIA=str(self.store.parent / (self.store.stem.removesuffix("-worker") + "-attachments")))
                    python = ROOT / ".runtime/wxautox4-venv/Scripts/python.exe"
                    self.process = await asyncio.create_subprocess_exec(str(python), "-X", "utf8", "-m", "app.adapters.plus_worker",
                        cwd=ROOT / "backend", env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL, limit=MAX_BYTES + 1, creationflags=subprocess.CREATE_NO_WINDOW)
                rid = str(uuid4())
                payload = json.dumps({"id": rid, "action": action, **values}, ensure_ascii=False).encode() + b"\n"
                if len(payload) > 65536:
                    raise ValueError()
                async def exchange():
                    self.process.stdin.write(payload)
                    await self.process.stdin.drain()
                    line = await self.process.stdout.readline()
                    if not line or len(line) > MAX_BYTES:
                        raise ValueError()
                    response = json.loads(line)
                    if response.get("id") != rid:
                        raise ValueError()
                    return response["result"]
                return await asyncio.wait_for(exchange(), timeout=40)
            except BaseException:
                # No orphan sender after timeout/cancellation. Its durable ledger
                # already marks an attempted send unknown before SDK invocation.
                await self.close()
                raise


def validate_snapshot(data):
    if not isinstance(data, dict) or data.get("state") not in DETAILS:
        raise ValueError("invalid_plus_snapshot")
    chats, events = data.get("chats", []), data.get("events", [])
    if not isinstance(chats, list) or len(chats) > 10000 or not isinstance(events, list) or len(events) > 100:
        raise ValueError("invalid_plus_snapshot")
    chat_ids = set()
    for row in chats:
        chat = Chat(**row)
        if not chat.external_id.startswith("wxautox4:local:") or chat.type not in ("individual", "group") or not 0 < len(chat.name) <= 500:
            raise ValueError("invalid_plus_snapshot")
        chat_ids.add(chat.external_id)
    for event in events:
        message = Message(**event["message"])
        if (type(event["sequence"]) is not int or event["sequence"] < 1 or message.chat_id not in chat_ids
            or message.direction not in ("incoming", "outgoing") or message.message_type not in {"text", *KINDS}
            or not message.source_key or not 0 < len(message.content) <= 20000
            or message.external_message_id is not None or message.timestamp is not None
            or message.timestamp_quality != "unavailable" or message.identity_quality != "uia_runtime"
            or message.delivery_status != ("received" if message.direction == "incoming" else "unknown")):
            raise ValueError("invalid_plus_snapshot")
        if message.attachment is not None:
            if validate_attachment(message.attachment)["kind"] != message.message_type:
                raise ValueError("invalid_plus_snapshot")
        elif message.message_type != "text":
            raise ValueError("invalid_plus_snapshot")
    monitoring = data.get("monitoring")
    if monitoring is not None:
        if monitoring.get("complete") is not False or monitoring.get("scope") != "visible_sessions":
            raise ValueError("invalid_plus_snapshot")
        for key in ("registered", "discovered", "ambiguous", "registration_failures", "limit", "reconnections"):
            if type(monitoring.get(key)) is not int or not 0 <= monitoring[key] <= 100000:
                raise ValueError("invalid_plus_snapshot")
        if not isinstance(monitoring.get("active_chat_ids"), list) or any(i not in chat_ids for i in monitoring["active_chat_ids"]):
            raise ValueError("invalid_plus_snapshot")
    return data


class WindowsPlusAdapter(WeChatAdapter):
    def __init__(self, store_path=None, *, send_enabled=False, max_listeners=8, language="cn", client_kind="微信", preferred_chats=(), transport=None, poll_seconds=5):
        self.rpc = transport or PlusRPC(store_path or ROOT / "data/wxautox4-worker.sqlite3", send_enabled, max_listeners, language, client_kind, preferred_chats)
        self.test_transport = transport is not None
        self.send_enabled = send_enabled
        self.poll_seconds = max(5, poll_seconds)
        self.enabled = False
        self.snapshot = {"state": "connecting", "chats": [], "events": []}
        self.checked_at = 0
        self.acks = []
        self.lock = asyncio.Lock()
        self.next_poll, self.backoff = 0, 5

    def prerequisite(self):
        if self.test_transport:
            return None
        if sys.platform != "win32":
            return "unsupported_os"
        if not (ROOT / ".runtime/wxautox4-venv/Scripts/python.exe").is_file():
            return "dependency_missing"
        if not (ROOT / ".runtime/wxautox4-activation.ready").is_file():
            return "activation_required"
        return None

    async def refresh(self):
        async with self.lock:
            if not self.enabled or time.monotonic() < self.next_poll:
                return
            prerequisite = self.prerequisite()
            if prerequisite:
                self.snapshot = {"state": prerequisite, "chats": [], "events": []}
                self.checked_at = time.monotonic()
                return
            try:
                snapshot = validate_snapshot(await self.rpc.call("poll", ack=self.acks))
                self.snapshot = snapshot
                self.acks = []
                self.backoff = 5
            except Exception:
                await self.rpc.close()
                self.snapshot = {"state": "worker_timeout", "chats": [], "events": []}
                self.next_poll = time.monotonic() + self.backoff
                self.backoff = min(120, self.backoff * 2)
            self.checked_at = time.monotonic()

    async def connect(self):
        self.enabled = True
        await self.refresh()
        return await self.get_connection_status()

    async def disconnect(self):
        self.enabled = False
        await self.rpc.close()

    async def get_connection_status(self):
        code = self.snapshot["state"] if self.enabled else "paused"
        if self.enabled and time.monotonic() - self.checked_at > 50:
            code = "worker_timeout"
        monitoring = self.snapshot.get("monitoring")
        active = code == "ready"
        detail = DETAILS[code]
        if active and monitoring:
            detail += f" 監視中 {monitoring['registered']}件 / 発見 {monitoring['discovered']}件。"
        return Connection("connected" if active else "login_required" if code == "login_required" else "limited",
            "wxautox4", detail, active and self.send_enabled and self.snapshot.get("can_send") is True,
            active, self.snapshot.get("version"), [HISTORY,
            "全友達・全グループの発見は保証しません。監視窓数には上限があり、同名会話は登録しません。",
            "再接続は本人のログイン後。アカウントが異なると停止します。以前の送信先は自動で再指定しません。",
            "Plus SDKのライセンス検証は提供元の仕組みを使用します。実機の対応版・受信・送信は別途検証が必要です。"], monitoring)

    async def get_chats(self):
        return [Chat(**row) for row in self.snapshot.get("chats", [])]

    async def get_messages(self, chat_id):
        return [Message(**e["message"]) for e in self.snapshot.get("events", []) if e["message"]["chat_id"] == chat_id]

    async def watch_messages(self):
        while self.enabled:
            await self.refresh()
            for event in self.snapshot.get("events", []):
                if event["sequence"] in self.acks:
                    continue
                yield Message(**event["message"])
                # The consumer has persisted the event before resuming here.
                self.acks.append(event["sequence"])
            await asyncio.sleep(self.poll_seconds)

    async def send_message(self, chat_id, text):
        # Direct calls without durable queue identity cannot send.
        return Receipt("failed", error="queue_required")

    async def fetch_attachment(self, chat_id, source_key):
        async with self.lock:
            if not (await self.get_connection_status()).can_read:
                raise ValueError("source_unavailable")
            data = await self.rpc.call("media", chat_id=chat_id, source_key=source_key)
            if data.get("error") or not data.get("message"):
                raise ValueError("source_unavailable")
            message = Message(**data["message"])
            if message.chat_id != chat_id or message.source_key != source_key or not message.attachment:
                raise ValueError("source_unavailable")
            validate_attachment(message.attachment)
            return message

    async def send_queued_message(self, chat_id, text, request_id):
        async with self.lock:
            if not (await self.get_connection_status()).can_send:
                return Receipt("failed", error="sending_unavailable")
            if chat_id not in (self.snapshot.get("monitoring") or {}).get("active_chat_ids", []):
                return Receipt("failed", error="destination_mismatch")
            try:
                data = await self.rpc.call("send", request_id=request_id, chat_id=chat_id, text=text)
                if data.get("status") not in ("confirmed", "unknown", "failed"):
                    raise ValueError()
                if data.get("error") not in (None, "idempotency_conflict", "sending_unavailable", "destination_mismatch", "send_result_unavailable"):
                    raise ValueError()
                if data.get("message"):
                    data["message"] = Message(**data["message"])
                return Receipt(**data)
            except Exception:
                self.snapshot = {"state": "worker_timeout", "chats": [], "events": []}
                return Receipt("unknown", error="send_result_unavailable")
