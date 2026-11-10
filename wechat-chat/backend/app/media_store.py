"""Private local attachment storage. No remote URLs, executable previews or AI."""
import hashlib
import os
import re
from pathlib import Path
from tempfile import NamedTemporaryFile


MAX_FILE_BYTES = 100 * 1024 * 1024
STORAGE_KEY = re.compile(r"^[a-f0-9]{64}$")
ATTACHMENT_ID = re.compile(r"^[a-f0-9]{32}$")
KINDS = {"image", "file", "voice", "video"}
STATES = {"pending", "queued", "loading", "ready", "unavailable", "too_large", "failed"}
ERRORS = {None, "source_unavailable", "download_failed", "too_large", "voice_audio_unavailable", "transcription_unavailable", "interrupted"}
FIELDS = ("id", "kind", "status", "filename", "mime_type", "size_bytes", "storage_key", "transcript", "error_code")
INLINE_IMAGES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


def sniff_type(data: bytes):
    if data.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if data.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"): return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP": return "image/webp"
    if data.startswith(b"%PDF-"): return "application/pdf"
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE": return "audio/wav"
    if data.startswith(b"OggS"): return "audio/ogg"
    if len(data) >= 12 and data[4:8] == b"ftyp": return "video/mp4"
    return "application/octet-stream"


def validate_attachment(value):
    if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not ATTACHMENT_ID.fullmatch(value["id"]):
        raise ValueError("invalid_attachment")
    if value.get("kind") not in KINDS or value.get("status") not in STATES or value.get("error_code") not in ERRORS:
        raise ValueError("invalid_attachment")
    if set(value) - set(FIELDS):
        raise ValueError("invalid_attachment")
    for key, limit in (("filename", 240), ("mime_type", 100), ("transcript", 20000)):
        if value.get(key) is not None and (not isinstance(value[key], str) or len(value[key]) > limit):
            raise ValueError("invalid_attachment")
    key = value.get("storage_key")
    size = value.get("size_bytes")
    if key is not None and (not isinstance(key, str) or not STORAGE_KEY.fullmatch(key)):
        raise ValueError("invalid_attachment")
    if size is not None and (type(size) is not int or not 0 <= size <= MAX_FILE_BYTES):
        raise ValueError("invalid_attachment")
    if (key is None) != (size is None) or (key and value["status"] != "ready"):
        raise ValueError("invalid_attachment")
    if value["status"] == "ready":
        if value["kind"] == "voice":
            if not key and not value.get("transcript"):
                raise ValueError("invalid_attachment")
        elif not key or size is None:
            raise ValueError("invalid_attachment")
    return {field: value.get(field) for field in FIELDS}


def merge_attachment(previous, incoming):
    """A repeated UI observation cannot erase a completed local download."""
    incoming = validate_attachment(incoming)
    if previous is None:
        return incoming
    previous = validate_attachment(previous)
    if (previous["id"], previous["kind"]) != (incoming["id"], incoming["kind"]):
        raise ValueError("attachment_identity_conflict")
    for field in ("storage_key", "transcript"):
        if previous[field] and incoming[field] and previous[field] != incoming[field]:
            raise ValueError("attachment_content_conflict")
    if previous["status"] == "ready" or (incoming["status"] == "pending" and previous["status"] != "pending"):
        return previous
    return incoming


def public_attachment(value):
    result = {key: value.get(key) for key in FIELDS if key != "storage_key"}
    result["has_content"] = bool(value.get("storage_key")) and value["status"] == "ready"
    return result


class MediaVault:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def locate(self, key: str):
        if not isinstance(key, str) or not STORAGE_KEY.fullmatch(key):
            raise ValueError("invalid_storage_key")
        original = self.root / key
        if original.is_symlink():
            raise ValueError("attachment_missing")
        candidate = original.resolve()
        if candidate.parent != self.root or not candidate.is_file():
            raise ValueError("attachment_missing")
        return candidate

    def import_file(self, source: Path, staging: Path):
        source, staging = source.resolve(strict=True), staging.resolve(strict=True)
        if not source.is_relative_to(staging) or not source.is_file():
            raise ValueError("download_path_outside_staging")
        size = source.stat().st_size
        if not 0 <= size <= MAX_FILE_BYTES:
            raise ValueError("too_large")
        digest = hashlib.sha256()
        temporary = None
        copied, head = 0, b""
        try:
            with NamedTemporaryFile(prefix=".incoming-", dir=self.root, delete=False) as output, source.open("rb") as stream:
                temporary = Path(output.name)
                while chunk := stream.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > MAX_FILE_BYTES:
                        raise ValueError("too_large")
                    if not head:
                        head = chunk[:32]
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            key = digest.hexdigest()
            # Publish only a completely written blob, atomically, without
            # replacing an existing file. The content hash is never a path.
            try:
                os.link(temporary, self.root / key)
            except FileExistsError:
                existing_digest = hashlib.sha256()
                with self.locate(key).open("rb") as existing:
                    while chunk := existing.read(1024 * 1024):
                        existing_digest.update(chunk)
                if existing_digest.hexdigest() != key:
                    raise ValueError("attachment_conflict") from None
            return {"storage_key": key, "size_bytes": copied, "mime_type": sniff_type(head),
                    "filename": re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', '_', source.name)[:240]}
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
