import asyncio
import time
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.adapters.base import Chat, Message, now
from app.adapters.mock import MockWeChatAdapter
from app.config import Settings
from app.database import Database
from app.engine import Engine
from app.main import create_app

TOKEN = "test-only-" + "a" * 40
ORIGIN = "http://127.0.0.1:8765"


def config(tmp_path):
    return Settings(db_path=tmp_path / "mock.sqlite3", token=TOKEN)


@pytest.fixture
def client(tmp_path):
    app = create_app(config(tmp_path))
    with TestClient(app, base_url=ORIGIN) as c:
        c.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
        yield c


def first(client, group=False):
    return next(c for c in client.get("/api/chats").json() if (c["type"] == "group") == group)


def payload(chat, text="自動テストのメッセージ"):
    return {"content": text, "expected_external_id": chat["external_id"], "expected_name": chat["name"], "client_request_id": str(uuid4())}


def wait_for(client, ident, status):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        row = next((q for q in client.get("/api/queue").json() if q["id"] == ident), None)
        if row and row["status"] == status:
            return row
        time.sleep(0.03)
    raise AssertionError(f"Queue did not reach {status}")


def test_mock_chat_list_and_partial_history(client):
    chats = client.get("/api/chats").json()
    assert len(chats) == 5
    assert {c["type"] for c in chats} == {"individual", "group"}
    assert first(client, True)["sync_status"] == "partial"
    assert client.get("/api/status").json()["mode"] == "mock"


@pytest.mark.parametrize("group", [False, True])
def test_reply_with_confirmed_receipt_and_echo_dedup(client, group):
    chat = first(client, group)
    body = payload(chat)
    response = client.post(f'/api/chats/{chat["id"]}/send', json=body)
    assert response.status_code == 202
    result = wait_for(client, response.json()["id"], "confirmed")
    assert result["retry_count"] == 0
    client.post("/api/sync", json={})
    rows = client.get(f'/api/chats/{chat["id"]}/messages').json()["messages"]
    assert len([m for m in rows if m["content"] == body["content"]]) == 1


def test_websocket_new_message(client):
    client.post("/api/auth/login", json={"token": TOKEN})
    chat = first(client, True)
    with client.websocket_connect("ws://127.0.0.1:8765/ws", headers={"Origin": ORIGIN}) as ws:
        assert ws.receive_json()["type"] == "ready"
        assert client.post("/api/mock", json={"action": "receive", "chat_id": chat["id"]}).status_code == 200
        for _ in range(8):
            if ws.receive_json()["type"] == "message":
                break
        else:
            pytest.fail("No real-time message invalidation")
        rows = client.get(f'/api/chats/{chat["id"]}/messages').json()["messages"]
        assert rows[-1]["content"].startswith("新着メッセージ")


