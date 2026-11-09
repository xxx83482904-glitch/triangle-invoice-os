import asyncio
import json
import time
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai_provider import AIError, INSTRUCTIONS, OpenAIProvider
from app.config import Settings
from app.main import create_app

ORIGIN = "http://127.0.0.1:8765"
TOKEN = "ai-test-only-" + "x" * 40


class SyntheticProvider:
    """Test fixture only, never selectable by environment or a production route."""
    name, model, ready = "synthetic_test", "synthetic-fixture", True

    def __init__(self):
        self.calls = []
        self.behavior = "normal"

    async def generate(self, operation, payload):
        self.calls.append((operation, payload))
        if self.behavior == "wait":
            await asyncio.Event().wait()
        if self.behavior == "unknown":
            raise AIError("ai_result_unknown", unknown=True)
        if self.behavior == "invalid":
            return {"private_error": "PRIVATE DO NOT LOG"}
        if operation == "translate":
            return {"text": "確認してからご連絡します。" if payload["target_language"] == "ja" else "我确认后再回复您。"}
        if operation == "reply":
            return {"candidates": ["谢谢您的消息，我确认后再回复您。", "请问您希望我什么时候回复？"]}
        if operation == "summarize":
            return {"summary": "確認を依頼されている会話です。", "decisions": ["返答の時期は未確定です。"]}
        index = next((m["index"] for m in payload["messages"] if m["role"] == "other"), 0)
        return {"tasks": [{"title": "依頼内容を確認する", "source_index": index, "due_date": None}]}


def settings(tmp_path, enabled=True):
    return Settings(db_path=tmp_path / "mock.sqlite3", token=TOKEN, ai_enabled=enabled,
                    wxauto_trial_report=tmp_path / "missing.json")


def login(client):
    assert client.post("/api/auth/login", json={"token": TOKEN}, headers={"Origin": ORIGIN}).status_code == 200


def selection(client):
    chats = client.get("/api/chats").json()
    chat = next(c for c in chats if c["external_id"] == "mock:lin")
    rows = client.get(f"/api/chats/{chat['id']}/messages").json()["messages"]
    message = next(m for m in reversed(rows) if m["direction"] == "incoming")
    return chat, message


def preview(client, operation="translate", **extra):
    chat, message = selection(client)
    body = {"chat_id": chat["id"], "operation": operation, "message_ids": [message["id"]], **extra}
    return client.post("/api/ai/preview", json=body, headers={"Origin": ORIGIN})


def start(client, prepared):
    return client.post("/api/ai/" + prepared["operation"], json={"preview_id": prepared["id"], "approved": True}, headers={"Origin": ORIGIN})


def finished(client, ident):
    for _ in range(100):
        row = client.get("/api/ai/jobs/" + ident).json()
        if row["status"] != "processing":
            return row
        time.sleep(.01)
    raise AssertionError("synthetic generation did not finish")


def test_ai_requires_authentication_preview_and_explicit_consent(tmp_path):
    provider = SyntheticProvider()
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        assert client.get("/api/ai/status").status_code == 401
        assert client.post("/api/ai/preview", json={}).status_code == 401
        login(client)
        prepared = preview(client).json()
        assert provider.calls == []
        for approval in ({}, {"approved": False}):
            response = client.post("/api/ai/translate", json={"preview_id": prepared["id"], **approval}, headers={"Origin": ORIGIN})
            assert response.status_code == 422
        assert client.post("/api/ai/translate", json={"preview_id": prepared["id"], "approved": True}, headers={"Origin":"https://evil.example"}).status_code == 403
        assert provider.calls == []
        assert start(client, prepared).status_code == 202
        finished(client, prepared["id"])
        assert len(provider.calls) == 1


@pytest.mark.parametrize("operation", ["translate", "reply", "summarize", "tasks"])
def test_ai_uses_only_previewed_content_and_never_sends_or_creates_tasks(tmp_path, operation):
    provider = SyntheticProvider()
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        chat, message = selection(client)
        prepared = preview(client, operation).json()
        assert prepared["instructions"] == INSTRUCTIONS
        assert len(prepared["payload"]["messages"]) == 1
        assert prepared["payload"]["messages"][0]["content"] == message["content"]
        assert "sender_name" not in json.dumps(prepared["payload"])
        assert chat["external_id"] not in json.dumps(prepared["payload"])
        start(client, prepared)
        result = finished(client, prepared["id"])
        assert result["status"] == "completed"
        assert provider.calls == [(operation, prepared["payload"])]
        assert client.get("/api/queue").json() == []
        assert client.get("/api/tasks").json() == []
        assert client.app.state.engine.adapter.sent_count == 0
        # A lost HTTP acknowledgement may be checked or repeated with the same
        # preview receipt, but it never invokes the provider twice.
        assert start(client, prepared).json()["id"] == result["id"]
        assert len(provider.calls) == 1
        if operation == "tasks":
            assert result["result"]["tasks"][0]["source_message_id"] == message["id"]
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        assert client.get("/api/ai/jobs/" + prepared["id"]).json()["result"] == result["result"]
        assert len(provider.calls) == 1


