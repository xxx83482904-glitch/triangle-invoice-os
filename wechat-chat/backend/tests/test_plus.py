"""Synthetic SDK tests. These are never evidence of licensed real-device success."""
import asyncio
from dataclasses import asdict, replace
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.adapters.base import Chat, Message
from app.adapters.plus_core import PlusFailure, PlusStore, PlusSupervisor, digest
from app.adapters.windows_plus import WindowsPlusAdapter, validate_snapshot
from app.config import Settings
from app.database import Database
from app.engine import Engine
from app.main import create_app


def observation(chat_id, key="1", text="合成テスト", direction="incoming"):
    return Message(chat_id, text, "unavailable", "テスト送信者", direction, None,
        occurrence=key, timestamp_quality="unavailable", source_key="plus:" + key,
        identity_quality="uia_runtime", delivery_status="received" if direction == "incoming" else "unknown")


class FakeSDK:
    def __init__(self):
        self.scope, self.account = "process-1", "synthetic-account-1"
        self.names = ["個人テスト", "グループテスト"]
        self.registered, self.rows, self.events = [], {}, []
        self.send_count = 0
        self.outcome = "confirmed"
        self.valid = True
        self.closed = False
        self.offline = False

    def connect(self):
        if self.offline:
            raise PlusFailure("not_running")
        return self.scope, self.account, "synthetic-client"

    def check_scope(self):
        if self.offline:
            raise PlusFailure("login_required")
        return self.scope

    def account_id(self):
        return self.account

    def sessions(self):
        return self.names

    def listen(self, name):
        self.registered.append(name)
        return {"name": name, "type": "group" if name == "グループテスト" else "individual", "binding": self.scope + name}

    def history(self, target):
        return self.rows.get(target["id"], [])

    def drain(self, targets):
        events, self.events = self.events, []
        return events

    def verify(self, target):
        if not self.valid:
            raise ValueError("private text must not escape")

    def send_once(self, target, text):
        self.send_count += 1
        if self.outcome == "crash":
            raise SystemExit("simulate process death after attempting Send")
        if self.outcome == "exception":
            raise RuntimeError("private message / secret")
        if self.outcome == "confirmed":
            self.rows.setdefault(target["id"], []).append(observation(target["id"], str(uuid4()), text, "outgoing"))
            return True
        return False

    def close(self):
        self.closed = True


@pytest.fixture
def bridge(tmp_path):
    sdk = FakeSDK()
    store = PlusStore(tmp_path / "worker.sqlite3")
    clock = [0]
    core = PlusSupervisor(lambda: sdk, store, send_enabled=True, clock=lambda: clock[0])
    core.tick()
    yield core, sdk, store, clock
    core.close()
    store.close()


def test_discovery_is_partial_bounded_and_throttled(bridge):
    core, sdk, _, clock = bridge
    assert len(core.targets) == 1
    assert core.snapshot()["monitoring"]["complete"] is False
    core.tick()
    assert len(sdk.registered) == 1
    clock[0] = 10
    core.tick()
    assert len(core.targets) == 2
    assert {t["type"] for t in core.targets.values()} == {"individual", "group"}


def test_duplicate_names_never_opened(tmp_path):
    sdk = FakeSDK()
    sdk.names = ["同名", "同名"]
    store = PlusStore(tmp_path / "worker.sqlite3")
    core = PlusSupervisor(lambda: sdk, store)
    core.tick()
    assert sdk.registered == []
    assert core.snapshot()["monitoring"]["ambiguous"] == 2
    assert not core.snapshot()["can_send"]
    store.close()


def test_preferred_chats_only_prioritize_uniquely_observed_sessions(tmp_path):
    sdk = FakeSDK()
    sdk.names = ["通常", "同名", "確認先", "同名"]
    store = PlusStore(tmp_path / "worker.sqlite3")
    core = PlusSupervisor(lambda: sdk, store, preferred_chats=["存在しない宛先", "同名", "確認先"], max_listeners=1)
    core.tick()
    assert sdk.registered == ["確認先"]
    assert core.snapshot()["monitoring"]["ambiguous"] == 2
    core.close()
    store.close()


