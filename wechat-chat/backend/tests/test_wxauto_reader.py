import asyncio
from copy import deepcopy
from pathlib import Path
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.adapters.base import Chat
from app.adapters.windows_wxauto4 import WindowsWxauto4Adapter
from app.adapters.wxauto4_data import digest, observation_key, validate_snapshot
from app.config import Settings
from app.database import Database
from app.main import create_app
from app.assistance import LocalRulesProvider


def snapshot(name="試験グループ", kind="group", content="確認をお願いします", outgoing=False, runtime=1):
    scope = digest("synthetic process scope")
    key = observation_key(scope, name, kind, [42, runtime], content)
    return {"state": "ready", "chat": {"scope": scope, "name": name, "type": kind,
        "external_id": "wxauto4:local:" + digest([scope, name, kind]), "member_count": 3 if kind == "group" else None},
        "messages": [{"source_key": key, "content": content, "sender_name": "" if outgoing else "テスト送信者",
                      "direction": "outgoing" if outgoing else "incoming"}], "discovered_count": 2}


def test_same_observation_survives_restart_without_claiming_external_ids_or_delivery(tmp_path):
    async def check():
        adapter = WindowsWxauto4Adapter(runner=lambda: snapshot(outgoing=True))
        await adapter.connect()
        chats = await adapter.get_chats()
        messages = await adapter.get_messages(chats[0].external_id)
        path = tmp_path / "reader.sqlite3"
        db = Database(path, "wxauto4")
        ident = db.upsert_chat(chats[0])
        assert db.ingest(messages[0]) is True
        assert db.ingest(messages[0]) is False
        original = db.messages(ident)
        db.close()
        db = Database(path, "wxauto4")
        assert db.ingest(messages[0]) is False
        assert db.messages(ident) == original
        row = original[0]
        assert row["external_message_id"] is None and row["timestamp"] is None
        assert row["delivery_status"] == "unknown" and row["identity_quality"] == "uia_runtime"
        assert row["sender_id"] == row["sender_name"] == ""
        assert row["source_key"] and row["observed_at"]
        assert db.queue() == []
        assert not (await adapter.get_connection_status()).can_send
        db.close()
    asyncio.run(check())


def test_identical_text_in_distinct_ui_items_is_not_collapsed(tmp_path):
    async def check():
        active = snapshot(runtime=1)
        adapter = WindowsWxauto4Adapter(runner=lambda: active)
        await adapter.connect()
        chat = (await adapter.get_chats())[0]
        db = Database(tmp_path / "db.sqlite3", "wxauto4")
        ident = db.upsert_chat(chat)
        assert db.ingest((await adapter.get_messages(chat.external_id))[0])
        active = snapshot(runtime=2)
        await adapter.refresh()
        assert db.ingest((await adapter.get_messages(chat.external_id))[0])
        assert len(db.messages(ident)) == 2
        db.close()
    asyncio.run(check())


def test_same_source_cannot_be_reassigned_a_sender_or_direction(tmp_path):
    async def check():
        adapter = WindowsWxauto4Adapter(runner=snapshot)
        await adapter.connect()
        chat = (await adapter.get_chats())[0]
        message = (await adapter.get_messages(chat.external_id))[0]
        db = Database(tmp_path / "db.sqlite3", "wxauto4")
        db.upsert_chat(chat)
        assert db.ingest(message)
        message.sender_name = "別の人"
        with pytest.raises(ValueError, match="source_observation_conflict"):
            db.ingest(message)
        db.close()
    asyncio.run(check())


@pytest.mark.parametrize("state", ["scope_changed", "login_required", "not_running", "reader_failed", "reader_timeout"])
def test_disconnect_or_account_scope_change_never_reuses_a_readable_snapshot(state):
    async def check():
        current = snapshot()
        adapter = WindowsWxauto4Adapter(runner=lambda: current)
        await adapter.connect()
        assert (await adapter.get_connection_status()).can_read
        current = {"state": state}
        await adapter.refresh()
        status = await adapter.get_connection_status()
        assert not status.can_read and not status.can_send
        assert await adapter.get_chats() == []
        assert (await adapter.send_message("anything", "not sent")).status == "failed"
    asyncio.run(check())


def test_status_queries_do_not_run_desktop_operations():
    async def check():
        calls = []
        def run():
            calls.append(1)
            return snapshot()
        adapter = WindowsWxauto4Adapter(runner=run)
        await adapter.connect()
        for _ in range(30):
            await adapter.get_connection_status()
        assert len(calls) == 1
    asyncio.run(check())


