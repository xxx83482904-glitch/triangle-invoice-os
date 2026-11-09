"""Verify the configured HTTPS endpoint. Real WeChat is never sent to."""
import argparse
from pathlib import Path
import sys
import time
import ipaddress
import socket
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mock-send", action="store_true", help="Also inject and send one message, only after verifying Mock mode")
    parser.add_argument("--public", action="store_true", help="Use a public DNS answer to bypass the local Tailnet route")
    args = parser.parse_args()
    settings = Settings.from_env()
    url = settings.mobile_url
    if not url:
        raise RuntimeError("mobile_url_not_configured")
    if args.public:
        if settings.mobile_access != "public":
            raise RuntimeError("public_access_not_configured")
        hostname = urlsplit(url).hostname
        # The public resolver receives only this public hostname, never keys/data.
        with httpx.Client(timeout=15, trust_env=False) as resolver:
            dns = resolver.get("https://dns.google/resolve", params={"name": hostname, "type": "A"})
            dns.raise_for_status()
        addresses = [a["data"] for a in dns.json().get("Answer", []) if a.get("type") == 1 and ipaddress.ip_address(a["data"]).is_global]
        if not addresses:
            raise RuntimeError("public_dns_not_ready")
        original_getaddrinfo = socket.getaddrinfo
        selected_address = addresses[0]

        def resolve_public(host, port, *options, **kwargs):
            return original_getaddrinfo(selected_address if host in (hostname, hostname.encode()) else host, port, *options, **kwargs)

        # Isolated verification process only. URL Host and TLS SNI stay unchanged.
        socket.getaddrinfo = resolve_public
        ready = []
        for address in addresses:
            selected_address = address
            try:
                with httpx.Client(timeout=10, trust_env=False) as probe:
                    ok = probe.get(url + "/api/health").json().get("service") == "komorebi"
                if ok:
                    ready.append(address)
                print("Public relay", address, "ready" if ok else "unavailable")
            except (httpx.HTTPError, ValueError):
                print("Public relay", address, "unavailable")
        if not ready:
            raise RuntimeError("public_relays_not_ready")
        selected_address = ready[0]
        print("Using public Funnel relay:", selected_address)
    # TLS certificate verification stays enabled; no proxy or insecure override.
    with httpx.Client(base_url=url, headers={"Origin": url}, timeout=15, trust_env=False) as client:
        assert client.get("/api/health").json()["service"] == "komorebi"
        assert client.get("/api/chats").status_code == 401
        assert client.get("/api/queue").status_code == 401
        assert client.post("/api/chats/preflight-invalid/send", json={}).status_code == 401
        for path in ("/.env", "/.runtime/access-token.txt", "/data/mock.sqlite3"):
            assert client.get(path).status_code == 404
        login = client.post("/api/auth/login", json={"token": settings.token})
        login.raise_for_status()
        cookie = login.headers["set-cookie"]
        assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
        print("PASS HTTPS certificate, unauthenticated access rejected, secure login")
        try:
            status = client.get("/api/status").json()
            assert client.get("/api/device").json()["mobile_url"] == url
            chats = client.get("/api/chats").json()
            with connect(url.replace("https://", "wss://", 1) + "/ws", origin=url,
                         additional_headers={"Cookie": "wechat_session=" + client.cookies["wechat_session"]},
                         open_timeout=10, proxy=None) as websocket:
                import json
                assert json.loads(websocket.recv(timeout=10))["type"] == "ready"
                print("PASS authenticated WebSocket over TLS")
                if args.mock_send:
                    assert status["mode"] == "mock" and status["can_send"], "mock_mode_required"
                    chat = next(c for c in chats if c["type"] == "group")
                    client.post("/api/mock", json={"action": "receive", "chat_id": chat["id"]}).raise_for_status()
                    for _ in range(15):
                        if json.loads(websocket.recv(timeout=10))["type"] == "message":
                            break
                    else:
                        raise RuntimeError("message_event_missing")
                    request_id = str(uuid4())
                    sent = client.post(f"/api/chats/{chat['id']}/send", json={
                        "content": "携帯接続の動作確認（Mock）", "expected_external_id": chat["external_id"],
                        "expected_name": chat["name"], "client_request_id": request_id})
                    assert sent.status_code == 202
                    for _ in range(40):
                        if client.get(f"/api/requests/{request_id}").json()["status"] == "confirmed":
                            break
                        time.sleep(0.2)
                    else:
                        raise RuntimeError("mock_receipt_not_confirmed")
                    print("PASS Mock group receive event and queued send confirmation over HTTPS")
        finally:
            client.post("/api/auth/logout", json={})
        assert client.get("/api/chats").status_code == 401
        print("PASS logout revokes session")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # HTTP exception dumps could contain response/body details; emit type only.
        print(f"FAIL HTTPS connection verification ({type(exc).__name__})")
        sys.exit(1)
