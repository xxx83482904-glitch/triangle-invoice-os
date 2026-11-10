"""Synthetic regressions for the licensed SDK contract observed on 4.1.8.107.

These tests do not import wxautox4, license a device or touch a real chat.
"""
from types import SimpleNamespace

import pytest

from app.adapters.plus_core import PlusFailure, digest
from app.adapters.plus_sdk import PlusSDK


class Field:
    def __init__(self, name, *, exists=True, value=""):
        self.Name, self.exists, self.value = name, exists, value

    def Exists(self, timeout):
        return self.exists

    def GetValuePattern(self):
        if self.value is None:
            raise RuntimeError("ValuePattern unavailable")
        return SimpleNamespace(Value=self.value)


class Window:
    ProcessId, NativeWindowHandle = 100, 200
    ClassName, Name = "mmui::ChatSingleWindow", "テスト会話"

    def __init__(self):
        self.edit, self.listing, self.header = Field("输入"), Field("消息"), Field(self.Name)
        self.runtime = [1, 2, 3]

    def GetRuntimeId(self):
        return self.runtime

    def EditControl(self, **selector):
        assert selector == dict(AutomationId="chat_input_field", searchDepth=40)
        return self.edit

    def ListControl(self, **selector):
        assert selector == dict(AutomationId="chat_message_list", searchDepth=40)
        return self.listing

    def TextControl(self, **selector):
        assert selector["AutomationId"].endswith(".current_chat_name_label")
        return self.header


@pytest.fixture
def sdk():
    instance = PlusSDK.__new__(PlusSDK)
    instance.scope, instance.process_id, instance.main_hwnd = "scope", 100, 150
    instance.check_scope = lambda: "scope"
    window = Window()
    instance.uia = SimpleNamespace(GetRootControl=lambda: SimpleNamespace(GetChildren=lambda: [window]))
    return instance, window


def target(window):
    return dict(name=window.Name, type="individual",
        binding=digest(["scope", window.NativeWindowHandle, window.GetRuntimeId()]),
        chat=SimpleNamespace(ChatInfo=lambda: dict(chat_name=window.Name, chat_type="friend")))


def test_account_uses_observed_id_field_not_nickname(sdk):
    instance, _ = sdk
    instance.wx = SimpleNamespace(GetMyInfo=lambda: dict(id="synthetic-id", display_name="nickname", region="region"))
    assert instance.account_id() == "synthetic-id"


def test_system_feeds_are_never_registered_as_a_reply_destination(sdk):
    instance, _ = sdk
    instance.wx = SimpleNamespace(GetSession=lambda: [SimpleNamespace(info={'name':name}) for name in
        ['個人テスト','公众号','服务通知','折叠的聊天','グループテスト']])
    assert instance.sessions() == ['個人テスト','グループテスト']


@pytest.mark.parametrize("info", [{"wxid": "legacy-field"}, {"display_name": "nickname"}, {"id": " "}, {"id": None}, []])
def test_account_missing_id_fails_closed(sdk, info):
    instance, _ = sdk
    instance.wx = SimpleNamespace(GetMyInfo=lambda: info)
    with pytest.raises(PlusFailure, match="account_unavailable"):
        instance.account_id()


def test_child_input_has_generic_label_and_header_is_recipient(sdk):
    instance, window = sdk
    assert instance._window(window.Name) == (window, window.edit)
    instance.verify(target(window))


@pytest.mark.parametrize("mismatch", ["header", "missing_header", "missing_edit", "missing_list", "process", "main", "class", "duplicate"])
def test_title_match_alone_never_accepts_recipient(sdk, mismatch):
    instance, window = sdk
    if mismatch == "header": window.header.Name = "違う会話"
    if mismatch == "missing_header": window.header.exists = False
    if mismatch == "missing_edit": window.edit.exists = False
    if mismatch == "missing_list": window.listing.exists = False
    if mismatch == "process": window.ProcessId += 1
    if mismatch == "main": window.NativeWindowHandle = instance.main_hwnd
    if mismatch == "class": window.ClassName = "mmui::MainWindow"
    if mismatch == "duplicate":
        instance.uia.GetRootControl = lambda: SimpleNamespace(GetChildren=lambda: [window, Window()])
    with pytest.raises(PlusFailure, match="binding_unavailable"):
        instance._window(window.Name)


@pytest.mark.parametrize("value", ["owner draft", None])
def test_draft_or_missing_value_pattern_blocks_send(sdk, value):
    instance, window = sdk
    window.edit.value = value
    calls = []
    recipient = target(window)
    recipient["chat"].SendMsg = lambda *args, **kwargs: calls.append(args)
    with pytest.raises((ValueError, RuntimeError)):
        instance.send_once(recipient, "must not send")
    assert not calls


def test_recreated_window_blocks_send_even_if_name_unchanged(sdk):
    instance, window = sdk
    recipient = target(window)
    window.runtime = [1, 2, 4]
    with pytest.raises(ValueError, match="destination_mismatch"):
        instance.verify(recipient)


def test_close_stops_listening_without_closing_owner_windows(sdk):
    instance, _ = sdk
    calls = []
    instance.wx = SimpleNamespace(StopListening=lambda **kw: calls.append(kw))
    instance.close()
    assert calls == [{"remove": False}]


def test_client_kind_is_independent_of_ui_language(sdk):
    instance, window = sdk
    calls = []
    instance.client_kind = "微信"
    instance._main = lambda: (window, "synthetic-version")
    instance.account_id = lambda: "synthetic-id"
    instance.factory = lambda **kw: calls.append(kw)
    assert instance.connect() == ("scope", "synthetic-id", "synthetic-version")
    assert calls == [dict(resize=False, debug=False, start_listener=False, version="微信")]
