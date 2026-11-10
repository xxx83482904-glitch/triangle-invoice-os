import hashlib
import json
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.adapters.base import Chat, Message
from app.adapters.plus_core import PlusStore
from app.adapters.plus_history import PlusHistory
from app.adapters.plus_sdk import PlusSDK
from app.backup_inspector import inspect_backup
from app.config import Settings
from app.database import Database
from app.main import create_app


def row(key='one',content='合成の本文',stamp='2024-01-01T00:00:00.000+00:00'):
    return dict(key=key,content=content,kind='text',sender='合成の送信者',direction='incoming',timestamp=stamp)


class SDK:
    history_messages=staticmethod(PlusSDK.history_messages)
    def __init__(self,n=14):
        self.names=[f'合成会話{i}' for i in range(n)]
        self.opened=[]
        self.rows=[row()]
    def history_sessions(self,reset=False): return [{'name':name,'identity':name} for name in self.names]
    def history_page(self,name,reopen=False):
        self.opened.append(name)
        return {'type':'group' if name.endswith('1') else 'individual','rows':self.rows}


def walk(history,sdk,steps=100):
    for _ in range(steps):
        history.step(sdk,'scope','account')
        if history.status()['state']!='running':break


def test_more_than_listener_limit_all_discovered_candidates_are_processed(tmp_path):
    store=PlusStore(tmp_path/'worker.db');history=PlusHistory(store);sdk=SDK()
    history.command('start','scope','account');walk(history,sdk)
    status=history.status()
    assert status['state']=='partial' and status['complete'] is False
    assert status['discovered']==status['processed']==status['saved']==14
    assert len(set(sdk.opened))==14
    assert len(store.chats())==len(store.inbox())==14
    assert all(e['message']['historical'] and not e['message']['live_event'] for e in store.inbox())
    # Repeating a complete traversal doesn't replay historical messages.
    store.ack([e['sequence'] for e in store.inbox()])
    history.command('start','scope','account');walk(history,sdk)
    assert history.status()['saved']==0 and not store.inbox()
    store.close()


def test_pause_restart_resume_and_new_scope_requires_new_traversal(tmp_path):
    path=tmp_path/'worker.db';store=PlusStore(path);history=PlusHistory(store);sdk=SDK(1)
    history.command('start','scope','account')
    for _ in range(4):history.step(sdk,'scope','account')
    assert history.status()['saved']==1
    store.close();store=PlusStore(path);history=PlusHistory(store)
    assert history.status()['state']=='paused' and history.status()['error']=='interrupted'
    assert len(store.inbox())==1
    with pytest.raises(ValueError,match='history_scope_changed'):history.command('resume','new','account')
    history.command('resume','scope','account');walk(history,sdk)
    assert history.status()['saved']==1
    history.command('start','scope','account');history.command('pause','scope','account')
    history.step(sdk,'scope','account');assert history.status()['state']=='paused'
    history.command('resume','scope','account');history.step(sdk,'other','account')
    assert history.status()['state']=='paused' and history.status()['error']=='history_scope_changed'
    store.close()


def test_ambiguous_names_are_not_read(tmp_path):
    store=PlusStore(tmp_path/'worker.db');history=PlusHistory(store);sdk=SDK()
    sdk.names=['same','same','unique'];history.command('start','scope','account');walk(history,sdk)
    assert history.status()['ambiguous']==1
    assert set(sdk.opened)=={'unique'}
    store.close()


def test_duplicate_name_on_separate_pages_with_different_ui_identity_is_ambiguous(tmp_path):
    store=PlusStore(tmp_path/'worker.db');history=PlusHistory(store);sdk=SDK(1)
    pages=iter([[{'name':'same','identity':'a'}],[{'name':'same','identity':'b'}],[{'name':'same','identity':'b'}]])
    sdk.history_sessions=lambda **kw:next(pages)
    history.command('start','scope','account')
    for _ in range(3):history.step(sdk,'scope','account')
    assert history.status()['ambiguous']==1 and not sdk.opened
    store.close()


def test_collision_rolls_back_entire_page_and_does_not_corrupt_seen_checkpoint(tmp_path):
    store=PlusStore(tmp_path/'worker.db');history=PlusHistory(store);sdk=SDK(1)
    history.command('start','scope','account')
    for _ in range(4):history.step(sdk,'scope','account')
    sdk.rows=[row('new'),row(content='同じ観測IDの異なる本文')]
    history.step(sdk,'scope','account')
    assert history.status()['failed']==1
    assert len(store.inbox())==1
    assert store.db.execute('SELECT COUNT(*) FROM history_seen').fetchone()[0]==1
    store.close()


