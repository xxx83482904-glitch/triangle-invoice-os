"""Private IPC worker for wxauto4 41.1.7 / English Weixin 4.1.8.107.

Stdout is a private pipe to the backend, not a diagnostic log. Libraries' output
and raw exceptions are discarded. There is no send/navigation command protocol.
"""
import contextlib
import ctypes
from ctypes import wintypes
import importlib.util
import io
import json
from pathlib import Path
import sys

from .wxauto4_data import MAX_BYTES, digest, observation_key, validate_snapshot

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / ".runtime/wxauto4-reader.json"


class ReaderFailure(Exception):
    pass


def load_cache():
    if not CACHE.exists():
        return {"scope": None, "invalidated": False, "records": {}}
    with CACHE.open("rb") as stream:
        content = stream.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ReaderFailure("reader_failed")
    value = json.loads(content)
    if not isinstance(value, dict) or not isinstance(value.get("records"), dict) or len(value["records"]) > 256:
        raise ReaderFailure("reader_failed")
    return value


def save_cache(value):
    while len(value["records"]) > 256:
        value["records"].pop(next(iter(value["records"])))
    content = json.dumps(value, ensure_ascii=False).encode()
    while len(content) > MAX_BYTES and value["records"]:
        value["records"].pop(next(iter(value["records"])))
        content = json.dumps(value, ensure_ascii=False).encode()
    CACHE.parent.mkdir(exist_ok=True)
    temporary = CACHE.with_suffix(".tmp")
    temporary.write_bytes(content)
    temporary.replace(CACHE)


def process_created(pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ReaderFailure("reader_failed")
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            raise ReaderFailure("reader_failed")
        return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
    finally:
        kernel.CloseHandle(handle)


def idle_seconds():
    class LastInput(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]
    data = LastInput()
    data.cbSize = ctypes.sizeof(data)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(data)):
        return 0
    return ((ctypes.windll.kernel32.GetTickCount() - data.dwTime) & 0xFFFFFFFF) / 1000


@contextlib.contextmanager
def reader_mutex():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.ReleaseMutex.argtypes = kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateMutexW(None, False, "Local\\KomorebiWxauto4Reader")
    acquired = False
    try:
        if not handle or kernel.WaitForSingleObject(handle, 0) not in (0, 0x80):
            raise ReaderFailure("reader_busy")
        acquired = True
        yield
    finally:
        if acquired:
            kernel.ReleaseMutex(handle)
        if handle:
            kernel.CloseHandle(handle)


