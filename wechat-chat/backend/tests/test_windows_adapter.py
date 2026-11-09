import asyncio
import pytest

from app.adapters.base import AdapterError
from app.adapters.windows_uia import WindowsUIAAdapter


@pytest.mark.parametrize("diagnostic,expected", [
    ("login_required", "login_required"), ("unsupported_ui", "limited"),
    ("not_running", "disconnected"), ("window_unavailable", "disconnected"),
    ("probe_timeout", "error"), ("dependency_missing", "error"), ("unsupported_os", "error"),
    ("ui_tree_unavailable", "limited"), ("window_minimized", "limited"),
])
def test_diagnostic_states_fail_closed(monkeypatch, diagnostic, expected):
    monkeypatch.setattr(WindowsUIAAdapter, "_probe", staticmethod(lambda: {"state": diagnostic, "version": "4.1.15.56"}))
    async def run():
        adapter = WindowsUIAAdapter()
        status = await adapter.connect()
        assert status.state == expected
        assert not status.can_send and not status.can_read
        assert (await adapter.send_message("any", "must not send")).status == "failed"
        with pytest.raises(AdapterError):
            await adapter.get_messages("any")
        await adapter.disconnect()
        assert (await adapter.get_connection_status()).state == "disconnected"
    asyncio.run(run())


@pytest.mark.parametrize("observation,expected", [
    ({"process_count": 0}, "not_running"),
    ({"process_count": 1, "window_count": 0}, "window_unavailable"),
    ({"process_count": 1, "window_count": 1, "all_windows_minimized": True}, "window_minimized"),
    ({"process_count": 1, "window_count": 1, "login_layout_detected": True, "interactive_node_count": 3}, "login_required"),
    ({"process_count": 5, "window_count": 1, "node_count": 3, "interactive_node_count": 0}, "ui_tree_unavailable"),
    ({"process_count": 5, "window_count": 1, "node_count": 300, "interactive_node_count": 100}, "unsupported_ui"),
])
def test_structural_diagnostics_do_not_infer_login_or_read_capability(observation, expected):
    from app.adapters.windows_probe import classify_observation
    code = classify_observation(observation)
    assert code == expected
    connection = WindowsUIAAdapter.describe({**observation, "state": code})
    assert not connection.can_read and not connection.can_send


def test_authenticated_diagnostic_api_keeps_mock_and_messages_unchanged(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.main import create_app
    origin = "http://127.0.0.1:8765"
    token = "windows-diagnostics-test-" + "a" * 40
    result = {"state": "ui_tree_unavailable", "node_count": 3, "interactive_node_count": 0, "version": "4.1.15.56"}
    monkeypatch.setattr(WindowsUIAAdapter, "_probe", staticmethod(lambda: result.copy()))
    with TestClient(create_app(Settings(db_path=tmp_path / "mock.sqlite3", token=token)), base_url=origin) as client:
        assert client.post("/api/wechat/diagnostics", json={}).status_code == 401
        assert client.post("/api/auth/login", json={"token": token}, headers={"Origin": origin}).status_code == 200
        assert client.post("/api/wechat/diagnostics", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
        before = client.get("/api/chats").json()
        response = client.post("/api/wechat/diagnostics", json={}, headers={"Origin": origin})
        assert response.status_code == 200
        data = response.json()
        assert data["active_adapter"] == "mock" and data["diagnostic"] == result
        assert data["connection"]["state"] == "limited"
        assert data["connection"]["can_read"] is False and data["connection"]["can_send"] is False
        assert client.get("/api/chats").json() == before
        assert client.get("/api/queue").json() == []
        assert client.app.state.engine.adapter.sent_count == 0
        for _ in range(5):
            assert client.post("/api/wechat/diagnostics", json={}, headers={"Origin": origin}).status_code == 200
        assert client.post("/api/wechat/diagnostics", json={}, headers={"Origin": origin}).status_code == 429
