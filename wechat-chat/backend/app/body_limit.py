"""Bound request bodies even when the peer uses chunked transfer encoding."""
import asyncio
import time

from starlette.responses import JSONResponse


class BodyLimitMiddleware:
    def __init__(self, app, limit=32768, timeout=10):
        self.app, self.limit, self.timeout = app, limit, timeout

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        chunks, size = [], 0
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                message = await asyncio.wait_for(receive(), max(0, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                await JSONResponse({"detail": "request_timeout"}, status_code=408)(scope, receive, send)
                return
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.limit:
                await JSONResponse({"detail": "request_too_large"}, status_code=413)(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        consumed = False

        async def replay():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
