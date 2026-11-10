"""Isolated Mock-only server. Never reads .env, user token or real message databases."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from app.config import Settings
from app.main import create_app
import app.main as main_module
from app.security import Security
from app.adapters.mock import MockWeChatAdapter
from app.adapters.base import Message
from dataclasses import replace
import base64
from test_ai import SyntheticProvider


class BrowserTestSecurity(Security):
    def rate_limit(self, key, limit=10, interval=60):
        # Many isolated browser contexts sign in within a minute. Production
        # limits and all failed-login / send / AI limits remain unchanged.
        return super().rate_limit(key, 100 if key == "login-success" else limit, interval)


class BrowserMediaMock(MockWeChatAdapter):
    async def fetch_attachment(self, chat_id, source_key):
        message = next(m for m in self.history[chat_id] if m.source_key == source_key)
        if message.message_type != "voice":
            raise ValueError("source_unavailable")
        return replace(message, attachment={**message.attachment, "status":"ready",
            "transcript":"明日の集合は10時です。", "error_code":"voice_audio_unavailable"})


def add_media_fixture(app, adapter, folder):
    """Test server only; synthetic media uses the real authenticated API."""
    from fastapi import Depends
    from app.media_store import validate_attachment

    # The same instance used by create_app, available after lifespan startup.
    def authenticated(request: main_module.Request):
        return app.state.security.check(request)

    @app.post("/api/test/media", dependencies=[Depends(authenticated)])
    async def media_fixture():
        vault, db = app.state.media, app.state.db
        target = next(c for c in db.chats() if c["external_id"] == "mock:studio")
        for index, kind in enumerate(("voice", "image", "file")):
            attachment = dict(id=("abc"[index] * 32), kind=kind, status="pending")
            if kind != "voice":
                source = folder / ("合成画像.png" if kind == "image" else "資料.txt")
                source.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=") if kind == "image" else b"test")
                attachment.update(vault.import_file(source, folder), status="ready")
            message = Message("mock:studio", "[合成メディア]", "synthetic", "合成メディア", "incoming", None,
                message_type=kind, source_key="test:media:"+kind, timestamp_quality="unavailable",
                identity_quality="uia_runtime", delivery_status="received", attachment=validate_attachment(attachment))
            adapter.history["mock:studio"].append(message)
            db.ingest(message)
        db.ingest(Message("mock:studio", "確認済みの合成送信", "self", "自分", "outgoing", None,
            source_key="test:media:confirmed", timestamp_quality="unavailable", identity_quality="uia_runtime",
            delivery_status="confirmed"))
        return {"chat_id":target["id"]}

    # Keep this test-only endpoint ahead of the static export's catch-all mount.
    app.router.routes.insert(0, app.router.routes.pop())

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="komorebi-e2e-") as folder:
        settings = Settings(db_path=Path(folder) / "test.sqlite3", token="e2e-mock-only-" + "x" * 40, origins=("http://127.0.0.1:8877",), hosts=("127.0.0.1",), ai_enabled=True, wxauto_trial_report=Path(folder)/"no-real-trial.json")
        main_module.Security = BrowserTestSecurity
        adapter = BrowserMediaMock()
        app = create_app(settings, adapter=adapter, ai_provider=SyntheticProvider())
        add_media_fixture(app, adapter, Path(folder))
        uvicorn.run(app, host="127.0.0.1", port=8877, access_log=False, log_level="warning")
