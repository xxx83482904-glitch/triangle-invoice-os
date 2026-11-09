import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "mobile-test-" + "t" * 40
REMOTE = "https://test-device.example-tailnet.ts.net"


def test_mobile_secure_session_and_origin_isolation(tmp_path):
    settings = Settings(db_path=tmp_path / "mock.db", token=TOKEN, mobile_url=REMOTE)
    settings = replace(settings, hosts=(*settings.hosts, "test-device.example-tailnet.ts.net"), origins=(*settings.origins, REMOTE))
    with TestClient(create_app(settings), base_url=REMOTE) as client:
        assert client.get("/api/device").status_code == 401
        response = client.post("/api/auth/login", headers={"Origin": REMOTE}, json={"token": TOKEN})
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
        assert client.get("/api/chats").status_code == 200
        assert client.get("/api/device").json() == {"mobile_url": REMOTE, "mobile_access": "private", "ai_enabled": False, "push_enabled": False}
        assert client.post("/api/mock", headers={"Origin": "https://evil.example"}, json={"action": "disconnect"}).status_code == 403
        assert client.get("/api/chats", headers={"Host": "untrusted.example"}).status_code == 400
        with client.websocket_connect("wss://test-device.example-tailnet.ts.net/ws", headers={"Origin": REMOTE}) as websocket:
            assert websocket.receive_json()["type"] == "ready"
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as local:
        response = local.post("/api/auth/login", headers={"Origin": "http://127.0.0.1:8765", "X-Forwarded-Proto": "https"}, json={"token": TOKEN})
        assert response.status_code == 200
        assert "Secure" not in response.headers["set-cookie"]
        assert local.get("/api/device").status_code == 200


@pytest.mark.parametrize("url", [REMOTE, REMOTE + ":8443", "https://evil.example", REMOTE + "/secret", "http://test-device.example-tailnet.ts.net"])
def test_mobile_config_only_expands_exact_private_https_origin(tmp_path, monkeypatch, url):
    path = tmp_path / "mobile.json"
    path.write_text(json.dumps({"enabled": True, "url": url}), encoding="utf-8")
    monkeypatch.setenv("WECHAT_MOBILE_CONFIG", str(path))
    monkeypatch.setenv("WECHAT_ACCESS_TOKEN", TOKEN)
    if url in (REMOTE, REMOTE + ":8443"):
        settings = Settings.from_env()
        assert settings.mobile_url == url
        assert url in settings.origins
        assert "test-device.example-tailnet.ts.net" in settings.hosts
        assert "*" not in settings.hosts
    else:
        with pytest.raises(ValueError, match="Invalid private mobile URL"):
            Settings.from_env()
