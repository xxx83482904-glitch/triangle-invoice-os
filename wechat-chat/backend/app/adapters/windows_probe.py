"""Read-only Windows process/UIA probe. Outputs only structural diagnostics.

No keyboard/mouse actions, process memory reads, credentials, chat names or message
text. It runs in a separate, time-limited process so a hung COM provider cannot
block the queue or API. We deliberately do not infer login from process presence.
"""
import ctypes
from ctypes import wintypes
import json
import sys


def classify_observation(observation):
    """Classify structure, never infer authentication from a running process."""
    if not observation.get("process_count"):
        return "not_running"
    if not observation.get("window_count"):
        return "window_unavailable"
    if observation.get("all_windows_minimized"):
        return "window_minimized"
    if observation.get("login_layout_detected"):
        return "login_required"
    if not observation.get("interactive_node_count"):
        return "ui_tree_unavailable"
    # Exposed controls do not prove that messages or stable chat IDs are readable.
    return "unsupported_ui"


def process_inventory():
    class ProcessEntry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("pid", wintypes.DWORD), ("heap", ctypes.c_void_p), ("module", wintypes.DWORD), ("threads", wintypes.DWORD), ("parent", wintypes.DWORD), ("priority", wintypes.LONG), ("flags", wintypes.DWORD), ("name", wintypes.WCHAR * 260)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)  # TH32CS_SNAPPROCESS only
    if snapshot == ctypes.c_void_p(-1).value:
        raise OSError("process_inventory_unavailable")
    result = []
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        valid = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        while valid:
            if entry.name.lower() in ("weixin.exe", "wechat.exe"):
                path = ""
                handle = kernel.OpenProcess(0x1000, False, entry.pid)  # QUERY_LIMITED_INFORMATION, no VM_READ
                if handle:
                    try:
                        buffer = ctypes.create_unicode_buffer(32768)
                        size = wintypes.DWORD(len(buffer))
                        if kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                            path = buffer.value
                    finally:
                        kernel.CloseHandle(handle)
                result.append((entry.pid, path))
            valid = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    return result


def file_version(path):
    if not path:
        return None
    version = ctypes.WinDLL("version", use_last_error=True)
    version.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
    version.GetFileVersionInfoW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    version.VerQueryValueW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.UINT)]
    size = version.GetFileVersionInfoSizeW(path, None)
    if not size:
        return None
    buffer = ctypes.create_string_buffer(size)
    if not version.GetFileVersionInfoW(path, 0, size, buffer):
        return None
    pointer, length = ctypes.c_void_p(), wintypes.UINT()
    if not version.VerQueryValueW(buffer, "\\", ctypes.byref(pointer), ctypes.byref(length)):
        return None
    values = ctypes.cast(pointer, ctypes.POINTER(wintypes.DWORD))
    if length.value < 16 or values[0] != 0xFEEF04BD:
        return None
    major, minor = values[2], values[3]
    return f"{major >> 16}.{major & 65535}.{minor >> 16}.{minor & 65535}"


def probe():
    if sys.platform != "win32":
        return {"state": "unsupported_os"}
    processes = process_inventory()
    result = {"state": "not_running" if not processes else "window_unavailable", "process_count": len(processes), "window_count": 0, "node_count": 0, "interactive_node_count": 0, "window_classes": [], "login_layout_detected": False, "version": file_version(processes[0][1]) if processes else None}
    if not processes:
        return result
    try:
        import uiautomation as auto
    except ImportError:
        return {**result, "state": "dependency_missing"}
    auto.Logger.SetLogFile("")
    auto.SetGlobalSearchTimeout(0.5)
    pids = {pid for pid, _ in processes}
    windows = [control for control in auto.GetRootControl().GetChildren() if control.ProcessId in pids]
    result["window_count"] = len(windows)
    if not windows:
        return result
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.IsIconic.argtypes = [wintypes.HWND]
    user.IsIconic.restype = wintypes.BOOL
    result["all_windows_minimized"] = all(bool(user.IsIconic(control.NativeWindowHandle)) for control in windows)
    # Class names are restricted to known framework names; titles, Name, Value,
    # account IDs, chat labels and message text never enter this report.
    allowed_classes = {"mmui::MainWindow", "mmui::LoginWindow", "Qt51514QWindowIcon", "MMUIRenderSubWindowHW"}
    result["window_classes"] = sorted({control.ClassName for control in windows if control.ClassName in allowed_classes})
    interactive_types = {"ButtonControl", "EditControl", "ListControl", "ListItemControl", "TextControl", "TabControl", "TabItemControl", "MenuItemControl"}
    stack = [(control, 0) for control in windows]
    while stack and result["node_count"] < 500:
        control, depth = stack.pop()
        result["node_count"] += 1
        if control.ControlTypeName in interactive_types:
            result["interactive_node_count"] += 1
        # Only the observed login-layout selector is recognized. No name guessing.
        if control.AutomationId.startswith("login_layout_"):
            result["login_layout_detected"] = True
        if depth < 10:
            stack.extend((child, depth + 1) for child in control.GetChildren())
    result["tree_truncated"] = bool(stack)
    result["state"] = classify_observation(result)
    return result


if __name__ == "__main__":
    try:
        result = probe()
    except Exception:
        result = {"state": "probe_failed"}
    print(json.dumps(result, ensure_ascii=True))
