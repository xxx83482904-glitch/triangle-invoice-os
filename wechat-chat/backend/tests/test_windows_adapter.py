import asyncio
import pytest

from app.adapters.base import AdapterError
from app.adapters.windows_uia import WindowsUIAAdapter


@pytest.mark.parametrize("diagnostic,expected", [
    ("login_required", "login_required"), ("unsupported_ui", "limited"),
    ("not_running", "disconnected"), ("window_unavailable", "disconnected"),
    ("probe_timeout", "error"), ("dependency_missing", "error"), ("unsupported_os", "error"),
])
def test_diagnostic_states_fail_closed(monkeypatch, diagnostic, expected):
    monkeypatch.setattr(WindowsUIAAdapter, "_probe", staticmethod(lambda: {"state": diagnostic, "version": "4.1.15.56"}))
    async def run():
        adapter = WindowsUIAAdapter()
        status = await adapter.connect()
        assert status.state == expected
        assert not status.can_send and not status.can_read
        assert (await adapter.send_message("any", "must not send")).status == "failed"
        with pytest.raises(AdapterError):
            await adapter.get_messages("any")
        await adapter.disconnect()
        assert (await adapter.get_connection_status()).state == "disconnected"
    asyncio.run(run())
