"""Preview -> explicit consent -> one local job. No automatic retries or sends."""
import asyncio
import hashlib
import json
import time
from uuid import uuid4

from .adapters.base import now
from .ai_provider import AIError, INSTRUCTIONS, OUTPUTS


class AIService:
    def __init__(self, db, provider, enabled):
        self.db, self.provider, self.enabled = db, provider, enabled
        self.previews, self.running = {}, set()
        with db.lock, db.conn:
            db.conn.execute("UPDATE ai_jobs SET status='unknown',error_code='ai_result_unknown',completed_at=? WHERE status='processing'", (now(),))

    def status(self):
        return {"enabled": self.enabled, "configured": self.provider.ready,
                "ready": self.enabled and self.provider.ready, "provider": self.provider.name,
                "model": self.provider.model or None, "max_messages": 10, "max_characters": 12000,
                "automatic_send": False, "automatic_tasks": False}

    def preview(self, body):
        self.previews = {key: item for key, item in self.previews.items() if item["expires"] > time.monotonic()}
        if len(self.previews) >= 16:
            raise AIError("ai_preview_limit")
        chat = self.db.chat(body.chat_id)
        if not chat:
            raise AIError("chat_not_found")
        if len(body.message_ids) != len(set(body.message_ids)):
            raise AIError("ai_invalid_selection")
        rows = []
        for ident in sorted(body.message_ids):
            row = self.db.one("SELECT * FROM messages WHERE id=? AND chat_id=?", (ident, chat["id"]))
            if not row or row["message_type"] not in ("text", "ocr_text"):
                raise AIError("ai_invalid_selection")
            rows.append(row)
        if body.operation == "translate":
            if bool(rows) == bool(body.draft.strip()) or len(rows) > 1:
                raise AIError("ai_invalid_selection")
        elif not rows or (body.operation != "reply" and body.draft.strip()):
            raise AIError("ai_invalid_selection")
        messages = [{"index": i, "role": "self" if row["direction"] == "outgoing" else "other",
                     "content": row["content"]} for i, row in enumerate(rows)]
        payload = {"task": body.operation, "target_language": body.target_language, "messages": messages}
        if body.draft.strip():
            payload["draft"] = body.draft
        if body.instruction.strip():
            payload["user_instruction"] = body.instruction
        serialized = json.dumps(payload, ensure_ascii=False)
        if len(serialized) > 12000:
            raise AIError("ai_context_too_large")
        ident = str(uuid4())
        self.previews[ident] = {"expires": time.monotonic() + 300, "operation": body.operation,
            "chat_id": chat["id"], "payload": payload, "source_ids": [r["id"] for r in rows],
            "source_directions": [r["direction"] for r in rows],
            "hash": hashlib.sha256(serialized.encode()).hexdigest()}
        return {"id": ident, "expires_in": 300, "operation": body.operation, "payload": payload,
                "instructions": INSTRUCTIONS, "provider": self.provider.name, "model": self.provider.model or None,
                "history_scope": "selected_only", "characters": len(serialized), "ready": self.status()["ready"]}

    def job(self, ident):
        row = self.db.one("SELECT * FROM ai_jobs WHERE id=?", (ident,))
        if row:
            row["result"] = json.loads(row["result"]) if row["result"] else None
            row["source_message_ids"] = json.loads(row["source_message_ids"])
            row.pop("context_hash")
        return row

    def recent(self, chat_id):
        return [self.job(r["id"]) for r in self.db.all("SELECT id FROM ai_jobs WHERE chat_id=? ORDER BY created_at DESC LIMIT 10", (chat_id,))]

    def start(self, operation, ident):
        existing = self.job(ident)
        if existing:
            if existing["operation"] != operation:
                raise AIError("ai_preview_mismatch")
            return existing
        if not self.enabled:
            raise AIError("ai_disabled")
        if not self.provider.ready:
            raise AIError("ai_not_configured")
        preview = self.previews.get(ident)
        if not preview or preview["expires"] <= time.monotonic():
            self.previews.pop(ident, None)
            raise AIError("ai_preview_expired")
        if preview["operation"] != operation:
            raise AIError("ai_preview_mismatch")
        if self.running:
            raise AIError("ai_busy")
        with self.db.lock, self.db.conn:
            self.db.conn.execute("""INSERT INTO ai_jobs
                (id,chat_id,operation,provider,model,source_message_ids,source_draft,context_hash,status,created_at)
                VALUES(?,?,?,?,?,?,?,?,'processing',?)""", (ident, preview["chat_id"], operation,
                self.provider.name, self.provider.model, json.dumps(preview["source_ids"]),
                preview["payload"].get("draft") if operation == "translate" else None, preview["hash"], now()))
        self.previews.pop(ident)
        task = asyncio.create_task(self._run(ident, preview))
        self.running.add(task)
        task.add_done_callback(self.running.discard)
        return self.job(ident)

    def _finish(self, ident, status, result=None, error=None):
        with self.db.lock, self.db.conn:
            self.db.conn.execute("UPDATE ai_jobs SET status=?,result=?,error_code=?,completed_at=? WHERE id=?",
                (status, json.dumps(result, ensure_ascii=False) if result is not None else None, error, now(), ident))

    async def _run(self, ident, preview):
        try:
            operation = preview["operation"]
            raw = await asyncio.wait_for(self.provider.generate(operation, preview["payload"]), timeout=50)
            result = OUTPUTS[operation].model_validate(raw).model_dump(mode="json")
            if any(not text.strip() or len(text) > 4000 for text in result.get("candidates", [])):
                raise AIError("ai_invalid_response")
            if any(not text.strip() or len(text) > 500 for text in result.get("decisions", [])):
                raise AIError("ai_invalid_response")
            task_sources = set()
            for task in result.get("tasks", []):
                index = task.pop("source_index")
                if index in task_sources or index >= len(preview["source_ids"]) or preview["source_directions"][index] != "incoming":
                    raise AIError("ai_invalid_response")
                task_sources.add(index)
                task["source_message_id"] = preview["source_ids"][index]
            self._finish(ident, "completed", result)
        except asyncio.CancelledError:
            self._finish(ident, "unknown", error="ai_result_unknown")
            raise
        except asyncio.TimeoutError:
            self._finish(ident, "unknown", error="ai_result_unknown")
        except AIError as exc:
            self._finish(ident, "unknown" if exc.unknown else "failed", error=exc.code)
        except Exception:
            self._finish(ident, "failed", error="ai_invalid_response")

    async def close(self):
        self.previews.clear()
        tasks = list(self.running)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
