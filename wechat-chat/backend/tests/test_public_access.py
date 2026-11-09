import asyncio
import importlib.util
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.body_limit import BodyLimitMiddleware
from app.config import Settings
from app.main import create_app

URL = "https://device.tailnet.ts.net"
TOKEN = "public-test-only-" + "p" * 40


@pytest.fixture
def client(tmp_path):
    settings = Settings(db_path=tmp_path / "mock.db", token=TOKEN, mobile_url=URL,
                        mobile_access="public", hosts=("device.tailnet.ts.net",), origins=(URL,))
    with TestClient(create_app(settings), base_url=URL) as client:
        yield client


def test_public_routes_require_authentication_and_ws_origin(client):
    for path in ("/api/chats", "/api/status", "/api/queue", "/api/device", "/api/search?q=a"):
        assert client.get(path).status_code == 401
    for path in ("/api/chats/no-such-chat/send", "/api/mock", "/api/sync", "/api/auth/logout"):
        assert client.post(path, json={}).status_code == 401
    for path in ("/.env", "/.runtime/access-token.txt", "/data/mock.sqlite3", "/docs", "/openapi.json"):
        assert client.get(path).status_code == 404
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("wss://device.tailnet.ts.net/ws", headers={"Origin": URL}):
            pass
    for _ in range(10):
        assert client.post("/api/auth/login", headers={"Origin": URL}, json={"token": "incorrect"}).status_code == 401
    assert client.post("/api/auth/login", headers={"Origin": URL}, json={"token": "incorrect"}).status_code == 429
    # A remote attacker must not lock out the owner through the shared proxy IP.
    assert client.post("/api/auth/login", headers={"Origin": URL}, json={"token": TOKEN}).status_code == 200


def test_public_mode_authenticated_session_and_csrf(client):
    result = client.post("/api/auth/login", headers={"Origin": URL}, json={"token": TOKEN})
    assert result.status_code == 200
    assert "Secure" in result.headers["set-cookie"]
    assert client.get("/api/device").json()["mobile_access"] == "public"
    assert client.post("/api/sync", headers={"Origin": "https://evil.example"}, json={}).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("wss://device.tailnet.ts.net/ws", headers={"Origin": "https://evil.example"}):
            pass
    client.post("/api/auth/logout", headers={"Origin": URL}, json={})
    assert client.get("/api/chats").status_code == 401


def test_chunked_upload_cannot_bypass_body_limit(client):
    response = client.post("/api/auth/login", headers={"Origin": URL, "Content-Type": "application/json"}, content=iter([b"x" * 16384] * 3))
    assert response.status_code == 413
    assert response.json() == {"detail": "request_too_large"}
    assert client.post("/api/auth/login", headers={"Content-Length": "-1", "Content-Type": "application/json"}, content=b"").status_code == 400


def test_slow_request_body_times_out_before_the_application():
    reached_app, messages = [], []
    async def app(scope, receive, send):
        reached_app.append(True)
    async def receive():
        await asyncio.sleep(1)
        return {"type": "http.request", "body": b""}
    async def send(message):
        messages.append(message)
    asyncio.run(BodyLimitMiddleware(app, timeout=0.01)({"type": "http", "method": "POST"}, receive, send))
    assert not reached_app
    assert messages[0]["status"] == 408


def test_public_configuration_and_foreign_route_guard(tmp_path, monkeypatch):
    path = tmp_path / "mobile.json"
    path.write_text(json.dumps({"enabled": True, "url": URL, "access_mode": "public"}), encoding="utf-8")
    monkeypatch.setenv("WECHAT_MOBILE_CONFIG", str(path))
    monkeypatch.setenv("WECHAT_ACCESS_TOKEN", TOKEN)
    assert Settings.from_env().mobile_access == "public"
    script = Path(__file__).resolve().parents[2] / "scripts/mobile-access.py"
    spec = importlib.util.spec_from_file_location("mobile_access", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    endpoint = "device.tailnet.ts.net:443"
    foreign = {"TCP": {"443": {"HTTPS": True}}, "Web": {endpoint: {"Handlers": {"/": {"Proxy": "http://127.0.0.1:9999"}}}}}
    with pytest.raises(RuntimeError, match="another app"):
        module.check_route(foreign, endpoint, 443)
    own = {"TCP": {"443": {"HTTPS": True}}, "Web": {endpoint: {"Handlers": {"/": {"Proxy": module.TARGET}}}}}
    assert module.check_route(own, endpoint, 443)
    own["AllowFunnel"] = {"other.example.ts.net:443": True}
    with pytest.raises(RuntimeError, match="Another Funnel"):
        module.check_route(own, endpoint, 443)
