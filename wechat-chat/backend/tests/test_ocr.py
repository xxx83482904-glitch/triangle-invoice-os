import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.ocr_inbox import OcrInbox

ORIGIN = "http://127.0.0.1:8765"
TOKEN = "test-ocr-private-" + "a" * 40
HEADER = {"Authorization": "Bearer " + TOKEN}
SCREEN = {"lines": [{"text": "確認をお願いします", "box": [400, 500, 600, 530]}, {"text": "確認をお願いします", "box": [400, 600, 600, 630]}], "image": "data:image/jpeg;base64,test-only", "width": 1100, "height": 900, "language": "ja", "languages": ["ja"]}


@pytest.fixture
def settings(tmp_path):
    return Settings(db_path=tmp_path / "ocr.sqlite3", token=TOKEN, adapter="windows-ocr")


@pytest.fixture
def capture_stub(monkeypatch):
    async def capture(language):
        return deepcopy(SCREEN)
    monkeypatch.setattr("app.ocr_inbox.capture_local", capture)


def payload(preview, **overrides):
    return {"preview_id": preview["id"], "line_ids": [0], "chat_name": "テスト会話", "chat_type": "group", "content": "確認をお願いします", "sender_name": "送信者不明", "direction": "incoming", "reviewed": True, "client_request_id": str(uuid4()), **overrides}


def post(client, path, body):
    return client.post("/api/wechat/ocr/" + path, json=body, headers=HEADER)


def test_reviewed_import_persists_without_sending_and_notifies(settings, capture_stub):
    app = create_app(settings)
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.post("/api/auth/login", json={"token": TOKEN}, headers={"Origin": ORIGIN}).status_code == 200
        status = client.get("/api/status").json()
        assert status["mode"] == "windows-ocr" and not status["can_send"] and not status["can_read"]
        preview = post(client, "preview", {}).json()
        assert len(preview["lines"]) == 2
        assert app.state.ocr.previews[preview["id"]]["image"] is None
        body = payload(preview)
        with client.websocket_connect("ws://127.0.0.1:8765/ws", headers={"Origin": ORIGIN}) as ws:
            assert ws.receive_json()["type"] == "ready"
            result = post(client, "import", body)
            assert result.status_code == 200
            assert ws.receive_json()["type"] == "message"
        ident = result.json()["chat_id"]
        message = client.get(f"/api/chats/{ident}/messages").json()["messages"][0]
        assert message["content"] == body["content"]
        assert message["timestamp"] is None and message["timestamp_quality"] == "unavailable"
        assert message["identity_quality"] == "ocr_reviewed" and message["external_message_id"] is None
        assert client.get("/api/chats").json()[0]["sync_status"] == "partial"
        assert client.get("/api/queue").json() == []
        response = client.post(f"/api/chats/{ident}/send", headers=HEADER, json={"content": "送信しない", "expected_external_id": "ocr:" + body["client_request_id"], "expected_name": body["chat_name"], "client_request_id": str(uuid4())})
        assert response.status_code == 409 and response.json()["detail"] == "sending_unavailable"
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        assert post(client, "import", body).json()["duplicate"]
        rows = client.get(f"/api/chats/{ident}/messages", headers=HEADER).json()["messages"]
        assert len(rows) == 1  # Idempotency survives preview expiry and restart.
        assert post(client, "import", {**body, "content": "変更"}).json()["detail"] == "idempotency_conflict"


def test_recapture_dedupes_but_two_visible_identical_occurrences_are_distinct(settings, capture_stub):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        first = post(client, "preview", {}).json()
        body = payload(first)
        receipt = post(client, "import", body).json()
        target = {"chat_id": receipt["chat_id"], "expected_external_id": "ocr:" + body["client_request_id"]}
        second = post(client, "preview", {}).json()
        assert post(client, "import", payload(second, **target)).json()["duplicate"]
        assert not post(client, "import", payload(second, line_ids=[1], **target)).json()["duplicate"]
        rows = client.get(f"/api/chats/{receipt['chat_id']}/messages", headers=HEADER).json()["messages"]
        assert len(rows) == 2
        assert post(client, "import", payload(second, content="修正済み", **target)).json()["detail"] == "ocr_source_already_imported"


@pytest.mark.parametrize("change,code", [
    ({"reviewed": False}, 422), ({"line_ids": [999]}, 409),
    ({"line_ids": [0, 0]}, 409), ({"line_ids": []}, 422),
    ({"content": "  "}, 422), ({"direction": "unknown"}, 422),
    ({"chat_id": str(uuid4()), "expected_external_id": "ocr:wrong"}, 409),
])
def test_invalid_imports_never_write(settings, capture_stub, change, code):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        body = payload(post(client, "preview", {}).json(), **change)
        assert post(client, "import", body).status_code == code
        assert client.get("/api/chats", headers=HEADER).json() == []


