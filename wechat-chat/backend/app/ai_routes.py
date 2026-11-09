from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .ai_provider import AIError, Operation


class PreviewRequest(BaseModel):
    chat_id: str = Field(min_length=1, max_length=100)
    operation: Operation
    message_ids: list[int] = Field(default_factory=list, max_length=10)
    draft: str = Field(default="", max_length=4000)
    instruction: str = Field(default="", max_length=500)
    target_language: Literal["ja", "zh"] = "ja"


class ExecuteRequest(BaseModel):
    preview_id: UUID
    approved: Literal[True]


def register_ai_routes(api, app, security):
    @api.get("/ai/status")
    async def ai_status():
        return app.state.ai.status()

    @api.post("/ai/preview")
    async def preview(body: PreviewRequest):
        security.rate_limit("ai-preview", 20)
        try:
            return app.state.ai.preview(body)
        except AIError as exc:
            raise HTTPException(404 if exc.code == "chat_not_found" else 409, exc.code) from None

    @api.post("/ai/{operation}", status_code=202)
    async def execute(operation: Operation, body: ExecuteRequest):
        # Always require consent, including when querying an existing execution.
        security.rate_limit("ai-execute", 10)
        try:
            return app.state.ai.start(operation, str(body.preview_id))
        except AIError as exc:
            raise HTTPException(409, exc.code) from None

    @api.get("/ai/jobs/{ident}")
    async def job(ident: UUID):
        result = app.state.ai.job(str(ident))
        if not result:
            raise HTTPException(404, "ai_job_not_found")
        return result

    @api.get("/ai/chats/{ident}/jobs")
    async def recent(ident: str):
        if not app.state.db.chat(ident):
            raise HTTPException(404, "chat_not_found")
        return app.state.ai.recent(ident)
