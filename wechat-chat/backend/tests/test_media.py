"""Private attachments: durable metadata, authenticated bytes and no sending."""
from dataclasses import replace
import hashlib
from pathlib import Path
from types import SimpleNamespace
import time

from fastapi.testclient import TestClient
import pytest

from app.adapters.base import Chat, Message
from app.adapters.mock import MockWeChatAdapter
from app.adapters.plus_core import PlusStore, digest
from app.adapters.plus_sdk import PlusSDK
from app.config import Settings
from app.database import Database
from app.main import create_app
from app.media_store import MediaVault, merge_attachment, validate_attachment

TOKEN = "test-media-" + "x" * 40
ORIGIN = "http://127.0.0.1:8765"
PNG = bytes.fromhex("89504e470d0a1a0a") + b"synthetic-image-not-private"


def media(kind="image", status="pending", **values):
    return validate_attachment(dict(id="a" * 32, kind=kind, status=status, **values))


def observation(attachment=None):
    return Message("mock:lin", "[画像]", "sender", "合成送信者", "incoming", None,
                   message_type=(attachment or {}).get("kind", "image"), source_key="plus:synthetic-media",
                   timestamp_quality="unavailable", identity_quality="uia_runtime",
                   delivery_status="received", attachment=attachment or media())


def test_atomic_blob_reuse_and_path_boundary(tmp_path):
    stage = tmp_path / "stage"
    stage.mkdir()
    source = stage / "テスト.png"
    source.write_bytes(PNG)
    vault = MediaVault(tmp_path / "vault")
    first = vault.import_file(source, stage)
    assert first == vault.import_file(source, stage)
    assert first["storage_key"] == hashlib.sha256(PNG).hexdigest()
    assert first["mime_type"] == "image/png"
    assert list(vault.root.iterdir()) == [vault.locate(first["storage_key"])]
    other = tmp_path / "outside.txt"
    other.write_text("private", encoding="utf-8")
    with pytest.raises(ValueError, match="outside_staging"):
        vault.import_file(other, stage)
    with pytest.raises(ValueError):
        vault.locate("../outside.txt")


