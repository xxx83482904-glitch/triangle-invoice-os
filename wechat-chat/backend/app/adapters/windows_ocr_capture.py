"""Local, one-shot Windows OCR. Private output is IPC, never a diagnostic log.

Only a uniquely identified WeChat window is captured by HWND. No process memory, input,
clipboard, cloud services or screenshot files. Fail closed when changed/moved.
"""
import asyncio
import base64
import ctypes
from ctypes import wintypes
import io
import json
import sys

from .base import AdapterError


def choose_window(candidates):
    usable = [item for item in candidates if item["class"] in ("Qt51514QWindowIcon", "mmui::MainWindow") and item["visible"] and not item["minimized"] and not item["cloaked"] and item["width"] >= 700 and item["height"] >= 500 and item["width"] * item["height"] <= 12_000_000]
    if len(usable) > 1:
        raise AdapterError("ocr_window_ambiguous")
    if not usable:
        raise AdapterError("ocr_window_unsupported")
    return usable[0]["identity"]


def capture_target():
    from .windows_probe import process_inventory
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    user.OpenInputDesktop.restype = wintypes.HANDLE
    user.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    user.CloseDesktop.argtypes = [wintypes.HANDLE]
    desktop = user.OpenInputDesktop(0, False, 1)  # DESKTOP_READOBJECTS only
    if not desktop:
        raise AdapterError("ocr_desktop_unavailable")
    try:
        desktop_name, needed = ctypes.create_unicode_buffer(256), wintypes.DWORD()
        active = wintypes.BOOL()
        if not user.GetUserObjectInformationW(desktop, 2, desktop_name, ctypes.sizeof(desktop_name), ctypes.byref(needed)) or desktop_name.value != "Default":
            raise AdapterError("ocr_desktop_unavailable")
        if not user.GetUserObjectInformationW(desktop, 6, ctypes.byref(active), ctypes.sizeof(active), ctypes.byref(needed)) or not active.value:
            raise AdapterError("ocr_desktop_unavailable")
    finally:
        user.CloseDesktop(desktop)
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetClientRect.argtypes = user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    user.IsIconic.argtypes = user.IsWindowVisible.argtypes = [wintypes.HWND]
    inventory = dict(process_inventory())
    dwm = ctypes.WinDLL("dwmapi", use_last_error=True)
    dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    candidates = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]

    @callback_type
    def visit(hwnd, _):
        pid = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value not in inventory or not inventory[pid.value]:
            return True
        name, rect, origin = ctypes.create_unicode_buffer(256), wintypes.RECT(), wintypes.POINT()
        user.GetClassNameW(hwnd, name, len(name))
        if not user.GetClientRect(hwnd, ctypes.byref(rect)) or not user.ClientToScreen(hwnd, ctypes.byref(origin)):
            return True
        cloaked = wintypes.DWORD(1)
        if dwm.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked)):
            return True
        candidates.append({"identity": (hwnd, pid.value, (origin.x, origin.y, origin.x + rect.right, origin.y + rect.bottom)), "class": name.value, "visible": bool(user.IsWindowVisible(hwnd)), "minimized": bool(user.IsIconic(hwnd)), "cloaked": bool(cloaked.value), "width": rect.right, "height": rect.bottom})
        return True

    if not user.EnumWindows(visit, 0):
        raise AdapterError("ocr_capture_failed")
    # Size/class filter excludes the observed QR login window and small popups.
    # This does not prove login or chat identity: each import still needs review.
    return choose_window(candidates)


async def capture(language="ja"):
    if sys.platform != "win32":
        raise AdapterError("unsupported_os")
    from PIL import ImageGrab
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import SoftwareBitmap, BitmapPixelFormat
    from winrt.windows.storage.streams import DataWriter
    languages = [item.language_tag for item in OcrEngine.available_recognizer_languages]
    if language not in languages:
        raise AdapterError("ocr_language_unavailable")
    # A fresh subprocess owns this DPI context. No changes to desktop settings.
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    before = capture_target()
    # Pillow uses PrintWindow for this specific HWND. Never fall back to a desktop
    # bounding-box capture: it could include another app's overlapping content.
    picture = ImageGrab.grab(window=before[0]).convert("RGB")
    if before != capture_target():
        raise AdapterError("ocr_window_changed")
    if max(picture.size) > OcrEngine.max_image_dimension:
        raise AdapterError("ocr_window_unsupported")
    engine = OcrEngine.try_create_from_language(Language(language))
    if engine is None:
        raise AdapterError("ocr_language_unavailable")
    writer = DataWriter()
    bitmap = None
    try:
        writer.write_bytes(picture.convert("RGBA").tobytes("raw", "BGRA"))
        bitmap = SoftwareBitmap.create_copy_from_buffer(writer.detach_buffer(), BitmapPixelFormat.BGRA8, *picture.size)
        recognized = await engine.recognize_async(bitmap)
        lines = []
        for line in recognized.lines:
            boxes = [word.bounding_rect for word in line.words]
            if not boxes or not line.text.strip():
                continue
            left, top = min(b.x for b in boxes), min(b.y for b in boxes)
            right, bottom = max(b.x + b.width for b in boxes), max(b.y + b.height for b in boxes)
            lines.append({"text": line.text.strip()[:1000], "box": [round(left), round(top), round(right), round(bottom)]})
        lines.sort(key=lambda line: (line["box"][1], line["box"][0]))
        if len(lines) > 200:
            raise AdapterError("ocr_too_many_lines")
        # Only a thumbnail is sent to the authenticated local app for review.
        width, height = picture.size
        picture.thumbnail((1000, 1000))
        stream = io.BytesIO()
        picture.save(stream, format="JPEG", quality=80)
        return {"lines": lines, "image": "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode(), "width": width, "height": height, "language": language, "languages": languages}
    finally:
        if bitmap is not None:
            bitmap.close()
        writer.close()
        picture.close()


if __name__ == "__main__":
    try:
        result = asyncio.run(capture(sys.argv[1] if len(sys.argv) > 1 else "ja"))
    except ImportError:
        result = {"error": "ocr_dependency_missing"}
    except AdapterError as error:
        result = {"error": str(error)}  # Fixed codes defined in this module only.
    except Exception:
        result = {"error": "ocr_capture_failed"}
    # Captured by the parent process, never inherited by the application's logs.
    sys.stdout.write(json.dumps(result, ensure_ascii=True))
