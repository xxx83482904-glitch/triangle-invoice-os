"""Exercise real process ownership, recovery and SQLite persistence on Windows."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows supervisor/job integration")


def eventually(probe, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = probe()
            if result:
                return result
        except (OSError, ValueError, httpx.HTTPError):
            pass
        time.sleep(0.2)
    raise AssertionError("Resident did not reach the expected lifecycle state")


def test_resident_restart_single_instance_and_no_orphan_children(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    runtime = tmp_path / "resident"
    token = "resident-test-" + "r" * 40
    origin = f"http://127.0.0.1:{port}"
    env = dict(os.environ, WECHAT_ADAPTER="mock", WECHAT_ACCESS_TOKEN=token,
               WECHAT_DB_PATH=str(tmp_path / "history.sqlite3"), WECHAT_MOBILE_CONFIG=str(tmp_path / "absent.json"),
               WECHAT_ALLOWED_ORIGINS=origin, WECHAT_ALLOWED_HOSTS="127.0.0.1", WECHAT_MOCK_INTERVAL="0")
    def control(action):
        return subprocess.run([sys.executable, str(ROOT / "scripts/resident.py"), action,
                               "--runtime-dir", str(runtime), "--port", str(port)],
                              env=env, capture_output=True, text=True, timeout=35)
    def state():
        return json.loads((runtime / "state.json").read_text(encoding="utf-8"))
    def kill(ident, tree=False):
        args = ["taskkill.exe", "/PID", str(ident), "/F"] + (["/T"] if tree else [])
        subprocess.run(args, check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    def free():
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return True
            except OSError:
                return False
    try:
        assert control("start").returncode == 0
        initial = state()
        assert control("start").returncode == 0
        assert state()["generation"] == initial["generation"]
        with httpx.Client(base_url=origin, headers={"Authorization": f"Bearer {token}", "Origin": origin}, timeout=2) as client:
            assert client.get("/api/status").json()["mode"] == "mock"
            chat = client.get("/api/chats").json()[0]
            body = {"content": "Mock resident persistence check", "expected_external_id": chat["external_id"], "expected_name": chat["name"], "client_request_id": str(uuid4())}
            assert client.post(f"/api/chats/{chat['id']}/send", json=body).status_code == 202
            eventually(lambda: client.get(f"/api/requests/{body['client_request_id']}").json()["status"] == "confirmed")
            kill(initial["child_pid"], tree=True)
            eventually(lambda: state()["healthy"] and state()["restarts"] >= 1)
            assert state()["child_pid"] != initial["child_pid"]
            assert client.get(f"/api/requests/{body['client_request_id']}").json()["status"] == "confirmed"
            # A supervisor crash must also close its job and kill child workers.
            kill(state()["pid"])
            eventually(free)
            assert control("start").returncode == 0
            assert state()["generation"] != initial["generation"]
            assert client.get(f"/api/requests/{body['client_request_id']}").json()["status"] == "confirmed"
        assert control("stop").returncode == 0
        eventually(free)
        logs = (runtime / "lifecycle.log").read_text(encoding="utf-8")
        assert token not in logs and body["content"] not in logs
    finally:
        control("stop")
