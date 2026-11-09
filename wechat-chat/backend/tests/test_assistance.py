from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.adapters.base import Message, now
from app.config import Settings
from app.main import create_app

TOKEN = "assistance-test-only-" + "a" * 40
ORIGIN = "http://127.0.0.1:8765"


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "test.sqlite3", token=TOKEN))
    with TestClient(app, base_url=ORIGIN) as c:
        c.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
        yield c


def target(client, external="mock:lin"):
    return next(c for c in client.get("/api/chats").json() if c["external_id"] == external)


def item(client, chat):
    return next(i for i in client.get("/api/attention").json()["items"] if i["chat_id"] == chat["id"])


def incoming(client, chat, text):
    client.app.state.db.ingest(Message(chat["external_id"], text, "fixture", "テスト", "incoming", now(), str(uuid4())))
    return client.app.state.db.messages(chat["id"])[-1]


def task_payload(client, chat):
    return {"chat_id": chat["id"], "source_message_id": item(client, chat)["source_message_id"], "title": "予定を確認する", "due_date": "2026-11-20", "client_request_id": str(uuid4())}


def test_assistance_is_local_and_reading_never_sends_or_marks_read(client):
    before = client.get("/api/chats").json()
    result = client.get("/api/attention").json()
    assert result["provider"] == "local_rules" and result["ai_connected"] is False
    assert result["history_scope"] == "stored_recent_50"
    assert client.get("/api/chats").json() == before
    assert client.get("/api/tasks").json() == []
    assert client.get("/api/queue").json() == []
    assert client.app.state.engine.adapter.sent_count == 0
    group = item(client, target(client, "mock:studio"))
    assert any("グループ" in r for r in group["reasons"])
    assert any("一部履歴" in r for r in group["reasons"])


@pytest.mark.parametrize("text,priority,state", [
    ("今日中に確認してもらえますか？", "high", "reply_candidate"),
    ("急ぎません。確認してもらえますか？", "normal", "reply_candidate"),
    ("不急，请确认一下", "normal", "reply_candidate"),
    ("ありがとうございます！", "low", "no_candidate"),
])
def test_priority_is_explainable_and_does_not_treat_no_rush_as_urgent(client, text, priority, state):
    chat = target(client)
    source = incoming(client, chat, text)
    assessed = item(client, chat)
    assert (assessed["priority"], assessed["state"]) == (priority, state)
    assert assessed["source_message_id"] == source["id"]
    assert assessed["reasons"]


def test_read_is_not_replied_and_confirmed_reply_clears_candidate(client):
    chat = target(client)
    source = incoming(client, chat, "明日の予定を教えてください。")
    client.post(f"/api/chats/{chat['id']}/read", json={"through_id": source["id"]})
    assert item(client, chat)["state"] == "reply_candidate"
    client.app.state.db.ingest(Message(chat["external_id"], "確認しました", "self", "自分", "outgoing", now(), str(uuid4())))
    assert item(client, chat)["state"] == "no_candidate"
    incoming(client, chat, "次の日程も確認してください。")
    assert item(client, chat)["state"] == "reply_candidate"


def test_unknown_send_blocks_reply_suggestions_and_never_retries(client):
    chat = target(client)
    db = client.app.state.db
    queued = db.enqueue(chat, "確認待ち", str(uuid4()), chat["external_id"], chat["name"])
    db.finish(queued, "unknown", "test_unknown")
    assessed = item(client, chat)
    assert assessed["state"] == "review_send" and assessed["suggestions"] == []
    assert client.app.state.engine.adapter.sent_count == 0
    assert db.one("SELECT status FROM send_queue WHERE id=?", (queued["id"],))["status"] == "unknown"


def test_manual_priority_and_reset(client):
    chat = target(client)
    path = f"/api/chats/{chat['id']}/priority"
    assert client.post(path, json={"priority": "low"}).status_code == 200
    incoming(client, chat, "至急、確認してください")
    assert item(client, chat)["priority"] == "low"
    assert item(client, chat)["priority_origin"] == "manual"
    assert client.post(path, json={"priority": "auto"}).status_code == 200
    assert item(client, chat)["priority"] == "high"
    assert client.post(path, json={"priority": "invalid"}).status_code == 422


def test_tasks_validate_source_and_idempotency(client):
    chat = target(client)
    body = task_payload(client, chat)
    result = client.post("/api/tasks", json=body)
    assert result.status_code == 201
    assert client.post("/api/tasks", json=body).json()["id"] == result.json()["id"]
    assert client.post("/api/tasks", json={**body, "title": "別内容"}).status_code == 409
    assert client.post("/api/tasks", json={**body, "client_request_id": str(uuid4())}).json()["detail"] == "task_already_exists"
    other = target(client, "mock:studio")
    assert client.post("/api/tasks", json={**body, "chat_id": other["id"], "client_request_id": str(uuid4())}).json()["detail"] == "source_mismatch"
    assert client.post("/api/tasks", json={**body, "due_date": "2026-02-30"}).status_code == 422
    assert client.post("/api/tasks", json={**body, "title": "  "}).status_code == 422
    assert len(client.get("/api/tasks").json()) == 1
    assert client.get("/api/queue").json() == []


def test_tasks_and_manual_priority_survive_app_restart(tmp_path):
    config = Settings(db_path=tmp_path / "persistent.sqlite3", token=TOKEN)
    headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}
    with TestClient(create_app(config), base_url=ORIGIN, headers=headers) as c:
        chat = target(c)
        c.post(f"/api/chats/{chat['id']}/priority", json={"priority": "high"})
        task = c.post("/api/tasks", json=task_payload(c, chat)).json()
        assert c.post(f"/api/tasks/{task['id']}/state", json={"status": "done"}).status_code == 200
    with TestClient(create_app(config), base_url=ORIGIN, headers=headers) as c:
        saved = c.get("/api/tasks").json()
        assert len(saved) == 1 and saved[0]["status"] == "done"
        assert saved[0]["source_content"] == item(c, chat)["source_content"]
        assert item(c, chat)["priority_origin"] == "manual"
        assert c.post(f"/api/tasks/{task['id']}/state", json={"status": "open"}).json()["status"] == "open"


def test_assistance_and_task_endpoints_require_authentication_and_origin(client):
    chat = target(client)
    body = task_payload(client, chat)
    client.headers.pop("Authorization")
    assert client.get("/api/attention").status_code == 401
    assert client.get("/api/tasks").status_code == 401
    assert client.post("/api/tasks", json=body).status_code == 401
    assert client.post(f"/api/chats/{chat['id']}/priority", json={"priority": "low"}).status_code == 401
    assert client.post("/api/tasks/missing/state", json={"status": "done"}).status_code == 401
    # Cookie-authenticated browser writes require an allowed Origin. Bearer
    # clients have an explicit credential and intentionally use a different path.
    assert client.post("/api/auth/login", json={"token": TOKEN}).status_code == 200
    assert client.post("/api/tasks", json=body, headers={"Origin": "https://evil.example"}).status_code == 403
