import sqlite3
from uuid import uuid4

import pytest

from app.adapters.base import Chat, Message
from app.database import Database
from app.reader_archive import import_reader_archive, ARCHIVE_NOTE


def reader(path, mode="wxauto4"):
    db = Database(path, mode)
    ident = db.upsert_chat(Chat("wxauto4:local:synthetic", "Archive test", "individual"))
    db.ingest(Message("wxauto4:local:synthetic", "Synthetic history", "unavailable", "Synthetic", "incoming", None,
        timestamp_quality="unavailable", identity_quality="uia_runtime", source_key="old-source-key", delivery_status="received"))
    return db, ident


def test_archive_preserves_wal_history_ids_and_original(tmp_path):
    source, dest = tmp_path / "reader.sqlite3", tmp_path / "plus.sqlite3"
    db, ident = reader(source)
    original = db.messages(ident)
    old_chat = db.chat(ident)
    assert import_reader_archive(source, dest) == {"chats": 1, "messages": 1}
    assert db.messages(ident) == original and db.chat(ident) == old_chat
    assert db.one("SELECT value FROM metadata WHERE key='adapter'")["value"] == "wxauto4"
    plus = Database(dest, "wxautox4")
    assert plus.messages(ident) == original
    assert plus.chat(ident)["external_id"] == old_chat["external_id"]
    assert plus.chat(ident)["history_note"].startswith(ARCHIVE_NOTE)
    assert plus.chat(ident)["sync_status"] == "partial"
    assert plus.queue() == []
    plus.close()
    db.close()


@pytest.mark.parametrize("mode", ["mock", "windows-ocr", "wxautox4"])
def test_archive_rejects_other_sources(tmp_path, mode):
    source, dest = tmp_path / "source.sqlite3", tmp_path / "dest.sqlite3"
    db, _ = reader(source, mode)
    db.close()
    with pytest.raises(ValueError, match="only_real_read_only"):
        import_reader_archive(source, dest)
    assert not dest.exists()


def test_archive_never_overwrites_existing_or_source(tmp_path):
    source, dest = tmp_path / "source.sqlite3", tmp_path / "dest.sqlite3"
    db, _ = reader(source)
    db.close()
    dest.write_text("owner data")
    with pytest.raises(ValueError):
        import_reader_archive(source, dest)
    with pytest.raises(ValueError):
        import_reader_archive(source, source)
    assert dest.read_text() == "owner data"


def test_archive_never_copies_send_queue(tmp_path):
    source, dest = tmp_path / "source.sqlite3", tmp_path / "dest.sqlite3"
    db, ident = reader(source)
    chat = db.chat(ident)
    db.enqueue(chat, "Pending", str(uuid4()), chat["external_id"], chat["name"])
    db.close()
    with pytest.raises(ValueError, match="queue_must_be_empty"):
        import_reader_archive(source, dest)
    assert not dest.exists()
