"""Narrow wxautox4 41.2.3 bridge. Loaded only by the optional licensed worker.

No credentials, activation, OCR, automatic replies, contact mutations
or forced name searches. UI details here require licensed real-device validation.
"""
from dataclasses import replace
from datetime import datetime, timezone
from importlib.metadata import version
import logging
from pathlib import Path
from queue import Empty, Queue
from tempfile import TemporaryDirectory

from .base import Message
from .plus_core import PlusFailure, digest
from ..media_store import KINDS, validate_attachment

MEDIA_LABELS = {"image": "[画像]", "file": "[ファイル]", "voice": "[ボイスメッセージ]", "video": "[動画]"}
# These Chinese-UI entries were observed to be navigation/feed containers,
# not a single friend/group destination. Conservatively skip same-named entries.
SYSTEM_SESSIONS = frozenset({"公众号", "服务号", "服务通知", "折叠的聊天"})


class PlusSDK:
    def __init__(self, language="cn", client_kind="微信"):
        if version("wxautox4") != "41.2.3":
            raise PlusFailure("dependency_missing")
        # 41.2.3 has a lazy package bootstrap. Set the documented privacy
        # setting BEFORE importing the compiled UI runtime/logger. Do not patch
        # or suppress license checks; the vendor's normal checks remain active.
        from wxautox4 import WxParam
        WxParam.ENABLE_FILE_LOGGER = False
        WxParam.LANGUAGE = language
        WxParam.LISTEN_INTERVAL = 3
        WxParam.LISTENER_EXCUTOR_WORKERS = 1
        WxParam.SEND_CONTENT_RATIO = 1.0
        logging.disable(logging.CRITICAL)
        from wxautox4 import WeChat, uia
        self.factory, self.uia = WeChat, uia
        uia.Logger.SetLogFile("")
        uia.SetGlobalSearchTimeout(1)
        self.wx = None
        self.events = Queue(maxsize=1000)
        self.overflow = False
        self.scope = None
        self.client_kind = client_kind

    def _main(self):
        from .windows_probe import process_inventory, file_version
        processes = dict(process_inventory())
        if not processes:
            raise PlusFailure("not_running")
        windows = [w for w in self.uia.GetRootControl().GetChildren() if w.ProcessId in processes]
        if any(w.ClassName == "mmui::LoginWindow" for w in windows):
            raise PlusFailure("login_required")
        mains = [w for w in windows if w.ClassName == "mmui::MainWindow"]
        if len(mains) != 1:
            raise PlusFailure("sdk_unavailable")
        return mains[0], file_version(processes[mains[0].ProcessId])

    def check_scope(self):
        from .wxauto4_worker import process_created
        main, _ = self._main()
        if self.wx is not None and not self.wx.IsOnline():
            raise PlusFailure("login_required")
        return digest([main.ProcessId, process_created(main.ProcessId), main.NativeWindowHandle, main.GetRuntimeId()])

    def connect(self):
        main, client_version = self._main()
        self.process_id = main.ProcessId
        self.main_hwnd = main.NativeWindowHandle
        self.scope = self.check_scope()
        self.wx = self.factory(resize=False, debug=False, start_listener=False, version=self.client_kind)
        account = self.account_id()
        if self.check_scope() != self.scope:
            raise PlusFailure("sdk_unavailable")
        return self.scope, account, client_version

    def account_id(self):
        info = self.wx.GetMyInfo()
        # Do not substitute nickname, phone, region or a guessed account ID.
        # 41.2.3 returns display_name / id / region. The id value was compared
        # with the owner's visible WeChat-ID profile label on the real client.
        account = info.get("id") if isinstance(info, dict) else None
        if not isinstance(account, str) or not account.strip():
            raise PlusFailure("account_unavailable")
        return account

    def sessions(self):
        names = [s.info.get("name") for s in self.wx.GetSession()]
        return [s for s in names if isinstance(s, str) and 0 < len(s) <= 500 and s not in SYSTEM_SESSIONS][:500]

    def history_sessions(self, reset=False):
        if self.check_scope() != self.scope:
            raise PlusFailure('not_running')
        if reset:
            self.wx.SwitchToChat()
        listing = self.wx.SessionBox.session_list
        if not listing.Exists(0):
            raise PlusFailure('binding_unavailable')
        if reset:
            # Navigation keys go to the observed list, never the message editor.
            listing.SendKeys('{Ctrl}{Home}', waitTime=0.5)
        else:
            listing.WheelDown(wheelTimes=3, interval=0.2, waitTime=0.5)
        sessions = []
        for session in self.wx.GetSession():
            name = session.info.get('name')
            if isinstance(name,str) and 0 < len(name) <= 500 and name not in SYSTEM_SESSIONS:
                sessions.append({'name':name,'identity':digest([self.scope,session.control.GetRuntimeId()])})
        if not sessions:
            raise PlusFailure('binding_unavailable')
        return sessions

    def history_page(self, name, reopen=False):
        if self.check_scope() != self.scope:
            raise PlusFailure('not_running')
        if reopen:
            # Read-only exact lookup of a name discovered in the session list.
            # Archive records NEVER become a send binding.
            self.wx.ChatWith(name, exact=True, force=False)
        info = self.wx.ChatInfo()
        kind = {'friend':'individual','group':'group'}.get(info.get('chat_type'))
        if info.get('chat_name') != name:
            raise ValueError('history_destination_changed')
        if kind is None:
            raise PlusFailure('unsupported_chat')
        rows = {}
        def capture(raw):
            if raw.type not in {'text', *KINDS} or raw.attr not in ('friend','self'):
                return
            key = getattr(raw, 'id', None)
            if not isinstance(key, str) or not 0 < len(key) <= 200:
                raise ValueError('history_identity_unavailable')
            content = raw.content if raw.type == 'text' else MEDIA_LABELS[raw.type]
            if not isinstance(content, str) or not 0 < len(content) <= 20000:
                raise ValueError('history_content_unavailable')
            stamp = None
            value = getattr(raw, 'time', None)
            if isinstance(value, str):
                try:
                    stamp = datetime.strptime(value, '%Y-%m-%d %H:%M:%S').astimezone(timezone.utc).isoformat(timespec='milliseconds')
                except ValueError:
                    pass
            row = dict(key=key, content=content, kind=raw.type, sender=raw.sender if isinstance(raw.sender,str) else '',
                       direction='outgoing' if raw.attr=='self' else 'incoming',timestamp=stamp)
            if key in rows and rows[key] != row:
                raise ValueError('history_identity_conflict')
            rows[key] = row
            if len(rows) > 500:
                raise ValueError('history_page_limit')
        # The SDK raises TimeoutError even after delivering valid callbacks.
        # Keep that bounded page; a timeout is never an end-of-history proof.
        try:
            result = self.wx.GetHistoryMessage(n=200, callback=capture, interval=0.5, speed=1, goback=False, timeout=10)
            for raw in result or []:
                capture(raw)
        except TimeoutError:
            pass
        after = self.wx.ChatInfo()
        if self.check_scope() != self.scope or (after.get('chat_name'),after.get('chat_type')) != (name,info.get('chat_type')):
            raise ValueError('history_destination_changed')
        return {'type':kind,'rows':list(rows.values())}

    @staticmethod
    def history_messages(page, ident):
        result = []
        for row in page['rows']:
            source = 'plus-history:' + digest([ident,row['key']])
            attachment = {'id':digest(['media',source])[:32], 'kind':row['kind'], 'status':'unavailable',
                          'error_code':'source_unavailable'} if row['kind'] in KINDS else None
            result.append(Message(ident,row['content'],'unavailable',row['sender'],row['direction'],row['timestamp'],
                occurrence=source,source_key=source,timestamp_quality='sdk_display' if row['timestamp'] else 'unavailable',
                identity_quality='sdk_observation',delivery_status='received' if row['direction']=='incoming' else 'unknown',
                message_type=row['kind'],attachment=attachment,historical=True))
        return result

    def _window(self, name):
        # Require one independent conversation window owned by this WeChat
        # process. In 4.1.8.107 the child input is labelled "输入", NOT the
        # recipient. Match the separate visible conversation header instead.
        candidates = []
        for control in self.uia.GetRootControl().GetChildren():
            if (control.ProcessId != self.process_id or control.NativeWindowHandle == self.main_hwnd
                    or control.ClassName != "mmui::ChatSingleWindow" or control.Name != name):
                continue
            edit = control.EditControl(AutomationId="chat_input_field", searchDepth=40)
            listing = control.ListControl(AutomationId="chat_message_list", searchDepth=40)
            header = control.TextControl(AutomationId="content_view.top_content_view.title_h_view.left_v_view.left_content_v_view.left_ui_.big_title_line_h_view.current_chat_name_label", searchDepth=40)
            if edit.Exists(0) and listing.Exists(0) and header.Exists(0) and header.Name == name:
                candidates.append((control, edit))
        if len(candidates) != 1:
            raise PlusFailure("binding_unavailable")
        return candidates[0]

    def listen(self, name):
        if self.sessions().count(name) != 1:
            raise PlusFailure("binding_unavailable")
        result = self.wx.AddListenChat(nickname=name, callback=self._callback)
        # The docs and .pyi disagree: accept Chat only, otherwise explicitly
        # retrieve and validate the resulting child. Never infer from truthiness.
        chat = result if callable(getattr(result, "ChatInfo", None)) else self.wx.GetSubWindow(nickname=name)
        info = chat.ChatInfo()
        kind = {"friend": "individual", "group": "group"}.get(info.get("chat_type"))
        if info.get("chat_name") != name:
            raise ValueError("destination_mismatch")
        if not kind:
            result = self.wx.RemoveListenChat(nickname=name, close_window=False)
            if not isinstance(result, dict) or result.get("status") != "成功":
                raise PlusFailure("binding_unavailable")
            raise PlusFailure("unsupported_chat")
        control, _ = self._window(name)
        binding = digest([self.scope, control.NativeWindowHandle, control.GetRuntimeId()])
        target = {"name": name, "type": kind, "binding": binding, "chat": chat,
                  "member_count": info.get("group_member_count"), "control": control}
        self.wx.StartListening()
        return target

    def _record(self, msg):
        if msg.type not in {"text", *KINDS} or msg.attr not in ("friend", "self"):
            return None
        # Media has a type label, not invented message text. In particular,
        # WeChat's voice transcription can change msg.content after reading.
        content = msg.content if msg.type == "text" else MEDIA_LABELS[msg.type]
        if not isinstance(content, str) or not 0 < len(content) <= 20000:
            raise PlusFailure("sdk_unavailable")
        control = msg.control
        root = control.GetTopLevelControl()
        return {"binding": digest([self.scope, root.NativeWindowHandle, root.GetRuntimeId()]),
                "runtime": control.GetRuntimeId(), "content": content, "message_type": msg.type,
                "sender": msg.sender if isinstance(msg.sender, str) else "",
                "direction": "outgoing" if msg.attr == "self" else "incoming"}

    def _callback(self, msg, chat):
        try:
            # Normalize in the SDK callback's COM thread. No UI/COM objects
            # cross into our command thread, and no logging of raw messages.
            record = self._record(msg)
            if record:
                self.events.put_nowait(record)
        except Exception:
            self.overflow = True

    @staticmethod
    def _message(record, target):
        if record["binding"] != target["binding"]:
            raise PlusFailure("sdk_unavailable")
        kind = record.get("message_type", "text")
        # Preserve the exact identity calculation used by existing text rows.
        source = "plus:" + digest([target["id"], record["runtime"], record["content"], record["direction"], record["sender"]])
        attachment = {"id": digest(["media", source])[:32], "kind": kind, "status": "pending"} if kind in KINDS else None
        return Message(target["id"], record["content"], "unavailable", record["sender"], record["direction"], None,
                       occurrence=source, timestamp_quality="unavailable", source_key=source,
                       identity_quality="uia_runtime", delivery_status="unknown" if record["direction"] == "outgoing" else "received",
                       message_type=kind, attachment=attachment)

    def fetch_attachment(self, target, source_key, vault):
        self.verify(target)
        matches = []
        for raw in target["chat"].GetAllMessage():
            record = self._record(raw)
            if record is not None:
                message = self._message(record, target)
                if message.source_key == source_key and message.attachment:
                    matches.append((raw, message))
        if len(matches) != 1:
            raise ValueError("source_unavailable")
        raw, message = matches[0]
        attachment = dict(message.attachment)
        try:
            self.verify(target)
            if message.message_type == "voice":
                transcript = raw.to_text()
                if not isinstance(transcript, str) or not 0 < len(transcript.strip()) <= 20000:
                    raise ValueError("transcription_unavailable")
                attachment.update(status="ready", transcript=transcript.strip(), error_code="voice_audio_unavailable")
            else:
                with TemporaryDirectory(prefix=".download-", dir=vault.root) as directory:
                    if message.message_type == "file":
                        result = raw.download(dir_path=directory, force_click=False, timeout=20)
                    elif message.message_type == "video":
                        result = raw.download(dir_path=directory, original=True, timeout=20)
                    else:
                        result = raw.download(dir_path=directory, original=True)
                    if not isinstance(result, (str, Path)):
                        raise ValueError("download_failed")
                    attachment.update(vault.import_file(Path(result), Path(directory)), status="ready")
        except Exception as exc:
            too_large = isinstance(exc, ValueError) and str(exc) == "too_large"
            attachment = dict(message.attachment, status="too_large" if too_large else "failed",
                              error_code="too_large" if too_large else "transcription_unavailable" if message.message_type == "voice" else "download_failed")
        # A window/account change must not attach bytes to a different target.
        self.verify(target)
        return replace(message, attachment=validate_attachment(attachment))

    def history(self, target):
        rows = target["chat"].GetAllMessage()
        if len(rows) > 500:
            raise PlusFailure("buffer_full")
        return [self._message(record, target) for m in rows if (record := self._record(m)) is not None]

    def drain(self, targets):
        if self.overflow:
            raise PlusFailure("buffer_full")
        bindings = {t["binding"]: t for t in targets.values()}
        rows = []
        while True:
            try:
                record = self.events.get_nowait()
            except Empty:
                break
            target = bindings.get(record["binding"])
            if target is None:
                raise PlusFailure("sdk_unavailable")
            rows.append(replace(self._message(record, target), live_event=True))
        return rows

    def verify(self, target):
        if self.check_scope() != self.scope:
            raise PlusFailure("not_running")
        info = target["chat"].ChatInfo()
        kind = {"friend": "individual", "group": "group"}.get(info.get("chat_type"))
        if (info.get("chat_name"), kind) != (target["name"], target["type"]):
            raise ValueError("destination_mismatch")
        control, edit = self._window(target["name"])
        if digest([self.scope, control.NativeWindowHandle, control.GetRuntimeId()]) != target["binding"]:
            raise ValueError("destination_mismatch")
        # Unsupported ValuePattern means "cannot verify", not "empty draft".
        if edit.GetValuePattern().Value != "":
            raise ValueError("draft_not_empty")

    def send_once(self, target, text):
        self.verify(target)
        # Child Chat only, no main-window SendMsg(who=...) retry behavior.
        # This is the single SDK sending call in the entire integration.
        result = target["chat"].SendMsg(text, clear=False)
        return isinstance(result, dict) and result.get("status") == "成功"

    def close(self):
        if self.wx is not None:
            # remove=True also closes child windows, including ones the owner
            # already had open. Stop callbacks without closing those windows.
            self.wx.StopListening(remove=False)
