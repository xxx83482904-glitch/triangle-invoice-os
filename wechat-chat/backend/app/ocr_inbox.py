"""Authenticated, ephemeral OCR previews. No network OCR and no disk images."""
import asyncio
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

from .adapters.base import AdapterError, now

ERRORS = {"unsupported_os", "ocr_dependency_missing", "ocr_window_ambiguous", "ocr_desktop_unavailable", "ocr_window_unsupported", "ocr_capture_failed", "ocr_window_changed", "ocr_language_unavailable", "ocr_too_many_lines"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def capture_local(language):
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "app.adapters.windows_ocr_capture", language,
        cwd=Path(__file__).parent.parent, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    try:
        raw, _ = await asyncio.wait_for(process.communicate(), timeout=10)
        if process.returncode or len(raw) > 2_000_000:
            raise AdapterError("ocr_capture_failed")
        result = json.loads(raw)
        if result.get("error"):
            raise AdapterError(result["error"] if result["error"] in ERRORS else "ocr_capture_failed")
        if not result.get("lines"):
            raise AdapterError("ocr_no_text")
        return result
    except asyncio.TimeoutError:
        raise AdapterError("ocr_timeout") from None
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()


class OcrInbox:
    ttl = 300

    def __init__(self):
        self.previews = {}
        self.lock = asyncio.Lock()

    def purge(self):
        clock = time.monotonic()
        self.previews = {key: value for key, value in self.previews.items() if value["deadline"] > clock}

    async def clean(self):
        while True:
            await asyncio.sleep(30)
            self.purge()

    async def preview(self, language, delay):
        if self.lock.locked():
            raise AdapterError("ocr_busy")
        async with self.lock:
            await asyncio.sleep(delay)
            data = await capture_local(language)
            occurrences = Counter()
            for index, line in enumerate(data["lines"]):
                line["id"] = index
                line["occurrence"] = occurrences[line["text"]]
                occurrences[line["text"]] += 1
            self.purge()
            while len(self.previews) >= 2:
                self.previews.pop(next(iter(self.previews)))
            ident = str(uuid4())
            data.update({"id": ident, "captured_at": now(), "expires_in": self.ttl})
            # Keep only text and provenance in the server cache. The thumbnail is
            # returned once and never persisted, even in the preview cache.
            self.previews[ident] = {**data, "image": None, "deadline": time.monotonic() + self.ttl}
            return data

    def source(self, preview_id, ids):
        self.purge()
        preview = self.previews.get(preview_id)
        if not preview:
            raise AdapterError("ocr_preview_expired")
        if not ids or len(ids) != len(set(ids)):
            raise AdapterError("ocr_selection_invalid")
        by_id = {line["id"]: line for line in preview["lines"]}
        if any(ident not in by_id for ident in ids):
            raise AdapterError("ocr_selection_invalid")
        # Excludes capture time/coordinates so repeating a capture does not insert
        # duplicates. Identical reposts or changed OCR output remain ambiguous.
        key = digest([[by_id[i]["text"], by_id[i]["occurrence"]] for i in sorted(ids)])
        return key, preview["captured_at"]