def test_listener_limit_reports_missing_coverage(bridge):
    core, sdk, _, clock = bridge
    core.max_listeners = 1
    clock[0] = 100
    core.tick()
    m = core.snapshot()["monitoring"]
    assert m["registered"] == 1 and m["discovered"] == 2 and not m["complete"]


def test_known_unsupported_kind_does_not_disconnect_verified_chats(bridge):
    core, sdk, _, clock = bridge
    def unsupported(name): raise PlusFailure('unsupported_chat')
    sdk.listen = unsupported
    clock[0] = 10
    core.tick()
    assert len(core.targets) == 1 and core.state == 'ready'
    assert core.snapshot()['monitoring']['registration_failures'] == 1
    clock[0] = 90
    core.tick()
    assert core.snapshot()['monitoring']['registration_failures'] == 1


def test_failed_history_never_enables_target_or_repeats_window_opening(tmp_path):
    sdk = FakeSDK()
    def broken_history(target):
        raise RuntimeError("private text")
    sdk.history = broken_history
    store = PlusStore(tmp_path / "worker.sqlite3")
    clock = [0]
    core = PlusSupervisor(lambda: sdk, store, send_enabled=True, clock=lambda: clock[0])
    core.tick()
    assert core.state == "binding_unavailable"
    assert not core.targets and not core.snapshot()["can_send"]
    assert store.chats() == []
    clock[0] = 10000
    core.tick()
    assert len(sdk.registered) == 1
    store.close()


def test_inbox_persists_until_ack_and_sequence_never_reused(tmp_path):
    path = tmp_path / "worker.sqlite3"
    store = PlusStore(path)
    message = observation("a")
    store.ingest(message)
    store.ingest(message)
    assert len(store.inbox()) == 1
    first = store.inbox()[0]["sequence"]
    store.close()
    store = PlusStore(path)
    assert len(store.inbox()) == 1
    store.ack([first])
    store.ingest(observation("a", "2"))
    assert store.inbox()[0]["sequence"] > first
    store.ack([first])
    assert len(store.inbox()) == 1
    store.close()


def test_restart_restores_listeners_without_merging_name_only(bridge):
    core, sdk, _, clock = bridge
    old = next(iter(core.targets))
    sdk.scope = "process-2"
    core.tick()
    assert core.state == "not_running" and not core.targets
    clock[0] = 20
    core.tick()
    assert core.state == "ready"
    assert old not in core.targets
    assert len(core.snapshot()["chats"]) == 2
    assert core.snapshot()["monitoring"]["reconnections"] == 1
    assert core.send(str(uuid4()), old, "test").status == "failed"
    assert sdk.send_count == 0


def test_account_switch_blocks_reading_and_sending(bridge):
    core, sdk, _, clock = bridge
    sdk.scope, sdk.account = "process-2", "different-account"
    core.tick()
    clock[0] = 20
    core.tick()
    assert core.state == "account_mismatch"
    assert not core.snapshot()["can_send"]
    clock[0] = 2000
    core.tick()
    assert core.state == "account_mismatch"
    assert len(sdk.registered) == 1


@pytest.mark.parametrize("failure", ["wrong_window", "account", "scope", "offline"])
def test_preflight_prevents_send(bridge, failure):
    core, sdk, _, _ = bridge
    ident = next(iter(core.targets))
    if failure == "wrong_window": sdk.valid = False
    if failure == "account": sdk.account = "other-account"
    if failure == "scope": sdk.scope = "other-process"
    if failure == "offline": sdk.offline = True
    receipt = core.send(str(uuid4()), ident, "送信しない")
    assert receipt.status == "failed" and sdk.send_count == 0


