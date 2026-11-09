from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .adapters.base import AdapterError
from .ocr_inbox import digest


class Preview(BaseModel):
    language: Literal["ja", "zh-Hans-CN", "en-US"] = "ja"
    delay: Literal[0, 3] = 0


class Import(BaseModel):
    preview_id: UUID
    line_ids: list[int] = Field(min_length=1, max_length=30)
    chat_id: UUID | None = None
    expected_external_id: str | None = Field(default=None, max_length=100)
    chat_name: str = Field(min_length=1, max_length=100)
    chat_type: Literal["individual", "group"]
    content: str = Field(min_length=1, max_length=4000)
    sender_name: str = Field(min_length=1, max_length=100)
    direction: Literal["incoming", "outgoing"]
    reviewed: Literal[True]
    client_request_id: UUID


def register_ocr_routes(api, app, settings, security):
    def require_mode():
        if settings.adapter != "windows-ocr":
            raise HTTPException(409, "ocr_mode_required")

    @api.post("/wechat/ocr/preview")
    async def preview(body: Preview):
        require_mode()
        security.rate_limit("ocr-preview", 6)
        try:
            return await app.state.ocr.preview(body.language, body.delay)
        except AdapterError as error:
            raise HTTPException(409, str(error)) from None
        except Exception:
            raise HTTPException(503, "ocr_capture_failed") from None

    @api.post("/wechat/ocr/import")
    async def import_message(body: Import):
        require_mode()
        security.rate_limit("ocr-import", 20)
        data = body.model_dump(mode="json")
        for key in ("chat_name", "content", "sender_name"):
            data[key] = data[key].strip()
            if not data[key]:
                raise HTTPException(422, "invalid_request")
        payload_hash = digest(data)
        try:
            previous = app.state.db.ocr_receipt(data["client_request_id"], payload_hash)
            if previous:
                return previous  # Safe even after preview expiration/restart.
            source_key, observed_at = app.state.ocr.source(data["preview_id"], data["line_ids"])
            result = app.state.db.import_ocr(data, payload_hash, source_key, observed_at)
        except (AdapterError, ValueError) as error:
            raise HTTPException(409, str(error)) from None
        app.state.engine.hub.publish("message", result["chat_id"])
        return result
