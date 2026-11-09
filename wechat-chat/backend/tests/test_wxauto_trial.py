import importlib.util
import json
from pathlib import Path
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.wxauto_trial import read_report


def sample_report():
    return {"checked_at": "2026-11-09T08:00:00+00:00", "package_version": "41.1.7",
            "wechat_version": "4.1.8.107", "node_count": 2, "interactive_node_count": 0,
            "attempts": [{"variant": variant, "error_code": "main_window_not_found"}
                         for variant in ("en", "cn", "international")]}


def test_report_is_authenticated_redacted_and_does_not_enable_adapter(tmp_path):
    path = tmp_path / "report.json"
    report = sample_report()
    report["account_name"] = "PRIVATE_ACCOUNT"
    report["can_send"] = True
    report["attempts"][0]["raw_exception"] = "PRIVATE_MESSAGE"
    path.write_text(json.dumps(report), encoding="utf-8")
    token = "free-trial-test-" + "x" * 40
    settings = Settings(db_path=tmp_path / "test.sqlite3", token=token, wxauto_trial_report=path)
    origin = "http://127.0.0.1:8765"
    with TestClient(create_app(settings), base_url=origin) as client:
        assert client.get("/api/wechat/free-trial").status_code == 401
        client.post("/api/auth/login", json={"token": token}, headers={"Origin": origin})
        before = client.get("/api/chats").json()
        response = client.get("/api/wechat/free-trial")
        assert response.status_code == 200
        assert response.json()["state"] == "available"
        assert "PRIVATE" not in response.text and "can_send" not in response.text
        assert client.get("/api/chats").json() == before
        assert client.get("/api/status").json()["mode"] == "mock"
        assert client.get("/api/queue").json() == []
        assert client.app.state.engine.adapter.sent_count == 0


@pytest.mark.parametrize("change", ["missing", "oversized", "invalid_json", "missing_variant", "incomplete_success", "bad_date"])
def test_incomplete_or_invalid_reports_never_appear_successful(tmp_path, change):
    path = tmp_path / "report.json"
    report = sample_report()
    if change == "missing_variant":
        report["attempts"].pop()
    if change == "incomplete_success":
        report["attempts"][0]["error_code"] = None
    if change == "bad_date":
        report["checked_at"] = "2026-11-09T00:00:00"
    if change != "missing":
        path.write_text("x" * 16385 if change == "oversized" else "{" if change == "invalid_json" else json.dumps(report))
    assert read_report(path) == {"state": "unavailable", "report": None}


def load_script():
    path = Path(__file__).resolve().parents[2] / "scripts/check-wxauto4.py"
    spec = importlib.util.spec_from_file_location("wxauto_trial_script", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    return script


def test_trial_runner_bounds_library_failures_and_redacts_outputs(tmp_path, monkeypatch, capsys):
    script = load_script()
    monkeypatch.setattr(script, "ROOT", tmp_path)
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        assert kwargs["timeout"] == 15
        variant = command[-1]
        if variant == "en":
            return subprocess.CompletedProcess(command, 0, json.dumps({"variant": variant, "initialized": True,
                "read_attempted": True, "session_count": 1, "visible_message_count": 2, "raw_message": "PRIVATE"}), "")
        if variant == "cn":
            raise subprocess.TimeoutExpired(command, 15, output="PRIVATE")
        return subprocess.CompletedProcess(command, 1, "PRIVATE", "PRIVATE")

    monkeypatch.setattr(script.subprocess, "run", run)
    assert script.run_trial(Path("fake-python")) == 0
    assert len(calls) == 3
    output = capsys.readouterr().out
    assert "PRIVATE" not in output
    report = read_report(tmp_path / ".runtime/wxauto4-trial.json")["report"]
    assert "PRIVATE" not in json.dumps(report)
    assert [a["error_code"] for a in report["attempts"]] == [None, "probe_timeout", "probe_failed"]


def test_trial_configuration_is_checked_before_importing_package(tmp_path, monkeypatch):
    script = load_script()
    param = tmp_path / "wxauto4/param.py"
    param.parent.mkdir()
    param.write_text("class WxParam:\n    TELEMETRY_ENABLED: bool = True\n    ENABLE_FILE_LOGGER: bool = True\n")
    class Dist:
        version = "41.1.7"
        def locate_file(self, path):
            return tmp_path / path
    monkeypatch.setattr(script.importlib.metadata, "distribution", lambda name: Dist())
    _, _, flags = script.privacy_source()
    assert all(n.value for n in flags.values())
    monkeypatch.setattr(script, "ROOT", tmp_path)
    with pytest.raises(ValueError, match="isolated_environment_required"):
        script.prepare()
    assert "= True" in param.read_text()


def test_error_classification_never_returns_raw_exception():
    script = load_script()
    assert script.classify_error(Exception("PRIVATE message and account")) == "probe_failed"
    assert script.classify_error(Exception("PRIVATE message"), initialized=True) == "read_failed"
    assert script.classify_error(Exception("未找到已登录的客户端主窗口 PRIVATE")) == "main_window_not_found"