@pytest.mark.parametrize("group", [False, True])
def test_queue_send_receipt_and_idempotency(bridge, group):
    core, sdk, _, clock = bridge
    clock[0] = 10
    core.tick()
    ident = next(i for i,t in core.targets.items() if t["type"] == ("group" if group else "individual"))
    request = str(uuid4())
    a = core.send(request, ident, "こんにちは")
    b = core.send(request, ident, "こんにちは")
    assert a.status == b.status == "confirmed"
    assert sdk.send_count == 1
    assert core.send(request, ident, "変更").error == "idempotency_conflict"


@pytest.mark.parametrize("outcome", ["unknown", "exception", "crash"])
def test_uncertain_send_not_retried_even_after_worker_restart(bridge, outcome):
    core, sdk, store, _ = bridge
    sdk.outcome = outcome
    request, ident = str(uuid4()), next(iter(core.targets))
    if outcome == "crash":
        with pytest.raises(SystemExit):
            core.send(request, ident, "once")
    else:
        assert core.send(request, ident, "once").status == "unknown"
    fresh = PlusSupervisor(lambda: sdk, store, send_enabled=True)
    fresh.tick()
    receipt = fresh.send(request, ident, "once")
    assert receipt.status == "unknown"
    assert sdk.send_count == 1
    assert receipt.error == "send_result_unavailable"


def test_default_sender_gate(bridge):
    core, sdk, _, _ = bridge
    core.send_enabled = False
    assert core.send(str(uuid4()), next(iter(core.targets)), "no").status == "failed"
    assert sdk.send_count == 0


@pytest.mark.parametrize('outcome', ['delayed', 'missing', 'duplicate', 'scope_changed'])
def test_receipt_wait_only_reads_and_never_resends(bridge, outcome):
    core, sdk, store, _ = bridge
    ident = next(iter(core.targets))
    original = sdk.send_once
    pending = []
    pauses = []
    def send_once(target, text):
        original(target, text)
        pending.extend(sdk.rows.pop(ident))
        return True
    def pause(seconds):
        pauses.append(seconds)
        if outcome == 'delayed': sdk.rows[ident] = pending
        if outcome == 'duplicate': sdk.rows[ident] = pending + [replace(pending[0], source_key='another-echo')]
        if outcome == 'scope_changed': sdk.scope = 'different-process'
    sdk.send_once, core.receipt_pause = send_once, pause
    request = str(uuid4())
    receipt = core.send(request, ident, 'once')
    assert receipt.status == ('confirmed' if outcome == 'delayed' else 'unknown')
    assert len(pauses) == (4 if outcome == 'missing' else 1)
    assert sdk.send_count == 1
    assert store.previous(request, digest([ident, 'once'])).status == receipt.status
    assert core.send(request, ident, 'once').status == receipt.status
    assert sdk.send_count == 1


@pytest.mark.parametrize("echo_before", [False, True])
def test_queue_reconciles_uia_echo(tmp_path, echo_before):
    db = Database(tmp_path / "app.sqlite3", "wxautox4")
    ident = db.upsert_chat(Chat("local", "test", "individual"))
    item = db.enqueue(db.chat(ident), "hello", str(uuid4()), "local", "test")
    message = observation("local", text="hello", direction="outgoing")
    if echo_before:
        assert db.ingest(message)
    db.finish(item, "confirmed", message=message)
    assert not db.ingest(message)
    rows = db.messages(ident)
    assert len(rows) == 1 and rows[0]["id"] == item["message_id"]
    assert rows[0]["source_key"] == message.source_key and rows[0]["identity_quality"] == "uia_runtime"
    assert rows[0]["delivery_status"] == "confirmed"
    db.close()