def test_observed_outgoing_history_does_not_become_a_failed_app_send():
    chat = {"id": "test", "name": "試験", "type": "individual", "sync_status": "partial"}
    messages = [
        {"id": 1, "direction": "outgoing", "content": "以前の発言", "identity_quality": "uia_runtime",
         "delivery_status": "unknown", "message_type": "text", "timestamp": None, "timestamp_quality": "unavailable"},
        {"id": 2, "direction": "incoming", "content": "確認をお願いします", "identity_quality": "uia_runtime",
         "delivery_status": "received", "message_type": "text", "timestamp": None, "timestamp_quality": "unavailable"},
    ]
    result = LocalRulesProvider().assess(chat, messages)
    assert result["state"] == "reply_candidate"
    assert result["priority"] == "normal"


def test_private_ipc_rejects_mismatched_chats_and_drops_diagnostic_text():
    data = snapshot()
    data.update(raw_exception="PRIVATE_ACCOUNT", can_send=True)
    data["messages"][0]["raw_control"] = "PRIVATE_TEXT"
    clean = validate_snapshot(data)
    assert "PRIVATE" not in str(clean) and "can_send" not in clean
    data["chat"]["external_id"] = "wxauto4:local:" + "a" * 64
    with pytest.raises(ValueError, match="chat_identity_mismatch"):
        validate_snapshot(data)


@pytest.mark.parametrize("change", ["duplicate", "too_many_actions", "unknown_state", "bad_direction"])
def test_invalid_worker_results_are_fail_closed(change):
    data = snapshot()
    if change == "duplicate":
        data["messages"].append(deepcopy(data["messages"][0]))
    elif change == "too_many_actions":
        data["menu_count"] = 3
    elif change == "unknown_state":
        data["state"] = "PRIVATE_ERROR"
    else:
        data["messages"][0]["direction"] = "guessed"
    async def check():
        adapter = WindowsWxauto4Adapter(runner=lambda: data)
        assert not (await adapter.connect()).can_read
        assert await adapter.get_chats() == []
    asyncio.run(check())


def test_worker_timeout_does_not_expose_library_output(monkeypatch):
    import app.adapters.windows_wxauto4 as module
    monkeypatch.setattr(module.sys, "platform", "win32")
    monkeypatch.setattr(module.subprocess, "CREATE_NO_WINDOW", getattr(module.subprocess, "CREATE_NO_WINDOW", 0), raising=False)
    monkeypatch.setattr(Path, "is_file", lambda self: True)
    def timeout(*args, **kwargs):
        assert kwargs["timeout"] == 18
        raise subprocess.TimeoutExpired(args[0], 18, output=b"PRIVATE_CONTENT")
    monkeypatch.setattr(module.subprocess, "run", timeout)
    assert WindowsWxauto4Adapter._run() == {"state": "reader_timeout"}


def test_new_chat_event_saves_metadata_and_authenticated_api_remains_read_only(tmp_path):
    current = snapshot()
    adapter = WindowsWxauto4Adapter(runner=lambda: deepcopy(current))
    adapter.poll_seconds = 0.02  # Synthetic runner only; no Windows package is imported.
    token = "reader-test-" + "x" * 40
    origin = "http://127.0.0.1:8765"
    settings = Settings(db_path=tmp_path / "db.sqlite3", token=token, adapter="wxauto4")
    with TestClient(create_app(settings, adapter=adapter), base_url=origin) as client:
        assert client.get("/api/chats").status_code == 401
        client.post("/api/auth/login", json={"token": token}, headers={"Origin": origin})
        first = client.get("/api/chats").json()
        assert len(first) == 1 and first[0]["type"] == "group"
        current = snapshot(name="別のテスト会話", kind="individual")
        with client.websocket_connect("ws://127.0.0.1:8765/ws/events", headers={"Origin": origin}) as ws:
            for _ in range(10):
                event = ws.receive_json()
                rows = client.get("/api/chats").json()
                if len(rows) == 2:
                    break
            assert len(rows) == 2
        new_chat = next(row for row in rows if row["type"] == "individual")
        messages = client.get(f"/api/chats/{new_chat['id']}/messages").json()
        assert messages["messages"][0]["content"] == "確認をお願いします"
        response = client.post(f"/api/chats/{new_chat['id']}/messages", json={"content": "送信しない",
            "expected_external_id": new_chat["external_id"], "expected_name": new_chat["name"],
            "client_request_id": "48f529d0-1f08-42b7-92af-b891913fc309"}, headers={"Origin": origin})
        assert response.status_code in (409, 503)
        assert client.get("/api/queue").json() == []
