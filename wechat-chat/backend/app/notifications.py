"""Opt-in Web Push. No message text, sender names or account IDs leave this PC."""
import asyncio
import base64
from contextlib import suppress
import json
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from .adapters.base import now
from .security import COOKIE


def subscription_data(endpoint, keys):
    try:
        url = urlsplit(endpoint)
        host = url.hostname or ""
        allowed = host in ("fcm.googleapis.com", "updates.push.services.mozilla.com") or bool(
            re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.push\.apple\.com", host)
            or re.fullmatch(r"[a-z0-9-]+\.notify\.windows\.com", host))
        if (not allowed or url.scheme != "https" or url.port not in (None, 443)
                or url.username or url.password or url.fragment or not url.path or len(endpoint) > 4096
                or any(ord(c) < 33 for c in endpoint)):
            raise ValueError()
        decoded = {}
        for name, size in (("p256dh", 65), ("auth", 16)):
            value = keys[name]
            if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
                raise ValueError()
            raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            if len(raw) != size:
                raise ValueError()
            decoded[name] = value
        from cryptography.hazmat.primitives.asymmetric import ec
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), base64.urlsafe_b64decode(decoded['p256dh'] + '=' * (-len(decoded['p256dh']) % 4)))
        return {"endpoint": endpoint, "keys": decoded}
    except Exception:
        raise ValueError("invalid_subscription") from None


class PushTransport:
    def __init__(self, settings):
        self.ready = False
        self.public_key = None
        self.subject = settings.mobile_url
        self.key_path = settings.push_key_path
        if not settings.push_enabled or not self.subject or not self.subject.startswith("https://"):
            return
        from py_vapid import Vapid
        from cryptography.hazmat.primitives import serialization
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.key_path.exists():
            key = Vapid()
            key.generate_keys()
            try:
                with self.key_path.open('xb') as stream:
                    stream.write(key.private_pem())
                if os.name != 'nt':
                    self.key_path.chmod(0o600)
            except FileExistsError:
                pass
        self.key = Vapid.from_file(str(self.key_path))
        encoded = self.key.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.public_key = base64.urlsafe_b64encode(encoded).decode().rstrip('=')
        self.ready = True

    async def send(self, row, payload):
        # Plain HTTP redirects must never send encrypted notifications or
        # authorization headers to an arbitrary endpoint supplied by a client.
        def deliver():
            import requests
            from pywebpush import webpush, WebPushException
            class NoRedirectSession(requests.Session):
                def post(self, url, **kwargs):
                    kwargs['allow_redirects'] = False
                    return super().post(url, **kwargs)
            subscription = subscription_data(row['endpoint'], {'auth': row['auth'], 'p256dh': row['p256dh']})
            try:
                with NoRedirectSession() as session:
                    session.trust_env = False
                    response = webpush(subscription, data=json.dumps(payload), vapid_private_key=self.key,
                        vapid_claims={'sub': self.subject}, timeout=8, ttl=120,
                        headers={'Urgency':'normal'}, requests_session=session)
                    return 'accepted' if response.status_code in (200, 201, 202) else 'failed'
            except WebPushException as exc:
                return 'expired' if exc.response is not None and exc.response.status_code in (404, 410) else 'failed'
            except Exception:
                return 'failed'  # Never include keys, endpoints or response text in logs.
        return await asyncio.to_thread(deliver)