def test_conflicting_receipt_preserves_both_rows(tmp_path):
    db = Database(tmp_path / "app.sqlite3", "mock")
    ident = db.upsert_chat(Chat("a", "test", "individual"))
    item = db.enqueue(db.chat(ident), "hello", str(uuid4()), "a", "test")
    db.ingest(observation("a", text="different", direction="outgoing"))
    db.finish(item, "confirmed", message=observation("a", text="hello", direction="outgoing"))
    assert db.queue()[0]["status"] == "unknown"
    assert len(db.messages(ident)) == 2
    db.close()


class InProcessRPC:
    def __init__(self, core):
        self.core = core
        self.calls = []

    async def call(self, action, **data):
        self.calls.append(action)
        if action == "poll":
            self.core.store.ack(data.get("ack", []))
            self.core.tick()
            return self.core.snapshot()
        return asdict(self.core.send(data["request_id"], data["chat_id"], data["text"]))

    async def close(self):
        pass


def test_adapter_no_sdk_calls_from_status_and_no_direct_send(bridge):
    core, _, _, _ = bridge
    rpc = InProcessRPC(core)
    adapter = WindowsPlusAdapter(transport=rpc, send_enabled=True)
    async def run():
        await adapter.connect()
        assert (await adapter.get_connection_status()).can_read
        for _ in range(20):
            await adapter.get_connection_status()
        assert rpc.calls == ["poll"]
        assert (await adapter.send_message("a", "no")).error == "queue_required"
    asyncio.run(run())


def test_adapter_ack_only_after_consumer_resumes(bridge):
    core, _, store, _ = bridge
    ident = next(iter(core.targets))
    store.ingest(observation(ident))
    adapter = WindowsPlusAdapter(transport=InProcessRPC(core))
    async def run():
        await adapter.connect()
        watcher = adapter.watch_messages()
        message = await anext(watcher)
        assert message.chat_id == ident
        assert adapter.acks == []
        await watcher.aclose()  # Simulate crash before consumer commits.
        await adapter.refresh()
        assert len(store.inbox()) == 1
    asyncio.run(run())


def test_snapshot_rejects_fabricated_fields(bridge):
    core, _, store, _ = bridge
    store.ingest(observation(next(iter(core.targets))))
    snapshot = core.snapshot()
    assert validate_snapshot(snapshot)
    snapshot["events"][0]["message"]["timestamp"] = "2026-01-01T12:00:00Z"
    with pytest.raises(ValueError):
        validate_snapshot(snapshot)


def test_authenticated_plus_api_without_activation(tmp_path):
    # The normal app can start in Plus mode without importing the vendor SDK.
    settings = Settings(db_path=tmp_path / "app.sqlite3", token="t" * 40, adapter="wxautox4")
    adapter = WindowsPlusAdapter()
    adapter.prerequisite = lambda: "activation_required"
    with TestClient(create_app(settings, adapter), base_url="http://127.0.0.1:8765") as client:
        assert client.get("/api/status").status_code == 401
        status = client.get("/api/status", headers={"Authorization": "Bearer " + settings.token}).json()
        assert status["mode"] == "wxautox4" and not status["can_read"] and not status["can_send"]
        assert "ライセンス認証" in status["detail"]


def test_engine_uses_durable_queue_id(bridge, tmp_path):
    core, sdk, _, _ = bridge
    rpc = InProcessRPC(core)
    adapter = WindowsPlusAdapter(transport=rpc, send_enabled=True)
    settings = Settings(db_path=tmp_path / "app.sqlite3", token="t" * 40, adapter="wxautox4")
    db = Database(settings.db_path, "wxautox4")
    async def run():
        await adapter.connect()
        chat = (await adapter.get_chats())[0]
        ident = db.upsert_chat(chat)
        item = db.enqueue(db.chat(ident), "手動で送信した合成メッセージ", str(uuid4()), chat.external_id, chat.name)
        await Engine(db, adapter, settings).deliver(db.claim())
        await Engine(db, adapter, settings).deliver(item)
        assert sdk.send_count == 1
        assert db.queue()[0]["status"] == "confirmed"
    asyncio.run(run())
    db.close()
