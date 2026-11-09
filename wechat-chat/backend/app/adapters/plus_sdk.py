"""Narrow wxautox4 41.2.3 bridge. Loaded only by the optional licensed worker.

No credentials, activation, OCR, downloads, automatic replies, contact mutations
or forced name searches. UI details here require licensed real-device validation.
"""
from importlib.metadata import version
import logging
from queue import Empty, Queue

from .base import Message
from .plus_core import PlusFailure, digest


class PlusSDK:
    def __init__(self, language="en"):
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
        self.wx = self.factory(resize=False, debug=False, start_listener=False, version="WeChat")
        account = self.account_id()
        if self.check_scope() != self.scope:
            raise PlusFailure("sdk_unavailable")
        return self.scope, account, client_version

    def account_id(self):
        info = self.wx.GetMyInfo()
        # Do not substitute nickname, phone, region or a guessed account ID.
        account = info.get("wxid") if isinstance(info, dict) else None
        if not isinstance(account, str) or not account.strip():
            raise PlusFailure("account_unavailable")
        return account

    def sessions(self):
        names = [s.info.get("name") for s in self.wx.GetSession()]
        return [s for s in names if isinstance(s, str) and 0 < len(s) <= 500][:500]

    def _window(self, name):
        # Require one independent conversation window owned by this WeChat
        # process. A title match alone is insufficient: input + message list
        # must also be present and the input's recipient label must match.
        candidates = []
        for control in self.uia.GetRootControl().GetChildren():
            if control.ProcessId != self.process_id or control.NativeWindowHandle == self.main_hwnd or control.Name != name:
                continue
            edit = control.EditControl(AutomationId="chat_input_field", searchDepth=40)
            listing = control.ListControl(AutomationId="chat_message_list", searchDepth=40)
            if edit.Exists(0) and listing.Exists(0) and edit.Name == name:
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
        if info.get("chat_name") != name or not kind:
            raise ValueError("unsupported_chat")
        control, _ = self._window(name)
        binding = digest([self.scope, control.NativeWindowHandle, control.GetRuntimeId()])
        target = {"name": name, "type": kind, "binding": binding, "chat": chat,
                  "member_count": info.get("group_member_count"), "control": control}
        self.wx.StartListening()
        return target

    def _record(self, msg):
        if msg.type != "text" or msg.attr not in ("friend", "self"):
            return None
        if not isinstance(msg.content, str) or not 0 < len(msg.content) <= 20000:
            raise PlusFailure("sdk_unavailable")
        control = msg.control
        root = control.GetTopLevelControl()
        return {"binding": digest([self.scope, root.NativeWindowHandle, root.GetRuntimeId()]),
                "runtime": control.GetRuntimeId(), "content": msg.content,
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
        source = "plus:" + digest([target["id"], record["runtime"], record["content"], record["direction"], record["sender"]])
        return Message(target["id"], record["content"], "unavailable", record["sender"], record["direction"], None,
                       occurrence=source, timestamp_quality="unavailable", source_key=source,
                       identity_quality="uia_runtime", delivery_status="unknown" if record["direction"] == "outgoing" else "received")

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
            rows.append(self._message(record, target))
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
            self.wx.StopListening(remove=True)
        # Do not close existing windows or touch WeChat authentication.
