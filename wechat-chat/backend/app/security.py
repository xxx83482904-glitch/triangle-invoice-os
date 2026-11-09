import hashlib
import hmac
import secrets
import time

from fastapi import HTTPException, Request

COOKIE = "wechat_session"
SESSION_SECONDS = 12 * 60 * 60


class Security:
    def __init__(self, settings):
        self.settings = settings
        self.sessions: dict[str, float] = {}
        self.attempts: dict[str, list[float]] = {}

    def issue(self):
        # Server-side sessions are revoked on logout and process restart.
        current = time.time()
        self.sessions = {key: expiry for key, expiry in self.sessions.items() if expiry > current}
        if len(self.sessions) >= 64:
            self.sessions.pop(min(self.sessions, key=self.sessions.get))
        value = secrets.token_urlsafe(32)
        self.sessions[self.digest(value)] = current + SESSION_SECONDS
        return value

    @staticmethod
    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def valid_session(self, value):
        key = self.digest(value or "")
        expires = self.sessions.get(key, 0)
        if expires <= time.time():
            self.sessions.pop(key, None)
            return False
        return True

    def revoke(self, value):
        self.sessions.pop(self.digest(value or ""), None)

    def origin(self, origin):
        if origin not in self.settings.origins:
            raise HTTPException(403, "origin_not_allowed")

    def check(self, request: Request):
        authorization = request.headers.get("authorization", "")
        bearer = authorization.startswith("Bearer ") and hmac.compare_digest(authorization[7:].encode(), self.settings.token.encode())
        if not bearer and not self.valid_session(request.cookies.get(COOKIE)):
            raise HTTPException(401, "authentication_required")
        if request.method not in ("GET", "HEAD", "OPTIONS") and not bearer:
            self.origin(request.headers.get("origin"))

    def rate_limit(self, key, limit=10, interval=60):
        current = time.monotonic()
        recent = [t for t in self.attempts.get(key, []) if current - t < interval]
        if len(recent) >= limit:
            raise HTTPException(429, "rate_limited")
        self.attempts[key] = recent + [current]
