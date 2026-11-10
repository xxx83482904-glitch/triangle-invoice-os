from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.adapters.base import Chat, Message
from app.config import Settings
from app.database import Database
from app.main import create_app


@pytest.mark.parametrize('mode', ['windows-uia','windows-ocr','wxauto4','wxautox4'])
def test_disabled_ui_preserves_real_database_and_blocks_every_capture_route(tmp_path, monkeypatch, mode):
    def forbidden(*args, **kwargs):
        pytest.fail('A UI adapter was constructed while access was disabled')
    for name in ('WindowsUIAAdapter','WindowsOCRAdapter','WindowsWxauto4Adapter','WindowsPlusAdapter'):
        # Keep classes usable by isinstance while forbidding construction.
        cls=getattr(__import__('app.main',fromlist=[name]),name)
        monkeypatch.setattr(cls,'__init__',forbidden)
    settings=Settings(db_path=tmp_path/'source.sqlite3',token='x'*40,adapter=mode,
        ui_access_enabled=False,hosts=('testserver',),origins=('http://testserver',))
    db=Database(settings.db_path,mode)
    chat_id=db.upsert_chat(Chat('synthetic-source','保存会話','individual'))
    db.ingest(Message('synthetic-source','保存済み本文','synthetic','送信者','incoming','2025-01-01T00:00:00+00:00'))
    queue=db.enqueue(db.chat(chat_id),'未送信の下書き',str(uuid4()),'synthetic-source','保存会話')
    db.close()
    headers={'Authorization':'Bearer '+settings.token,'Origin':'http://testserver'}
    # The setting survives an application restart, and the original DB mode is
    # preserved instead of switching the owner to an empty Mock database.
    for _ in range(2):
        with TestClient(create_app(settings),headers=headers) as client:
            status=client.get('/api/status').json()
            assert status['mode']==mode and not status['can_read'] and not status['can_send']
            assert '画面経由' in status['detail']
            chats=client.get('/api/chats').json()
            assert len(chats)==1 and chats[0]['id']==chat_id
            messages=client.get(f'/api/chats/{chat_id}/messages').json()['messages']
            assert [(m['content'],m['delivery_status']) for m in messages]==[
                ('保存済み本文','received'),('未送信の下書き','pending')]
            assert client.post('/api/sync',json={}).status_code==200
            history=client.get('/api/history').json()
            assert not history['supported'] and history['reason']=='ui_access_disabled'
            for path,body in [('/history',{'action':'resume'}),('/wechat/diagnostics',{}),('/wechat/ocr/preview',{})]:
                response=client.post('/api'+path,json=body)
                assert response.status_code==409 and response.json()['detail']=='ui_access_disabled'
            response=client.post(f'/api/chats/{chat_id}/send',json={'content':'送らない',
                'client_request_id':str(uuid4()),'expected_external_id':'synthetic-source','expected_name':'保存会話'})
            assert response.status_code==409
            rows=client.get('/api/queue').json()
            assert len(rows)==1 and rows[0]['id']==queue['id'] and rows[0]['status']=='pending'


def test_ui_access_setting_is_loaded_without_changing_source_database(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config,'ROOT',tmp_path)
    for key,value in {'WECHAT_UI_ACCESS_ENABLED':'false','WECHAT_ADAPTER':'wxautox4',
        'WECHAT_ACCESS_TOKEN':'x'*40,'WECHAT_DB_PATH':'data/wxautox4.sqlite3'}.items():
        monkeypatch.setenv(key,value)
    settings=Settings.from_env()
    assert not settings.ui_access_enabled and settings.adapter=='wxautox4'
    assert settings.db_path==tmp_path/'data/wxautox4.sqlite3'
