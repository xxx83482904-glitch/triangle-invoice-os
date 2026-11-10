import asyncio
import base64
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi.testclient import TestClient

from app.adapters.base import Chat, Message, now
from app.config import Settings
from app.database import Database
from app.main import create_app
from app.notifications import NotificationService, PushTransport, subscription_data
from app.adapters.plus_core import PlusStore

TOKEN = 'notification-test-' + 'x' * 40
ORIGIN = 'http://127.0.0.1:8765'


def subscription():
    def encode(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')
    key = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return {'endpoint':'https://web.push.apple.com/synthetic-device', 'keys':{'p256dh':encode(key), 'auth':encode(b'x' * 16)}}


class FakePush:
    ready, public_key = True, 'synthetic-public-key'
    def __init__(self):
        self.sent = []
        self.result = 'accepted'
    async def send(self, row, payload):
        self.sent.append((row['id'], payload))
        return self.result


@pytest.fixture
def service(tmp_path):
    settings = Settings(db_path=tmp_path/'db.sqlite3', token=TOKEN, push_enabled=True)
    db, transport = Database(settings.db_path, 'mock'), FakePush()
    db.upsert_chat(Chat('synthetic-chat', 'PRIVATE NAME', 'individual'))
    service = NotificationService(db, settings, transport)
    yield service, db, transport
    db.close()


def incoming(key='one', **kwargs):
    return Message('synthetic-chat', 'PRIVATE MESSAGE', 'private-id', 'PRIVATE NAME', 'incoming', now(),
        external_message_id=key, live_event=True, **kwargs)


def test_history_outgoing_media_updates_duplicates_never_notify(service):
    service, db, push = service
    sub = subscription()
    service.register(sub['endpoint'], sub['keys'], ORIGIN, 'session')
    history = replace(incoming('history'), live_event=False)
    assert db.ingest(history)
    assert not db.ingest(replace(history, live_event=True))
    assert db.ingest(replace(incoming('outgoing'), direction='outgoing'))
    baseline = service.events()['cursor']
    assert baseline == 0
    message = incoming()
    assert db.ingest(message)
    assert not db.ingest(message)
    events = service.events(baseline)['events']
    assert len(events) == 1
    assert set(events[0]) == {'id','chat_id','message_id','created_at'}
    asyncio.run(service.dispatch())
    asyncio.run(service.dispatch())
    assert len(push.sent) == 1
    assert set(push.sent[0][1]) == {'v','event_id','chat_id'}
    assert 'PRIVATE' not in json.dumps(push.sent)


def test_received_event_commits_with_message_and_survives_restart(service, tmp_path):
    service, db, push = service
    db.ingest(incoming())
    reopened = Database(tmp_path/'db.sqlite3', 'mock')
    try:
        assert reopened.one('SELECT COUNT(*) AS n FROM notification_events')['n'] == 1
        assert reopened.one('PRAGMA integrity_check')['integrity_check'] == 'ok'
    finally: reopened.close()


def test_read_or_stale_events_do_not_push_and_bursts_coalesce(service):
    service, db, push = service
    sub = subscription(); service.register(sub['endpoint'], sub['keys'], ORIGIN, 'session')
    db.ingest(incoming('read'))
    with db.conn:
        db.conn.execute('UPDATE chats SET read_through_id=(SELECT MAX(id) FROM messages)')
    asyncio.run(service.dispatch()); assert not push.sent
    db.ingest(incoming('stale'))
    with db.conn: db.conn.execute("UPDATE notification_events SET created_at='2000-01-01T00:00:00+00:00'")
    asyncio.run(service.dispatch()); assert not push.sent
    db.ingest(incoming('burst-one')); db.ingest(incoming('burst-two'))
    asyncio.run(service.dispatch()); assert len(push.sent) == 1


@pytest.mark.parametrize('outcome', ['failed','expired'])
def test_push_failure_never_retries_a_notification_and_expiry_removes_device(service, outcome):
    service, db, push = service
    sub = subscription(); service.register(sub['endpoint'], sub['keys'], ORIGIN, 'session')
    db.ingest(incoming()); push.result = outcome
    asyncio.run(service.dispatch()); asyncio.run(service.dispatch())
    assert len(push.sent) == 1
    assert service.status()['subscriptions'] == (0 if outcome == 'expired' else 1)


@pytest.mark.parametrize('url', [
    'http://web.push.apple.com/x', 'https://127.0.0.1/x', 'https://localhost/x',
    'https://web.push.apple.com.evil.test/x', 'https://evil.test/x', 'https://web.push.apple.com:444/x',
    'https://user:secret@web.push.apple.com/x', 'https://web.push.apple.com/x#fragment',
    'https://web.push.apple.com/x\n', 'https://fcm.googleapis.com@127.0.0.1/x',
])
def test_push_url_ssrf_is_rejected(url):
    with pytest.raises(ValueError, match='invalid_subscription'):
        subscription_data(url, subscription()['keys'])


def test_subscription_key_validation():
    sub = subscription(); sub['keys']['p256dh'] = base64.urlsafe_b64encode(b'x' * 65).decode()
    with pytest.raises(ValueError, match='invalid_subscription'): subscription_data(**sub)


def test_only_callback_origin_can_change_without_corrupting_inbox(tmp_path):
    store = PlusStore(tmp_path/'worker.sqlite3')
    message = replace(incoming(), source_key='plus:synthetic', live_event=False)
    store.ingest(message)
    store.ingest(replace(message, live_event=True))
    assert len(store.inbox()) == 1
    store.close()


def test_authenticated_subscription_optin_revocation_and_no_secrets_returned(tmp_path):
    settings = Settings(db_path=tmp_path/'db.sqlite3', token=TOKEN, push_enabled=True)
    transport = FakePush()
    with TestClient(create_app(settings, push_transport=transport), base_url=ORIGIN, headers={'Origin':ORIGIN}) as c:
        assert c.get('/api/notifications/status').status_code == 401
        assert c.get('/api/notifications/events').status_code == 401
        c.post('/api/auth/login', json={'token':TOKEN})
        sub = subscription()
        assert c.post('/api/notifications/subscribe', json=sub).status_code == 400
        assert c.post('/api/notifications/subscribe', headers={'Origin':'https://evil.test'}, json={**sub,'consent':True}).status_code == 403
        response = c.post('/api/notifications/subscribe', json={**sub,'consent':True})
        assert response.status_code == 200 and set(response.json()) == {'id','status'}
        assert c.get('/api/notifications/status').json()['subscriptions'] == 1
        assert c.post('/api/notifications/test', json={'endpoint':sub['endpoint']}).json() == {'status':'accepted'}
        assert transport.sent[0][1] == {'v':1,'test':True}
        assert c.post('/api/auth/logout', json={}).status_code == 200
        c.post('/api/auth/login', json={'token':TOKEN})
        assert c.get('/api/notifications/status').json()['subscriptions'] == 0
        assert c.post('/api/notifications/test', json={'endpoint':sub['endpoint']}).status_code == 400


def test_vapid_stays_private_and_stable_and_redirects_are_disabled(tmp_path, monkeypatch):
    settings = Settings(db_path=tmp_path/'db.sqlite3', token=TOKEN, push_enabled=True,
        mobile_url='https://phone.example.test', push_key_path=tmp_path/'private.pem')
    transport = PushTransport(settings)
    assert transport.ready
    assert PushTransport(settings).public_key == transport.public_key
    assert 'PRIVATE KEY' in settings.push_key_path.read_text()
    captured = {}
    import pywebpush, requests
    def post(self, url, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(status_code=302)
    monkeypatch.setattr(requests.Session, 'post', post)
    def webpush(subscription, **kwargs):
        assert kwargs['timeout'] == 8 and kwargs['ttl'] == 120
        assert kwargs['vapid_private_key'] is transport.key
        return kwargs['requests_session'].post(subscription['endpoint'], data=b'encrypted')
    monkeypatch.setattr(pywebpush, 'webpush', webpush)
    sub = subscription()
    result = asyncio.run(transport.send({'endpoint':sub['endpoint'], **sub['keys']}, {'v':1, 'test':True}))
    assert result == 'failed' and captured['allow_redirects'] is False
