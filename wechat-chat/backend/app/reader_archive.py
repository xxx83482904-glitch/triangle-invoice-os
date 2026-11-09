"""One-way, offline copy of a free Reader DB into a NEW Plus DB.

Old source keys and message IDs remain unchanged. Archived destinations are
absent from the Plus worker's active bindings and therefore cannot be sent to.
"""
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory


ARCHIVE_NOTE = "無料Readerで保存した過去の記録です。現在のPlus監視先とは自動結合せず、この宛先への送信はできません。"


def import_reader_archive(source: Path, destination: Path):
    source, destination = source.resolve(), destination.resolve()
    if not source.is_file() or source == destination or destination.exists():
        raise ValueError("archive_requires_existing_source_and_new_destination")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # SQLite backup includes committed WAL data; never copy a live .sqlite3
    # file directly. The original stays read-only and retains its adapter tag.
    with TemporaryDirectory(prefix=".reader-archive-", dir=destination.parent) as directory:
        temporary = Path(directory) / "archive.sqlite3"
        original = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
        copied = sqlite3.connect(temporary)
        try:
            original.backup(copied)
            mode = copied.execute("SELECT value FROM metadata WHERE key='adapter'").fetchone()
            if mode != ("wxauto4",):
                raise ValueError("only_real_read_only_archive_supported")
            if copied.execute("SELECT COUNT(*) FROM send_queue").fetchone()[0]:
                raise ValueError("archive_queue_must_be_empty")
            if copied.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("archive_integrity_failed")
            with copied:
                copied.execute("UPDATE metadata SET value='wxautox4' WHERE key='adapter'")
                copied.execute("INSERT OR REPLACE INTO metadata VALUES('reader_archive','wxauto4')")
                copied.execute("UPDATE chats SET sync_status='partial',history_note=? || COALESCE(history_note,'')", (ARCHIVE_NOTE,))
                copied.execute("UPDATE sync_state SET connection_status='limited',error_message='reader_archive'")
            counts = {table: copied.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in ("chats", "messages")}
            copied.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            copied.execute("PRAGMA journal_mode=DELETE")
        finally:
            original.close()
            copied.close()
        # Atomic, no-clobber publication on the same local disk. A competing
        # creator makes this fail, never overwrite an existing destination.
        os.link(temporary, destination)
    return counts
