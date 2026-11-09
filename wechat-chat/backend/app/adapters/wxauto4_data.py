"""Portable validation for the read-only wxauto4 worker's private IPC/cache."""
import hashlib
import json
import re

HEX = re.compile(r"^[a-f0-9]{64}$")
MAX_BYTES = 2_000_000
STATES = {"ready", "foreground_required", "user_active", "not_running", "login_required",
          "conversation_required", "ambiguous_chat", "scope_changed", "dependency_missing",
          "unsupported_version", "unsupported_os", "reader_busy", "reader_failed", "reader_timeout"}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def observation_key(scope, name, kind, runtime_id, content):
    return digest([scope, name, kind, runtime_id, content])


def valid_text(value, maximum, empty=False):
    return isinstance(value, str) and (empty or bool(value)) and len(value) <= maximum


def validate_snapshot(value):
    """Whitelist fields. No raw exception, account identifier or log is accepted."""
    if not isinstance(value, dict) or value.get("state") not in STATES:
        raise ValueError("invalid_reader_result")
    output = {"state": value["state"], "chat": None, "messages": [], "discovered_count": 0,
              "remaining_count": 0, "unsupported_count": 0, "parsed_count": 0, "menu_count": 0}
    if not value.get("chat"):
        if value.get("messages"):
            raise ValueError("missing_chat")
        return output
    chat = value["chat"]
    if not isinstance(chat, dict) or not HEX.fullmatch(chat.get("scope", "")) or not valid_text(chat.get("name"), 500) or chat.get("type") not in ("individual", "group"):
        raise ValueError("invalid_chat")
    expected_id = "wxauto4:local:" + digest([chat["scope"], chat["name"], chat["type"]])
    if chat.get("external_id") != expected_id:
        raise ValueError("chat_identity_mismatch")
    members = chat.get("member_count")
    if members is not None and (type(members) is not int or not 1 <= members <= 100000):
        raise ValueError("invalid_members")
    output["chat"] = {k: chat.get(k) for k in ("scope", "name", "type", "external_id", "member_count")}
    rows = value.get("messages", [])
    if not isinstance(rows, list) or len(rows) > 100:
        raise ValueError("too_many_messages")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not HEX.fullmatch(row.get("source_key", "")) or row["source_key"] in seen:
            raise ValueError("invalid_observation")
        if not valid_text(row.get("content"), 20000) or not valid_text(row.get("sender_name"), 500, empty=True) or row.get("direction") not in ("incoming", "outgoing"):
            raise ValueError("invalid_message")
        seen.add(row["source_key"])
        output["messages"].append({k: row[k] for k in ("source_key", "content", "sender_name", "direction")})
    for key in ("discovered_count", "remaining_count", "unsupported_count", "parsed_count", "menu_count"):
        count = value.get(key, 0)
        if type(count) is not int or not 0 <= count <= 100000:
            raise ValueError("invalid_count")
        output[key] = count
    if output["parsed_count"] > 1 or output["menu_count"] > 2:
        raise ValueError("reader_activity_limit")
    return output