def test_history_survives_restart(tmp_path):
    settings = config(tmp_path)
    with TestClient(create_app(settings), base_url=ORIGIN, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        chat = first(c)
        response = c.post(f'/api/chats/{chat["id"]}/send', json=payload(chat, "再起動後にも残る"))
        wait_for(c, response.json()["id"], "confirmed")
        before = c.get(f'/api/chats/{chat["id"]}/messages').json()["messages"]
    with TestClient(create_app(settings), base_url=ORIGIN, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        after = c.get(f'/api/chats/{chat["id"]}/messages').json()["messages"]
        assert before == after


@pytest.mark.parametrize("field", ["expected_external_id", "expected_name"])
def test_destination_mismatch_stops_before_adapter(client, field):
    chat = first(client)
    body = payload(chat)
    body[field] = "wrong-recipient"
    result = client.post(f'/api/chats/{chat["id"]}/send', json=body)
    assert result.status_code == 409
    assert result.json()["detail"] == "destination_mismatch"
    assert client.app.state.engine.adapter.sent_count == 0
    assert client.get("/api/queue").json() == []


def test_duplicate_request_and_idempotency_conflict(client):
    chat = first(client)
    body = payload(chat)
    a = client.post(f'/api/chats/{chat["id"]}/send', json=body)
    b = client.post(f'/api/chats/{chat["id"]}/send', json=body)
    assert a.json()["id"] == b.json()["id"]
    wait_for(client, a.json()["id"], "confirmed")
    assert client.app.state.engine.adapter.sent_count == 1
    body["content"] = "変更された本文"
    assert client.post(f'/api/chats/{chat["id"]}/send', json=body).status_code == 409


def test_deduplicate_external_id_and_fallback(tmp_path):
    db = Database(config(tmp_path).db_path, "mock")
    db.upsert_chat(Chat("a", "test", "individual"))
    message = Message("a", "hello", "b", "friend", "incoming", now(), "id-1")
    assert db.ingest(message)
    assert not db.ingest(message)
    message = replace(message, external_message_id=None)
    assert db.ingest(message)
    assert not db.ingest(message)
    assert db.ingest(replace(message, occurrence="second-occurrence"))
    db.close()


def test_offline_send_never_claims_success(client):
    chat = first(client)
    assert client.post("/api/mock", json={"action": "disconnect"}).status_code == 200
    result = client.post(f'/api/chats/{chat["id"]}/send', json=payload(chat))
    assert result.status_code == 409
    assert not client.get("/api/status").json()["can_send"]
    assert client.get("/api/queue").json() == []
    assert client.post("/api/mock", json={"action": "reconnect"}).json()["can_send"]


@pytest.mark.parametrize("outcome", ["unknown", "failed"])
def test_unknown_and_failed_are_not_retried(client, outcome):
    chat = first(client)
    client.post("/api/mock", json={"action": "next_" + outcome})
    result = client.post(f'/api/chats/{chat["id"]}/send', json=payload(chat))
    wait_for(client, result.json()["id"], outcome)
    client.post("/api/mock", json={"action": "disconnect"})
    client.post("/api/mock", json={"action": "reconnect"})
    time.sleep(0.5)
    assert client.app.state.engine.adapter.sent_count == 1
    assert wait_for(client, result.json()["id"], outcome)["retry_count"] == 0


def test_interrupted_send_becomes_unknown_on_restart(tmp_path):
    path = config(tmp_path).db_path
    db = Database(path, "mock")
    ident = db.upsert_chat(Chat("a", "test", "individual"))
    item = db.enqueue(db.chat(ident), "hello", str(uuid4()), "a", "test")
    assert db.claim()["id"] == item["id"]
    db.close()
    db = Database(path, "mock")
    assert db.queue()[0]["status"] == "unknown"
    assert db.messages(ident)[0]["delivery_status"] == "unknown"
    assert db.claim() is None
    db.close()


def test_queue_revalidates_destination_after_enqueue(tmp_path):
    settings = config(tmp_path)
    db = Database(settings.db_path, "mock")
    adapter = MockWeChatAdapter()
    async def run():
        await adapter.connect()
        chat = (await adapter.get_chats())[0]
        ident = db.upsert_chat(chat)
        db.enqueue(db.chat(ident), "hello", str(uuid4()), chat.external_id, chat.name)
        item = db.claim()
        db.upsert_chat(replace(chat, name="renamed"))
        await Engine(db, adapter, settings).deliver(item)
        assert db.queue()[0]["status"] == "failed"
        assert adapter.sent_count == 0
    asyncio.run(run())
    db.close()


def test_unexpected_sender_exception_is_unknown(tmp_path):
    class Broken(MockWeChatAdapter):
        async def send_message(self, chat_id, text):
            self.sent_count += 1
            raise TimeoutError("secret message must never leave here")
    with TestClient(create_app(config(tmp_path), Broken()), base_url=ORIGIN, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        chat = first(c)
        item = c.post(f'/api/chats/{chat["id"]}/send', json=payload(chat)).json()
        result = wait_for(c, item["id"], "unknown")
        assert result["error_message"] == "send_result_unavailable"


def test_auth_and_csrf(client):
    client.headers.pop("Authorization")
    assert client.get("/api/chats").status_code == 401
    assert client.post("/api/auth/login", json={"token": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"token": "間違った接続キー"}).status_code == 401
    response = client.post("/api/auth/login", json={"token": TOKEN})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    assert client.get("/api/chats").status_code == 200
    assert client.post("/api/mock", json={"action": "disconnect"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/chats").headers["cache-control"] == "no-store"
    cookie = client.cookies.get("wechat_session")
    client.post("/api/auth/logout", json={})
    client.cookies.set("wechat_session", cookie)
    assert client.get("/api/chats").status_code == 401


def test_ws_requires_origin_and_session(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("ws://127.0.0.1:8765/ws", headers={"Origin": ORIGIN}):
            pass
    client.post("/api/auth/login", json={"token": TOKEN})
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("ws://127.0.0.1:8765/ws", headers={"Origin": "https://evil.example"}):
            pass


def test_search_literal_and_validation_does_not_echo_body(client):
    result = client.get("/api/search", params={"q": "カフェ"}).json()
    assert result["results"]
    assert result["scope"] == "stored_only"
    assert client.get("/api/search", params={"q": "%"}).json()["results"] == []
    secret = "private-message-" * 1000
    response = client.post(f'/api/chats/{first(client)["id"]}/send', json={"content": secret})
    assert response.status_code == 422
    assert "private-message" not in response.text


def test_read_cursor_does_not_regress(client):
    chat = first(client)
    rows = client.get(f'/api/chats/{chat["id"]}/messages').json()["messages"]
    latest = rows[-1]["id"]
    client.post(f'/api/chats/{chat["id"]}/read', json={"through_id": latest})
    client.post(f'/api/chats/{chat["id"]}/read', json={"through_id": 0})
    assert next(c for c in client.get("/api/chats").json() if c["id"] == chat["id"])["unread_count"] == 0


def test_websocket_rapid_disconnect_releases_listeners(client):
    assert client.post("/api/auth/login", json={"token": TOKEN}).status_code == 200
    for _ in range(40):
        with client.websocket_connect("ws://127.0.0.1:8765/ws", headers={"Origin": ORIGIN}) as websocket:
            assert websocket.receive_json()["type"] == "ready"
        assert not client.app.state.engine.hub.listeners


def test_adapter_database_separation(tmp_path):
    path = config(tmp_path).db_path
    Database(path, "mock").close()
    with pytest.raises(ValueError):
        Database(path, "windows-uia")


def test_pagination_has_no_duplicates(client):
    chat = first(client)
    first_page = client.get(f'/api/chats/{chat["id"]}/messages?limit=2').json()
    assert first_page["has_more"]
    second = client.get(f'/api/chats/{chat["id"]}/messages?before={first_page["messages"][0]["id"]}&limit=2').json()
    assert not ({r["id"] for r in first_page["messages"]} & {r["id"] for r in second["messages"]})


def test_request_receipt_lookup_does_not_resend(client):
    chat = first(client)
    body = payload(chat)
    response = client.post(f'/api/chats/{chat["id"]}/send', json=body)
    wait_for(client, response.json()["id"], "confirmed")
    for _ in range(3):
        assert client.get('/api/requests/' + body["client_request_id"]).json()["status"] == "confirmed"
    assert client.app.state.engine.adapter.sent_count == 1
    assert client.get('/api/requests/' + str(uuid4())).status_code == 404


def test_same_text_with_distinct_external_ids_is_not_lost(client):
    chat = first(client)
    for _ in range(2):
        item = client.post(f'/api/chats/{chat["id"]}/send', json=payload(chat, "同じ本文を2回送る")).json()
        wait_for(client, item["id"], "confirmed")
    client.post("/api/sync", json={})
    rows = client.get(f'/api/chats/{chat["id"]}/messages').json()["messages"]
    assert len([r for r in rows if r["content"] == "同じ本文を2回送る"]) == 2


def test_offline_pending_queue_is_preserved_until_reconnect(tmp_path):
    settings = config(tmp_path)
    db = Database(settings.db_path, "mock")
    adapter = MockWeChatAdapter()
    chat = adapter.chats[0]
    ident = db.upsert_chat(chat)
    item = db.enqueue(db.chat(ident), "まだ送っていない", str(uuid4()), chat.external_id, chat.name)
    db.close()
    with TestClient(create_app(settings, adapter), base_url=ORIGIN, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        wait_for(c, item["id"], "confirmed")
        assert adapter.sent_count == 1