class NotificationService:
    def __init__(self, db, settings, transport=None):
        self.db = db
        self.transport = transport or PushTransport(settings)
        self.enabled = settings.push_enabled and self.transport.ready
        self.task = None

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def close(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task

    def status(self):
        return {'enabled': self.enabled, 'public_key': self.transport.public_key if self.enabled else None,
            'payload': 'generic_notice_only', 'subscriptions': self.db.one('SELECT COUNT(*) AS n FROM push_subscriptions')['n']}

    def events(self, after=None):
        cursor = self.db.one('SELECT COALESCE(MAX(id),0) AS n FROM notification_events')['n']
        rows = [] if after is None else self.db.all(
            'SELECT id,chat_id,message_id,created_at FROM notification_events WHERE id>? ORDER BY id LIMIT 100', (after,))
        return {'cursor': rows[-1]['id'] if rows else cursor, 'events': rows}

    def register(self, endpoint, keys, origin, session_hash):
        if not self.enabled:
            raise ValueError('push_unavailable')
        sub = subscription_data(endpoint, keys)
        with self.db.lock, self.db.conn:
            existing = self.db.one('SELECT id FROM push_subscriptions WHERE endpoint=?', (endpoint,))
            if not existing and self.db.one('SELECT COUNT(*) AS n FROM push_subscriptions')['n'] >= 10:
                raise ValueError('push_device_limit')
            ident = existing['id'] if existing else str(uuid4())
            self.db.conn.execute('''INSERT INTO push_subscriptions(id,endpoint,p256dh,auth,origin,session_hash,created_at)
                VALUES(?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
                origin=excluded.origin,session_hash=excluded.session_hash,last_status='registered' ''',
                (ident, endpoint, sub['keys']['p256dh'], sub['keys']['auth'], origin, session_hash, now()))
        return {'id': ident, 'status':'registered'}

    def unsubscribe(self, endpoint=None, session_hash=None):
        with self.db.lock, self.db.conn:
            if endpoint:
                self.db.conn.execute('DELETE FROM push_subscriptions WHERE endpoint=?', (endpoint,))
            elif session_hash:
                self.db.conn.execute('DELETE FROM push_subscriptions WHERE session_hash=?', (session_hash,))

    async def dispatch(self):
        # Coalesce bursts into one notice per chat. Commit the attempt BEFORE
        # sending so restart/timeout cannot ring twice for the same event.
        with self.db.lock, self.db.conn:
            pending = self.db.all('''SELECT n.*,c.read_through_id FROM notification_events n
                JOIN chats c ON c.id=n.chat_id WHERE n.processed_at IS NULL ORDER BY n.id LIMIT 100''')
            self.db.conn.executemany('UPDATE notification_events SET processed_at=? WHERE id=?', [(now(), e['id']) for e in pending])
        if not self.enabled:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(timespec='milliseconds')
        latest = {e['chat_id']: e for e in pending if e['created_at'] >= cutoff and e['message_id'] > e['read_through_id']}
        for event in latest.values():
            payload = {'v':1, 'event_id':event['id'], 'chat_id':event['chat_id']}
            for row in self.db.all('SELECT * FROM push_subscriptions ORDER BY created_at'):
                # An unsubscribe may happen while another device is being sent.
                if not self.db.one('SELECT id FROM push_subscriptions WHERE id=?', (row['id'],)):
                    continue
                result = await self.transport.send(row, payload)
                with self.db.lock, self.db.conn:
                    if result == 'expired':
                        self.db.conn.execute('DELETE FROM push_subscriptions WHERE id=?', (row['id'],))
                    else:
                        self.db.conn.execute('UPDATE push_subscriptions SET last_status=? WHERE id=?', (result, row['id']))

    async def run(self):
        while True:
            await asyncio.sleep(2)
            try:
                await self.dispatch()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass  # Notification failure must not stop reading/sending chats.


class Subscribe(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)
    keys: dict[str, str]
    consent: bool = False


class Endpoint(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)


def register_notification_routes(api, app, security):
    @api.get('/notifications/status')
    async def status():
        return app.state.notifications.status()

    @api.get('/notifications/events')
    async def events(after: int | None = None):
        if after is not None and (after < 0 or after > 9223372036854775807):
            raise HTTPException(422, 'invalid_request')
        return app.state.notifications.events(after)

    @api.post('/notifications/subscribe')
    async def subscribe(body: Subscribe, request: Request):
        if not body.consent:
            raise HTTPException(400, 'notification_consent_required')
        origin = request.headers.get('origin')
        security.origin(origin)
        security.rate_limit('push-subscribe', 20)
        try:
            return app.state.notifications.register(body.endpoint, body.keys, origin,
                security.digest(request.cookies.get(COOKIE) or 'bearer'))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    @api.post('/notifications/unsubscribe')
    async def unsubscribe(body: Endpoint):
        app.state.notifications.unsubscribe(endpoint=body.endpoint)
        return {'ok':True}

    @api.post('/notifications/test')
    async def test(body: Endpoint, request: Request):
        security.rate_limit('push-test', 3)
        row = app.state.db.one('SELECT * FROM push_subscriptions WHERE endpoint=?', (body.endpoint,))
        if not row or not app.state.notifications.enabled:
            raise HTTPException(400, 'push_unavailable')
        result = await app.state.notifications.transport.send(row, {'v':1, 'test':True})
        return {'status':result}  # Acceptance by the push service is NOT device delivery.
