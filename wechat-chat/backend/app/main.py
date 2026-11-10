import asyncio
import hmac
import json
from datetime import date
from contextlib import asynccontextmanager, suppress
from dataclasses import asdict
from typing import Literal
from uuid import UUID

from anyio import CancelScope
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .adapters.mock import MockWeChatAdapter
from .adapters.stored_history import StoredHistoryAdapter
from .adapters.base import now
from .adapters.windows_uia import WindowsUIAAdapter
from .adapters.windows_ocr import WindowsOCRAdapter
from .adapters.windows_wxauto4 import WindowsWxauto4Adapter
from .adapters.windows_plus import WindowsPlusAdapter
from .ocr_inbox import OcrInbox
from .ocr_routes import register_ocr_routes
from .assistance import LocalRulesProvider, attention_snapshot
from .body_limit import BodyLimitMiddleware
from .config import Settings
from .database import Database
from .engine import Engine
from .security import COOKIE, SESSION_SECONDS, Security
from .wxauto_trial import read_report
from .ai_provider import OpenAIProvider
from .ai_service import AIService
from .ai_routes import register_ai_routes
from .media_store import ATTACHMENT_ID, INLINE_IMAGES, MediaVault, public_attachment, sniff_type
from .notifications import NotificationService, register_notification_routes