def test_history_ingestion_chronology_pagination_dedup_no_unread_or_notification(tmp_path):
    db=Database(tmp_path/'db.sqlite3','mock');ident=db.upsert_chat(Chat('archive','合成','individual'))
    recent=Message('archive','new','id','sender','incoming','2026-01-01T00:00:00.000+00:00',source_key='new',live_event=True)
    old=replace(recent,content='old',source_key='old',timestamp='2020-01-01T00:00:00.000+00:00',historical=True)
    db.ingest(recent);db.ingest(old);db.ingest(old)
    assert db.chat(ident)['unread_count']==1
    assert db.one('SELECT COUNT(*) n FROM notification_events')['n']==1
    messages=db.messages(ident,limit=1);assert messages[0]['content']=='new'
    assert db.messages(ident,through=messages[0]['id'],limit=1)[0]['content']=='new'
    assert db.messages(ident,before=messages[0]['id'],limit=1)[0]['content']=='old'
    assert db.chats()[0]['last_message']=='new'
    db.mark_read(ident,messages[0]['id']);assert db.chat(ident)['unread_count']==0
    db.close()


def test_sdk_timeout_retains_valid_callback_page_without_claiming_end():
    sdk=PlusSDK.__new__(PlusSDK);sdk.scope='scope';sdk.check_scope=lambda:'scope'
    raw=SimpleNamespace(id='observation',content='合成',type='text',attr='friend',sender='sender',time='2024-01-01 12:00:00')
    calls=[]
    def history(**kw):
        calls.append(kw)
        kw['callback'](raw)
        raise TimeoutError()
    sdk.wx=SimpleNamespace(ChatInfo=lambda:{'chat_name':'name','chat_type':'friend'},GetHistoryMessage=history)
    page=sdk.history_page('name')
    assert len(page['rows'])==1 and calls[0]['timeout']==10 and calls[0]['goback'] is False
    message=sdk.history_messages(page,'wxautox4:local:history:synthetic')[0]
    assert message.historical and not message.live_event and message.identity_quality=='sdk_observation'
    assert message.external_message_id is None


def test_sdk_rechecks_destination_after_history_before_accepting_rows():
    sdk=PlusSDK.__new__(PlusSDK);sdk.scope='scope';sdk.check_scope=lambda:'scope'
    infos=iter([{'chat_name':'name','chat_type':'friend'},{'chat_name':'different','chat_type':'friend'}])
    sdk.wx=SimpleNamespace(ChatInfo=lambda:next(infos),GetHistoryMessage=lambda **kw:[])
    with pytest.raises(ValueError,match='history_destination_changed'):sdk.history_page('name')


def test_discovery_switches_tab_only_once_and_keeps_scrolling_current_list():
    sdk=PlusSDK.__new__(PlusSDK);sdk.scope='scope';sdk.check_scope=lambda:'scope'
    actions=[]
    listing=SimpleNamespace(Exists=lambda _:True,SendKeys=lambda *a,**k:actions.append('top'),WheelDown=lambda **k:actions.append('down'))
    session=SimpleNamespace(info={'name':'synthetic'},control=SimpleNamespace(GetRuntimeId=lambda:[1,2]))
    sdk.wx=SimpleNamespace(SwitchToChat=lambda:actions.append('switch'),SessionBox=SimpleNamespace(session_list=listing),GetSession=lambda:[session])
    first=sdk.history_sessions(reset=True)
    second=sdk.history_sessions()
    assert actions==['switch','top','down'] and first==second


def native_backup(root):
    root.mkdir();(root/'backup.attr').write_bytes(b'RMFH'+bytes(254))
    directory=root/'files'/'1'/'synthetic'/'ChatPackage';directory.mkdir(parents=True)
    (directory/'111-222').write_bytes(b'RMFH'+bytes(1024))
    return directory


def test_real_layout_inspection_never_imports_guessed_messages_or_changes_original(tmp_path):
    root=tmp_path/'backup';native_backup(root)
    before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
    report=inspect_backup(root)
    after={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
    assert before==after
    assert report['session_candidates']==1 and report['header_counts']['rmfh']==2
    assert report['inventory_complete'] is True and report['complete'] is False and report['imported_messages']==0
    assert str(root) not in json.dumps(report) and 'synthetic' not in json.dumps(report)


def test_backup_file_limit_and_wrong_directory_do_not_claim_complete(tmp_path):
    root=tmp_path/'backup';native_backup(root)
    assert inspect_backup(root,max_files=1)['inventory_complete'] is False
    with pytest.raises(ValueError,match='unsupported_backup_layout'):inspect_backup(tmp_path)


def test_history_api_is_authenticated_csrf_protected_and_separates_mock(tmp_path):
    settings=Settings(db_path=tmp_path/'db.sqlite3',token='x'*40,hosts=('testserver',),origins=('http://testserver',))
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/history').status_code==401
        assert client.post('/api/history',json={'action':'start'}).status_code in (401,403)
        assert client.post('/api/auth/login',headers={'Origin':'http://testserver'},json={'token':'x'*40}).status_code==200
        assert client.get('/api/history').json()=={'supported':False,'sync':None,'backup':None}
        assert client.post('/api/history',headers={'Origin':'http://testserver'},json={'action':'start'}).status_code==409
        assert client.post('/api/history',headers={'Origin':'https://evil.example'},json={'action':'start'}).status_code==403