def test_disabled_mode_preview_is_local_and_cross_chat_selection_rejected(tmp_path):
    provider = SyntheticProvider()
    with TestClient(create_app(settings(tmp_path, enabled=False), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        prepared = preview(client).json()
        assert prepared["ready"] is False
        assert start(client, prepared).json()["detail"] == "ai_disabled"
        chats = client.get("/api/chats").json()
        source_chat, source = selection(client)
        other = next(c for c in chats if c["id"] != source_chat["id"])
        assert preview(client, chat_id=other["id"], message_ids=[source["id"]]).status_code == 409
        assert preview(client, message_ids=[source["id"]] * 11).status_code == 422
        assert preview(client, message_ids=[source["id"], source["id"]]).status_code == 409
        assert provider.calls == []


def test_ai_preview_expiry_operation_mismatch_and_context_limit(tmp_path):
    provider = SyntheticProvider()
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        prepared = preview(client).json()
        mismatched = {**prepared, "operation":"reply"}
        assert start(client, mismatched).json()["detail"] == "ai_preview_mismatch"
        client.app.state.ai.previews[prepared["id"]]["expires"] = 0
        assert start(client, prepared).json()["detail"] == "ai_preview_expired"
        chat, _ = selection(client)
        rows = client.get(f"/api/chats/{chat['id']}/messages").json()["messages"]
        for row in rows:
            with client.app.state.db.conn:
                client.app.state.db.conn.execute("UPDATE messages SET content=? WHERE id=?", ("x"*4000,row["id"]))
        assert preview(client, "summarize", message_ids=[row["id"] for row in rows[:3]]).json()["detail"] == "ai_context_too_large"
        assert provider.calls == []


@pytest.mark.parametrize("behavior,expected", [("unknown","unknown"),("invalid","failed")])
def test_failed_generation_is_redacted_and_never_retried(tmp_path, behavior, expected):
    provider = SyntheticProvider()
    provider.behavior = behavior
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        prepared = preview(client).json()
        start(client, prepared)
        row = finished(client, prepared["id"])
        assert row["status"] == expected and row["result"] is None
        assert "PRIVATE" not in json.dumps(row)
        start(client, prepared)
        assert len(provider.calls) == 1


def test_interrupted_generation_stays_unknown_after_restart(tmp_path):
    provider = SyntheticProvider()
    provider.behavior = "wait"
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        prepared = preview(client).json()
        start(client, prepared)
        for _ in range(100):
            if provider.calls:
                break
            time.sleep(.01)
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        row = client.get("/api/ai/jobs/" + prepared["id"]).json()
        assert row["status"] == "unknown"
        start(client, prepared)
        assert len(provider.calls) == 1


def test_openai_transport_has_no_storage_tools_retries_or_hidden_context():
    calls = []
    def handle(request):
        calls.append(request)
        payload = json.loads(request.content)
        assert str(request.url) == "https://api.openai.com/v1/responses"
        assert payload["store"] is False
        assert not any(k in payload for k in ("tools","previous_response_id","conversation"))
        assert payload["text"]["format"]["strict"] is True
        assert json.loads(payload["input"][0]["content"]) == {"task":"translate","draft":"synthetic"}
        return httpx.Response(200, json={"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":'{"text":"合成訳文"}'}]}]})
    provider = OpenAIProvider("synthetic-key", "synthetic-model", httpx.MockTransport(handle))
    assert asyncio.run(provider.generate("translate", {"task":"translate","draft":"synthetic"})) == {"text":"合成訳文"}
    assert len(calls) == 1


def test_openai_errors_do_not_expose_body_or_credentials():
    def reject(request):
        return httpx.Response(401, json={"error":"PRIVATE PROMPT synthetic-key"})
    provider = OpenAIProvider("synthetic-key", "synthetic-model", httpx.MockTransport(reject))
    with pytest.raises(AIError) as error:
        asyncio.run(provider.generate("translate", {}))
    assert str(error.value) == "ai_provider_rejected"


def test_required_message_and_websocket_aliases_share_safety_checks(tmp_path):
    with TestClient(create_app(settings(tmp_path, enabled=False)), base_url=ORIGIN) as client:
        assert client.post("/api/chats/missing/messages", json={}).status_code == 401
        login(client)
        chat, _ = selection(client)
        payload = {"content":"synthetic alias check", "client_request_id":str(uuid4()),
                   "expected_external_id":"incorrect", "expected_name":chat["name"]}
        assert client.post(f"/api/chats/{chat['id']}/messages",json=payload,headers={"Origin":ORIGIN}).json()["detail"] == "destination_mismatch"
        assert client.get("/api/queue").json() == []
        with client.websocket_connect("ws://127.0.0.1:8765/ws/events", headers={"Origin":ORIGIN}) as socket:
            assert socket.receive_json()["type"] == "ready"


def test_invalid_task_evidence_is_rejected_and_draft_original_is_retained(tmp_path):
    provider = SyntheticProvider()
    async def bad_task(operation, payload):
        return {"tasks":[{"title":"wrong source", "source_index":99,"due_date":None}]}
    with TestClient(create_app(settings(tmp_path), ai_provider=provider), base_url=ORIGIN) as client:
        login(client)
        prepared = preview(client,"translate",message_ids=[],draft="確認して返信します",target_language="zh").json()
        start(client,prepared)
        assert finished(client,prepared["id"])["source_draft"] == "確認して返信します"
        provider.generate = bad_task
        prepared = preview(client,"tasks").json()
        start(client,prepared)
        assert finished(client,prepared["id"])["error_code"] == "ai_invalid_response"
        assert client.get("/api/tasks").json() == []