class Login(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class Send(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    expected_external_id: str = Field(min_length=1, max_length=500)
    expected_name: str = Field(min_length=1, max_length=500)
    client_request_id: UUID


class Read(BaseModel):
    through_id: int = Field(ge=0)


class Priority(BaseModel):
    priority: Literal["auto", "high", "normal", "low"]


class NewTask(BaseModel):
    chat_id: str = Field(min_length=1, max_length=100)
    source_message_id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    due_date: date | None = None
    client_request_id: UUID


class TaskState(BaseModel):
    status: Literal["open", "done"]


class MockAction(BaseModel):
    action: Literal["receive", "disconnect", "reconnect", "next_unknown", "next_failed", "next_confirmed"]
    chat_id: str | None = None


class HistoryAction(BaseModel):
    action: Literal['start','pause','resume']


def create_app(settings=None, adapter=None, ai_provider=None, push_transport=None):
    settings = settings or Settings.from_env()
    security = Security(settings)
    assistance = LocalRulesProvider()

    @asynccontextmanager
    async def lifespan(app):
        db = Database(settings.db_path, settings.adapter)
        app.state.media = MediaVault(settings.db_path.parent / (settings.db_path.stem + "-attachments"))
        selected = adapter
        if not settings.ui_access_enabled and settings.adapter != "mock":
            selected = StoredHistoryAdapter(settings.adapter)
        if selected is None:
            if settings.adapter == "mock":
                selected = MockWeChatAdapter()
            elif settings.adapter == "windows-ocr":
                selected = WindowsOCRAdapter()
            elif settings.adapter == "wxauto4":
                selected = WindowsWxauto4Adapter(settings.poll_seconds)
            elif settings.adapter == "wxautox4":
                selected = WindowsPlusAdapter(settings.db_path.with_name(settings.db_path.stem + "-worker.sqlite3"),
                    send_enabled=settings.plus_send_enabled, max_listeners=settings.plus_max_listeners,
                    language=settings.plus_language, client_kind=settings.plus_client_kind, preferred_chats=settings.plus_preferred_chats)
            else:
                selected = WindowsUIAAdapter(settings.poll_seconds)
        engine = Engine(db, selected, settings)
        app.state.db, app.state.engine, app.state.security = db, engine, security
        app.state.notifications = NotificationService(db, settings, push_transport)
        provider = ai_provider or OpenAIProvider(settings.openai_api_key, settings.openai_model)
        app.state.ai = AIService(db, provider, settings.ai_enabled)
        app.state.wechat_diagnostic_lock = asyncio.Lock()
        app.state.ocr = OcrInbox()
        cleaner = asyncio.create_task(app.state.ocr.clean())
        await engine.start()
        app.state.notifications.start()
        try:
            yield
        finally:
            cleaner.cancel()
            with suppress(asyncio.CancelledError):
                await cleaner
            app.state.ocr.previews.clear()
            await app.state.ai.close()
            await app.state.notifications.close()
            await engine.stop()
            db.close()

    app = FastAPI(title="こもれび · WeChat local bridge", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.hosts))

    @app.middleware("http")
    async def protect(request, call_next):
        # Reject large bodies before Pydantic can include input in a validation response.
        try:
            size = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "invalid_request"}, status_code=400)
        if size < 0:
            return JSONResponse({"detail": "invalid_request"}, status_code=400)
        if size > 32768:
            return JSONResponse({"detail": "request_too_large"}, status_code=413)
        if request.method == "POST" and request.url.path.startswith("/api/"):
            if not request.headers.get("content-type", "").startswith("application/json"):
                return JSONResponse({"detail": "json_required"}, status_code=415)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") or request.url.path in ("/", "/sw.js") else "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers.setdefault("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'")
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"detail": "invalid_request"}, status_code=422)

    @app.get("/api/health")
    async def health():
        return {"ok": True, "service": "komorebi"}

    @app.post("/api/auth/login")
    async def login(body: Login, request: Request, response: Response):
        security.origin(request.headers.get("origin"))
        if not hmac.compare_digest(body.token.encode(), settings.token.encode()):
            # Funnel requests share a loopback peer. Invalid attempts must not
            # exhaust the owner's valid-login budget; never trust forwarded IPs.
            security.rate_limit("login-failure", 10)
            raise HTTPException(401, "invalid_access_token")
        security.rate_limit("login-success", 20)
        # Origin has already been checked against an exact allowlist. Tailscale
        # terminates TLS locally; do not trust arbitrary X-Forwarded-* headers.
        secure = settings.secure_cookie or request.headers.get("origin", "").startswith("https://")
        response.set_cookie(COOKIE, security.issue(), httponly=True, secure=secure, samesite="strict", max_age=SESSION_SECONDS, path="/")
        return {"ok": True}

    api = APIRouter(prefix="/api", dependencies=[Depends(security.check)])

    @api.post("/auth/logout")
    async def logout(request: Request, response: Response):
        app.state.notifications.unsubscribe(session_hash=security.digest(request.cookies.get(COOKIE) or 'bearer'))
        security.revoke(request.cookies.get(COOKIE))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @api.get("/status")
    async def status():
        return await app.state.engine.status()

    @api.get('/history')
    async def history_status():
        adapter=app.state.engine.adapter
        report=app.state.db.one('SELECT report FROM backup_inspections ORDER BY id DESC LIMIT 1')
        result = {'supported':isinstance(adapter,WindowsPlusAdapter),
                'sync':adapter.history_status() if isinstance(adapter,WindowsPlusAdapter) else None,
                'backup':json.loads(report['report']) if report else None}
        if not settings.ui_access_enabled:
            result['reason'] = 'ui_access_disabled'
        return result

    @api.post('/history',status_code=202)
    async def history_control(body: HistoryAction):
        if not settings.ui_access_enabled:
            raise HTTPException(409, 'ui_access_disabled')
        security.rate_limit('history',12)
        adapter=app.state.engine.adapter
        if not isinstance(adapter,WindowsPlusAdapter):
            raise HTTPException(409,'history_unavailable')
        try:
            result=await adapter.history_command(body.action)
        except ValueError as exc:
            code=str(exc) if str(exc) in ('history_scope_changed','history_connection_required') else 'history_unavailable'
            raise HTTPException(409,code) from None
        app.state.engine.hub.publish('status')
        return result

    @api.get("/device")
    async def device():
        return {"mobile_url": settings.mobile_url, "mobile_access": settings.mobile_access, "ai_enabled": app.state.ai.status()["ready"], "push_enabled": app.state.notifications.enabled}

    register_notification_routes(api, app, security)

    @api.post("/wechat/diagnostics")
    async def wechat_diagnostics():
        if not settings.ui_access_enabled:
            raise HTTPException(409, 'ui_access_disabled')
        # A bounded read-only process; never switches the running adapter or DB,
        # activates windows, types, clicks, starts WeChat or logs message content.
        lock = app.state.wechat_diagnostic_lock
        if lock.locked():
            raise HTTPException(409, "diagnostic_busy")
        security.rate_limit("wechat-diagnostics", 6)
        async with lock:
            diagnostic = await asyncio.to_thread(WindowsUIAAdapter._probe)
        return {"connection": asdict(WindowsUIAAdapter.describe(diagnostic)), "diagnostic": diagnostic,
                "checked_at": now(), "active_adapter": settings.adapter,
                "active_connection": await app.state.engine.status()}

    @api.get("/wechat/free-trial")
    async def wechat_free_trial():
        # Stored evidence only. A browser request cannot run/install wxauto4,
        # change the active adapter, import messages or authorize real sending.
        return read_report(settings.wxauto_trial_report)

    @api.get("/chats")
    async def chats():
        return app.state.db.chats()

    def require_attachment(ident):
        if not ATTACHMENT_ID.fullmatch(ident):
            raise HTTPException(404, "attachment_not_found")
        row = app.state.db.attachment(ident)
        if row is None:
            raise HTTPException(404, "attachment_not_found")
        return row

    @api.post("/attachments/{ident}/fetch", status_code=202)
    async def fetch_attachment(ident: str):
        row = require_attachment(ident)
        status = await app.state.engine.status()
        if not status["can_read"]:
            raise HTTPException(409, "source_unavailable")
        if status["mode"] == "wxautox4" and row["external_id"] not in (status.get("monitoring") or {}).get("active_chat_ids", []):
            raise HTTPException(409, "source_unavailable")
        security.rate_limit("attachment-fetch", 12)
        try:
            result = app.state.db.queue_attachment(ident)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        app.state.engine.hub.publish("message", row["chat_id"])
        return result

    @api.get("/attachments/{ident}")
    async def attachment_status(ident: str):
        return public_attachment(require_attachment(ident))

    @api.get("/attachments/{ident}/content")
    async def attachment_content(ident: str, download: bool = False):
        row = require_attachment(ident)
        if row["status"] != "ready" or not row["storage_key"]:
            raise HTTPException(404, "attachment_not_ready")
        try:
            path = app.state.media.locate(row["storage_key"])
            # Never trust a filename extension or serve HTML/SVG as executable
            # same-origin content. Only sniffed raster images may be inline.
            with path.open("rb") as stream:
                mime = sniff_type(stream.read(32))
        except (ValueError, OSError):
            raise HTTPException(404, "attachment_missing") from None
        inline = not download and row["kind"] == "image" and mime in INLINE_IMAGES
        return FileResponse(path, media_type=mime, filename=row["filename"] or "attachment",
            content_disposition_type="inline" if inline else "attachment",
            headers={"Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
                     "Cross-Origin-Resource-Policy": "same-origin"})

    def require_chat(ident):
        chat = app.state.db.chat(ident)
        if not chat:
            raise HTTPException(404, "chat_not_found")
        return chat

    @api.get("/attention")
    async def attention():
        return attention_snapshot(app.state.db, assistance)

    @api.post("/chats/{ident}/priority")
    async def priority(ident: str, body: Priority):
        require_chat(ident)
        app.state.db.set_priority(ident, body.priority)
        app.state.engine.hub.publish("attention", ident)
        return {"ok": True}

    @api.get("/tasks")
    async def tasks():
        return app.state.db.tasks()

    @api.post("/tasks", status_code=201)
    async def create_task(body: NewTask):
        require_chat(body.chat_id)
        if not body.title.strip():
            raise HTTPException(422, "empty_task")
        try:
            result = app.state.db.create_task(body.chat_id, body.source_message_id, body.title.strip(), body.due_date.isoformat() if body.due_date else None, str(body.client_request_id))
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        app.state.engine.hub.publish("tasks", body.chat_id)
        return result

    @api.post("/tasks/{ident}/state")
    async def task_state(ident: str, body: TaskState):
        result = app.state.db.set_task_state(ident, body.status)
        if not result:
            raise HTTPException(404, "task_not_found")
        app.state.engine.hub.publish("tasks", result["chat_id"])
        return result

    @api.get("/chats/{ident}/messages")
    async def messages(ident: str, before: int | None = Query(None, ge=1), limit: int = Query(100, ge=1, le=200), through: int | None = Query(None, ge=1)):
        require_chat(ident)
        if before and through:
            raise HTTPException(422,'invalid_request')
        rows = app.state.db.messages(ident, before, limit, through=through)
        has_more = bool(rows and app.state.db.messages(ident, rows[0]['id'], 1))
        return {"messages": rows, "has_more": has_more, "history_scope": "stored_only"}

    @api.post("/chats/{ident}/read")
    async def read(ident: str, body: Read):
        require_chat(ident)
        app.state.db.mark_read(ident, body.through_id)
        app.state.engine.hub.publish("read", ident)
        return {"ok": True}

    @api.post("/chats/{ident}/send", status_code=202)
    @api.post("/chats/{ident}/messages", status_code=202)
    async def send(ident: str, body: Send):
        chat = require_chat(ident)
        if not body.content.strip():
            raise HTTPException(422, "empty_message")
        existing = app.state.db.one("SELECT * FROM send_queue WHERE client_request_id=?", (str(body.client_request_id),))
        if not existing:
            connection = await app.state.engine.adapter.get_connection_status()
            if not connection.can_send or connection.state != "connected":
                raise HTTPException(409, "sending_unavailable")
            security.rate_limit("send", 10)
        try:
            result = app.state.db.enqueue(chat, body.content, str(body.client_request_id), body.expected_external_id, body.expected_name)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        app.state.engine.hub.publish("queue", ident)
        return result

    @api.get("/queue")
    async def queue():
        return app.state.db.queue()

    @api.get("/requests/{request_id}")
    async def request_status(request_id: UUID):
        row = app.state.db.one("SELECT * FROM send_queue WHERE client_request_id=?", (str(request_id),))
        if not row:
            raise HTTPException(404, "request_not_observed")
        return row

    @api.get("/search")
    async def search(q: str = Query(min_length=1, max_length=200)):
        return {"results": app.state.db.search(q), "limit": 100, "scope": "stored_only"}

    @api.post("/sync")
    async def sync():
        security.rate_limit("sync", 6)
        await app.state.engine.sync()
        return await app.state.engine.status()

    @api.post("/mock")
    async def mock(body: MockAction):
        engine = app.state.engine
        if not isinstance(engine.adapter, MockWeChatAdapter):
            raise HTTPException(404, "mock_only")
        if body.action == "receive":
            if not engine.adapter.online:
                raise HTTPException(409, "mock_offline")
            chat = require_chat(body.chat_id)
            await engine.adapter.inject(chat["external_id"])
        elif body.action == "disconnect":
            await engine.adapter.disconnect()
            app.state.db.connection("disconnected")
        elif body.action == "reconnect":
            await engine.adapter.connect()
            await engine.sync()
        else:
            engine.adapter.next_result = body.action.removeprefix("next_")
        engine.hub.publish("status")
        return await engine.status()

    register_ocr_routes(api, app, settings, security)
    register_ai_routes(api, app, security)
    app.include_router(api)

    @app.websocket("/ws")
    @app.websocket("/ws/events")
    async def websocket(ws: WebSocket):
        if ws.headers.get("origin") not in settings.origins or not security.valid_session(ws.cookies.get(COOKIE)):
            await ws.close(code=1008)
            return
        if len(app.state.engine.hub.listeners) >= 20:
            await ws.close(code=1013)
            return
        await ws.accept()
        events = asyncio.Queue(maxsize=32)
        app.state.engine.hub.listeners.add(events)
        async def stream():
            while security.valid_session(ws.cookies.get(COOKIE)):
                try:
                    event = await asyncio.wait_for(events.get(), timeout=5)
                except asyncio.TimeoutError:
                    event = {"type": "heartbeat"}
                await ws.send_json(event)
            await ws.close(code=1008)
        async def receive():
            while True:
                await ws.receive_text()
        tasks = []
        try:
            await ws.send_json({"type": "ready"})
            tasks = [asyncio.create_task(stream()), asyncio.create_task(receive())]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            app.state.engine.hub.listeners.discard(events)
            for task in tasks:
                task.cancel()
            # A disconnect may coincide with an outer ASGI cancellation. Let the
            # already-cancelled child tasks finish without replacing that outer
            # cancellation with a second, unrelated CancelledError.
            with CancelScope(shield=True):
                await asyncio.gather(*tasks, return_exceptions=True)

    if settings.frontend.is_dir():
        app.mount("/", StaticFiles(directory=settings.frontend, html=True), name="frontend")
    return app