def test_existing_corrupt_blob_is_not_overwritten(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(PNG)
    vault = MediaVault(tmp_path / "vault")
    dest = vault.root / hashlib.sha256(PNG).hexdigest()
    dest.write_bytes(b"x" * len(PNG))
    with pytest.raises(ValueError, match="attachment_conflict"):
        vault.import_file(source, tmp_path)
    assert dest.read_bytes() == b"x" * len(PNG)
    assert not list(vault.root.glob(".incoming-*"))


def test_size_limit_checked_while_copying(tmp_path, monkeypatch):
    import app.media_store as module
    monkeypatch.setattr(module, "MAX_FILE_BYTES", 5)
    source = tmp_path / "file"
    source.write_bytes(b"123456")
    vault = MediaVault(tmp_path / "vault")
    with pytest.raises(ValueError, match="too_large"):
        vault.import_file(source, tmp_path)
    assert not list(vault.root.iterdir())


@pytest.mark.parametrize("bad", [
    {"id": 1}, {"storage_key": "../secret"}, {"size_bytes": -1},
    {"status": "ready"}, {"filename": ["unexpected"]}, {"local_path": "private"},
])
def test_invalid_metadata_rejected(bad):
    with pytest.raises(ValueError):
        validate_attachment(dict(id="a" * 32, kind="image", status="pending", **{k:v for k,v in bad.items() if k not in ("id","kind","status")})
                            | {k:v for k,v in bad.items() if k in ("id","kind","status")})


def test_same_message_media_update_survives_restart_without_unread_increment(tmp_path):
    path = tmp_path / "mock.sqlite3"
    db = Database(path, "mock")
    ident = db.upsert_chat(Chat("mock:lin", "合成会話", "individual"))
    pending = observation()
    assert db.ingest(pending)
    before = db.messages(ident)[0]
    ready = media(status="ready", storage_key="b" * 64, size_bytes=32, mime_type="image/png", filename="合成.png")
    assert db.ingest(replace(pending, attachment=ready))
    assert not db.ingest(pending)
    assert db.chat(ident)["unread_count"] == 1
    db.close()
    db = Database(path, "mock")
    rows = db.messages(ident)
    assert len(rows) == 1 and rows[0]["id"] == before["id"]
    assert rows[0]["observed_at"] == before["observed_at"]
    assert rows[0]["attachment"]["has_content"]
    assert "storage_key" not in rows[0]["attachment"]
    assert db.chat(ident)["unread_count"] == 1
    db.close()


def test_voice_transcript_search_and_pending_observation_does_not_erase_it(tmp_path):
    db = Database(tmp_path / "mock.sqlite3", "mock")
    ident = db.upsert_chat(Chat("mock:lin", "合成会話", "individual"))
    pending = observation(media(kind="voice"))
    db.ingest(pending)
    ready = media(kind="voice", status="ready", transcript="明日の集合は10時です", error_code="voice_audio_unavailable")
    db.ingest(replace(pending, attachment=ready))
    assert not db.ingest(pending)
    result = db.search("10時")
    assert len(result) == 1 and result[0]["attachment"]["transcript"] == ready["transcript"]
    assert not result[0]["attachment"]["has_content"]
    with pytest.raises(ValueError, match="content_conflict"):
        db.ingest(replace(pending, attachment={**ready, "transcript": "別の原文"}))
    assert db.chat(ident)["unread_count"] == 1
    db.close()


def test_inbox_media_update_gets_new_sequence_and_cache_survives_ack(tmp_path):
    store = PlusStore(tmp_path / "worker.sqlite3")
    pending = observation()
    store.ingest(pending)
    first = store.inbox()[0]["sequence"]
    ready = media(status="ready", storage_key="b" * 64, size_bytes=3, filename="test")
    store.ingest(replace(pending, attachment=ready))
    second = store.inbox()[0]["sequence"]
    assert second > first
    store.ack([first])
    assert store.inbox()[0]["message"]["attachment"]["status"] == "ready"
    store.ack([second])
    store.ingest(pending)
    assert store.inbox()[0]["message"]["attachment"]["status"] == "ready"
    store.close()


def test_interrupted_download_does_not_restart_automatically(tmp_path):
    path = tmp_path / "mock.sqlite3"
    db = Database(path, "mock")
    db.upsert_chat(Chat("mock:lin", "合成会話", "individual"))
    db.ingest(observation())
    db.queue_attachment("a" * 32)
    assert db.claim_attachment()["status"] == "loading"
    db.close()
    db = Database(path, "mock")
    assert db.attachment("a" * 32)["error_code"] == "interrupted"
    assert db.claim_attachment() is None
    db.close()


class MediaMock(MockWeChatAdapter):
    def __init__(self, vault):
        super().__init__()
        self.vault, self.fetches = vault, 0
        self.history["mock:lin"].append(observation())

    async def fetch_attachment(self, chat_id, source_key):
        self.fetches += 1
        assert chat_id == "mock:lin" and source_key == observation().source_key
        stage = self.vault.root.parent / "synthetic-stage"
        stage.mkdir(exist_ok=True)
        source = stage / "test.html"
        source.write_bytes(b"<html><script>malicious()</script></html>")
        saved = self.vault.import_file(source, stage)
        return replace(observation(), attachment=media(status="ready", **saved))


def test_authenticated_async_fetch_download_headers_and_no_duplicate_actions(tmp_path):
    settings = Settings(db_path=tmp_path / "mock.sqlite3", token=TOKEN)
    adapter = MediaMock(MediaVault(tmp_path / "mock-attachments"))
    app = create_app(settings, adapter=adapter)
    ident = "a" * 32
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.get(f"/api/attachments/{ident}").status_code == 401
        assert client.get(f"/api/attachments/{ident}/content").status_code == 401
        client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
        assert client.post(f"/api/attachments/{ident}/fetch", json={}).status_code == 202
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            row = client.get(f"/api/attachments/{ident}").json()
            if row["status"] == "ready":
                break
            time.sleep(.03)
        assert row["status"] == "ready" and "storage_key" not in row
        response = client.get(f"/api/attachments/{ident}/content")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/octet-stream"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in response.headers["content-security-policy"]
        partial = client.get(f"/api/attachments/{ident}/content", headers={"Range": "bytes=0-4"})
        assert partial.status_code == 206 and partial.content == b"<html"
        client.post(f"/api/attachments/{ident}/fetch", json={})
        time.sleep(.25)
        assert adapter.fetches == 1 and adapter.sent_count == 0
        assert app.state.db.one("SELECT COUNT(*) AS n FROM send_queue")["n"] == 0


def test_sdk_media_identity_stable_after_wechat_changes_transcript():
    sdk = PlusSDK.__new__(PlusSDK)
    sdk.scope = "synthetic-scope"
    top = SimpleNamespace(NativeWindowHandle=10, GetRuntimeId=lambda: [1, 2])
    control = SimpleNamespace(GetTopLevelControl=lambda: top, GetRuntimeId=lambda: [3, 4])
    raw = SimpleNamespace(type="voice", attr="friend", content="[语音]", sender="合成", control=control)
    target = dict(id="synthetic-target", binding=digest([sdk.scope, 10, [1, 2]]))
    before = sdk._message(sdk._record(raw), target)
    raw.content = "WeChatの文字起こしで変化した表示"
    after = sdk._message(sdk._record(raw), target)
    assert before == after
    assert before.message_type == "voice" and before.content == "[ボイスメッセージ]"


def test_ready_attachment_cannot_be_rebound_to_other_content():
    old = media(status="ready", storage_key="b" * 64, size_bytes=5)
    assert merge_attachment(old, media()) == old
    with pytest.raises(ValueError):
        merge_attachment(old, media(status="ready", storage_key="c" * 64, size_bytes=5))