def prepare_library():
    if Path(sys.prefix).resolve() != (ROOT / ".runtime/wxauto-venv").resolve():
        raise ReaderFailure("dependency_missing")
    spec = importlib.util.spec_from_file_location("komorebi_wxauto_privacy", ROOT / "scripts/check-wxauto4.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _, _, flags = module.privacy_source()
    if any(value.value is not False for value in flags.values()):
        raise ReaderFailure("dependency_missing")


def capture():
    from .windows_probe import file_version, process_inventory
    prepare_library()
    from wxauto4 import Chat, WeChat, WxParam, languages, uia
    from wxauto4.ui.base import BaseUIWnd
    from wxauto4.ui.main import WeChatMainWnd
    from wxauto4.msgs import msg as message_parser
    import win32gui

    uia.Logger.SetLogFile("")
    uia.SetGlobalSearchTimeout(0.4)
    processes = dict(process_inventory())
    windows = [w for w in uia.GetRootControl().GetChildren() if w.ProcessId in processes]
    cache = load_cache()
    if any(w.ClassName == "mmui::LoginWindow" for w in windows):
        if cache.get("scope"):
            cache["invalidated"] = True
            save_cache(cache)
        return {"state": "login_required"}
    mains = [w for w in windows if w.ClassName == "mmui::MainWindow"]
    if not processes:
        return {"state": "not_running"}
    if len(mains) != 1:
        return {"state": "conversation_required"}
    main = mains[0]
    hwnd = main.NativeWindowHandle
    if file_version(processes[main.ProcessId]) != "4.1.8.107":
        return {"state": "unsupported_version"}
    if win32gui.IsIconic(hwnd):
        return {"state": "foreground_required"}
    scope = digest([main.ProcessId, process_created(main.ProcessId), hwnd, main.GetRuntimeId()])
    if cache.get("invalidated") or cache.get("scope") not in (None, scope):
        return {"state": "scope_changed"}
    navigation = main.ToolBarControl(AutomationId="MainView.main_tabbar", searchDepth=6)
    listing = main.ListControl(AutomationId="chat_message_list", searchDepth=40)
    if not navigation.ButtonControl(Name="Weixin", searchDepth=1).Exists(0) or not listing.Exists(0):
        return {"state": "conversation_required"}

    # Observed English labels. The wheel contains empty English translations and
    # hard-coded Chinese selectors. Only the isolated reader process is adapted.
    WxParam.LANGUAGE = "en"
    translations = {
        "WECHAT_CHAT_BOX": {"消息": "Messages", "聊天信息": "Chat Info", "聊天记录": "Chat History", "发送": "Send"},
        "WECHAT_SESSION_BOX": {"会话": "Chats", "搜索": "Search", "聊天记录": "Chat History", "文件传输助手": "File Transfer"},
        "WECHAT_NAVIGATION_BOX": {"聊天": "Weixin", "通讯录": "Contacts", "收藏": "Favorites", "朋友圈": "Moments",
                                  "视频号": "Channels", "搜一搜": "Search", "小程序面板": "Mini Programs Panel", "手机": "Mobile", "设置及其他": "More"},
    }
    for table_name, entries in translations.items():
        for key, value in entries.items():
            getattr(languages, table_name)[key]["en"] = value
    original_button, original_list = uia.Control.ButtonControl, uia.Control.ListControl
    def button(self, *args, **kwargs):
        if kwargs.get("Name") in ("微信", "WeChat"):
            kwargs["Name"] = "Weixin"
        return original_button(self, *args, **kwargs)
    def list_control(self, *args, **kwargs):
        names = {"消息": "Messages", "会话": "Chats"}
        if kwargs.get("Name") in names:
            kwargs["Name"] = names[kwargs["Name"]]
        return original_list(self, *args, **kwargs)
    uia.Control.ButtonControl, uia.Control.ListControl = button, list_control
    BaseUIWnd._show = lambda self: None  # Never steal foreground focus.
    # ProfileWnd.topui is unavailable on this client. Missing account identity is
    # explicit; it is not a substitute for authentication or permission to send.
    WeChatMainWnd.get_my_info = lambda self: {"nickname": None, "name": None, "wxid": None, "id": None}

    def deny(*args, **kwargs):
        raise ReaderFailure("reader_failed")
    for cls in (Chat, WeChat):
        for method in ("SendMsg", "SendFiles", "SendUrlCard", "PublishMoment", "AddNewFriend", "EditFriendInfo",
                       "CreateGroup", "ShutDown", "ChatWith", "AddListenChat", "StartListening", "SwitchToChat", "SwitchToContact", "Close"):
            if hasattr(cls, method):
                setattr(cls, method, deny)
    def click(self, *args, **kwargs):
        # Constructor navigation is unnecessary: the current chat is already open.
        if self.searchProperties.get("Name") == "Weixin" and self.Exists(0) and self.GetTopLevelControl().NativeWindowHandle == hwnd and listing.Exists(0):
            return
        deny()
    uia.Control.Click = click
    original = {name: getattr(uia.Control, name) for name in ("SetFocus", "RightClick", "MiddleClick", "SendKeys")}
    target = {"runtime": None, "content": None, "name": None, "menus": 0, "open": False}

    def foreground():
        current = win32gui.GetForegroundWindow()
        return current == hwnd or bool(current and win32gui.GetAncestor(current, 3) == hwnd)

    def guard(control):
        edit = main.EditControl(AutomationId="chat_input_field", searchDepth=40)
        if not foreground() or target["runtime"] is None or not control.Exists(0) or control.GetRuntimeId() != target["runtime"] or control.Name != target["content"] or control.ClassName != "mmui::ChatTextItemView" or not edit.Exists(0) or edit.Name != target["name"]:
            deny()
    def focus(control, *args, **kwargs):
        guard(control)
        return original["SetFocus"](control, *args, **kwargs)
    def right_click(control, *args, **kwargs):
        guard(control)
        if target["menus"] >= 2:
            deny()
        result = original["RightClick"](control, *args, **kwargs)
        target["menus"] += 1
        target["open"] = True
        return result
    def middle_click(control, *args, **kwargs):
        guard(control)
        if not target["open"]:
            deny()
        result = original["MiddleClick"](control, *args, **kwargs)
        target["open"] = False
        return result
    def keys(control, text, *args, **kwargs):
        if text not in ("{Esc}", "{ESC}", "{Escape}") or not target["open"] or not foreground():
            deny()
        result = original["SendKeys"](control, text, *args, **kwargs)
        target["open"] = False
        return result
    uia.Control.SetFocus, uia.Control.RightClick, uia.Control.MiddleClick, uia.Control.SendKeys = focus, right_click, middle_click, keys
    uia.Control.SwitchToThisWindow = lambda self: None
    for method in ("DoubleClick", "SendChar"):
        setattr(uia.Control, method, deny)
    client = WeChat(resize=False, debug=False, version="WeChat")
    info = client.ChatInfo()
    kind = {"friend": "individual", "group": "group"}.get(info.get("chat_type"))
    name = info.get("chat_name")
    sessions = client.GetSession()
    if not kind or not isinstance(name, str) or not name or len(name) > 500:
        return {"state": "conversation_required"}
    edit = main.EditControl(AutomationId="chat_input_field", searchDepth=40)
    if not edit.Exists(0) or edit.Name != name or sum(s.info.get("name") == name for s in sessions) != 1:
        return {"state": "ambiguous_chat"}
    chat = {"scope": scope, "name": name, "type": kind, "member_count": info.get("group_member_count"),
            "external_id": "wxauto4:local:" + digest([scope, name, kind])}
    controls = listing.GetChildren()
    if len(controls) > 100:
        raise ReaderFailure("reader_failed")
    rows, remaining, unsupported, captured = [], 0, 0, False
    state = "ready"
    for control in controls:
        if control.ClassName != "mmui::ChatTextItemView" or not control.AutomationId.endswith("chat_bubble_item_view"):
            unsupported += 1
            continue
        content = control.Name
        if not isinstance(content, str) or not 1 <= len(content) <= 20000:
            unsupported += 1
            continue
        key = observation_key(scope, name, kind, control.GetRuntimeId(), content)
        cached = cache["records"].get(key)
        if cached:
            if cached.get("content") != content:
                raise ReaderFailure("reader_failed")
            rows.append(cached)
            continue
        if captured:
            remaining += 1
            continue
        if not foreground():
            remaining += 1
            state = "foreground_required"
            continue
        if idle_seconds() < 3:
            remaining += 1
            state = "user_active"
            continue
        target.update(runtime=control.GetRuntimeId(), content=content, name=name, menus=0, open=False)
        message = message_parser.parse_msg(control, client.ChatBox)
        if message.content != content or message.attr not in ("friend", "self") or not type(message).__name__.endswith("TextMessage"):
            raise ReaderFailure("reader_failed")
        if client.ChatInfo().get("chat_name") != name or client.ChatInfo().get("chat_type") != info["chat_type"]:
            raise ReaderFailure("ambiguous_chat")
        sender = getattr(message, "sender", None)
        row = {"source_key": key, "content": content, "sender_name": sender if message.attr == "friend" and isinstance(sender, str) else "",
               "direction": "incoming" if message.attr == "friend" else "outgoing"}
        rows.append(row)
        cache["records"][key] = row
        captured = True
    current = client.ChatInfo()
    if current.get("chat_name") != name or current.get("chat_type") != info["chat_type"] or edit.Name != name:
        raise ReaderFailure("ambiguous_chat")
    output = validate_snapshot({"state": state, "chat": chat, "messages": rows, "discovered_count": len(sessions),
                                "remaining_count": remaining, "unsupported_count": unsupported,
                                "parsed_count": int(captured), "menu_count": target["menus"]})
    cache["scope"] = scope
    save_cache(cache)
    return output


def main():
    def no_network(event, args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.bind"}:
            raise PermissionError("network_disabled_in_reader")
    sys.addaudithook(no_network)
    try:
        if sys.platform != "win32":
            return {"state": "unsupported_os"}
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), reader_mutex():
            return capture()
    except ReaderFailure as exc:
        code = exc.args[0] if exc.args else "reader_failed"
        return validate_snapshot({"state": code})
    except Exception:
        return {"state": "reader_failed"}


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=True), flush=True)