def test_exact_destination_validation(settings, capture_stub):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        preview = post(client, "preview", {}).json()
        body = payload(preview)
        result = post(client, "import", body).json()
        mismatch = payload(preview, chat_id=result["chat_id"], expected_external_id="ocr:" + body["client_request_id"], chat_name="別の宛先", line_ids=[1])
        assert post(client, "import", mismatch).json()["detail"] == "destination_mismatch"
        assert len(client.get(f"/api/chats/{result['chat_id']}/messages", headers=HEADER).json()["messages"]) == 1


def test_auth_origin_and_mock_isolation(settings, capture_stub):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        assert client.post("/api/wechat/ocr/preview", json={}).status_code == 401
        assert client.post("/api/wechat/ocr/import", json={}).status_code == 401
        client.post("/api/auth/login", json={"token": TOKEN}, headers={"Origin": ORIGIN})
        assert client.post("/api/wechat/ocr/preview", json={}, headers={"Origin": "https://elsewhere.example"}).status_code == 403
    settings.adapter = "mock"
    settings.db_path = settings.db_path.parent / "mock.sqlite3"
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        assert post(client, "preview", {}).json()["detail"] == "ocr_mode_required"
        assert post(client, "import", payload({"id": str(uuid4())})).json()["detail"] == "ocr_mode_required"


def test_expiration_and_memory_bound(settings, capture_stub):
    app = create_app(settings)
    with TestClient(app, base_url=ORIGIN) as client:
        first = post(client, "preview", {}).json()
        second = post(client, "preview", {}).json()
        post(client, "preview", {})
        assert len(app.state.ocr.previews) == 2 and first["id"] not in app.state.ocr.previews
        app.state.ocr.previews[second["id"]]["deadline"] = 0
        assert post(client, "import", payload(second)).json()["detail"] == "ocr_preview_expired"
        assert second["id"] not in app.state.ocr.previews
    assert app.state.ocr.previews == {}


def test_ocr_outgoing_is_observation_not_send_success(settings, capture_stub):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        result = post(client, "import", payload(post(client, "preview", {}).json(), direction="outgoing", sender_name="自分（手動指定）")).json()
        message = client.get(f"/api/chats/{result['chat_id']}/messages", headers=HEADER).json()["messages"][0]
        assert message["delivery_status"] == "unknown"
        assert client.get("/api/attention", headers=HEADER).json()["items"][0]["state"] != "review_send"
        assert client.get("/api/status", headers=HEADER).json()["unknown_count"] == 0


def test_unavailable_timestamps_do_not_invent_message_age(settings, capture_stub):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        result = post(client, "import", payload(post(client, "preview", {}).json())).json()
        app = client.app
        with app.state.db.conn:
            app.state.db.conn.execute("UPDATE messages SET observed_at='2000-01-01T00:00:00+00:00' WHERE id=?", (result["message_id"],))
        item = client.get("/api/attention", headers=HEADER).json()["items"][0]
        assert item["source_at"] is None
        assert not any("24時間" in reason for reason in item["reasons"])


def test_preview_concurrency_guard(capture_stub):
    async def run():
        inbox = OcrInbox()
        async with inbox.lock:
            with pytest.raises(Exception, match="ocr_busy"):
                await inbox.preview("ja", 0)
    asyncio.run(run())


@pytest.mark.parametrize("change", [{"minimized": True}, {"cloaked": True}, {"visible": False}, {"class": "Unknown"}, {"width": 400}, {"height": 400}])
def test_window_selection_never_uses_login_hidden_or_unsupported_windows(change):
    from app.adapters.windows_ocr_capture import choose_window
    from app.adapters.base import AdapterError
    candidate = {"identity": (1, 2, (0, 0, 1000, 800)), "class": "Qt51514QWindowIcon", "visible": True, "minimized": False, "cloaked": False, "width": 1000, "height": 800}
    assert choose_window([candidate]) == candidate["identity"]
    with pytest.raises(AdapterError, match="ocr_window_unsupported"):
        choose_window([{**candidate, **change}])
    with pytest.raises(AdapterError, match="ocr_window_ambiguous"):
        choose_window([candidate, {**candidate, "identity": (3, 4, (0, 0, 1000, 800))}])
