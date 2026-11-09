"""Bounded free-wxauto4 trial. No chat navigation, send, import or background listener.

Use setup-wxauto4.ps1 once, then run this with the application's Python.
The optional wheel stays in .runtime/wxauto-venv, outside the resident app.
"""
import argparse
import ast
import contextlib
from datetime import datetime, timezone
import importlib.metadata
import io
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
PIN = "41.1.7"
FLAGS = {"TELEMETRY_ENABLED", "ENABLE_FILE_LOGGER"}
NETWORK_EVENTS = {"socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.bind"}


def privacy_source():
    """Inspect metadata and Python configuration without importing the package."""
    dist = importlib.metadata.distribution("wxauto4")
    if dist.version != PIN:
        raise ValueError("unsupported_package")
    path = Path(dist.locate_file("wxauto4/param.py")).resolve()
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "WxParam"]
    flags = {}
    if len(classes) == 1:
        for node in classes[0].body:
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id in FLAGS:
                if isinstance(node.value, ast.Constant) and type(node.value.value) is bool:
                    flags[node.target.id] = node.value
    if set(flags) != FLAGS:
        raise ValueError("privacy_defaults_not_disabled")
    return path, source, flags


def prepare():
    # Only this disposable environment is modified. Do not import an unprepared
    # package merely to switch off logging after initialization has already run.
    prefix = Path(sys.prefix).resolve()
    if prefix != (ROOT / ".runtime/wxauto-venv").resolve() or sys.prefix == sys.base_prefix:
        raise ValueError("isolated_environment_required")
    path, source, flags = privacy_source()
    if not path.is_relative_to(prefix):
        raise ValueError("isolated_environment_required")
    lines = source.splitlines(keepends=True)
    for node in sorted(flags.values(), key=lambda n: (n.lineno, n.col_offset), reverse=True):
        line = lines[node.lineno - 1]
        lines[node.lineno - 1] = line[:node.col_offset] + "False" + line[node.end_col_offset:]
    path.write_text("".join(lines), encoding="utf-8")
    _, _, checked = privacy_source()
    if any(n.value is not False for n in checked.values()):
        raise ValueError("privacy_defaults_not_disabled")


def classify_error(exc, initialized=False):
    text = str(exc)
    if isinstance(exc, importlib.metadata.PackageNotFoundError):
        return "dependency_missing"
    if text in {"unsupported_package", "privacy_defaults_not_disabled", "input_disabled"}:
        return text
    if "未找到已登录的客户端主窗口" in text:
        return "main_window_not_found"
    if "Find Control Timeout" in text:
        return "control_timeout"
    return "read_failed" if initialized else "probe_failed"


def worker(variant):
    result = {"variant": variant, "initialized": False, "read_attempted": False}
    blocked = [0]
    started = time.monotonic()

    def deny_network(event, _args):
        if event in NETWORK_EVENTS:
            blocked[0] += 1
            raise PermissionError("network_disabled_in_probe")

    sys.addaudithook(deny_network)
    if sys.platform != "win32":
        return {**result, "error_code": "unsupported_os"}
    try:
        # All raw library stdout/stderr is discarded, including account labels.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            _, _, flags = privacy_source()
            if any(n.value is not False for n in flags.values()):
                raise ValueError("privacy_defaults_not_disabled")
            result["package_version"] = PIN
            from wxauto4 import Chat, WeChat, WxParam, uia
            if WxParam.TELEMETRY_ENABLED or WxParam.ENABLE_FILE_LOGGER:
                raise ValueError("privacy_defaults_not_disabled")
            WxParam.LANGUAGE = "cn" if variant == "cn" else "en"
            uia.Logger.SetLogFile("")

            def no_input(*_args, **_kwargs):
                raise RuntimeError("input_disabled")

            for cls in (Chat, WeChat):
                for name in ("SendMsg", "SendFiles", "SendUrlCard", "PublishMoment", "AddNewFriend",
                             "EditFriendInfo", "CreateGroup", "ShutDown", "ChatWith", "AddListenChat",
                             "StartListening", "SwitchToChat", "SwitchToContact"):
                    if hasattr(cls, name):
                        setattr(cls, name, no_input)

            sys.path.insert(0, str(ROOT / "backend"))
            from app.adapters.windows_probe import file_version, process_inventory
            processes = process_inventory()
            result["wechat_version"] = file_version(processes[0][1]) if processes else None
            pids = {pid for pid, _ in processes}
            stack = [(c, 0) for c in uia.GetRootControl().GetChildren() if c.ProcessId in pids]
            nodes = controls = 0
            interactive = {"ButtonControl", "EditControl", "ListControl", "ListItemControl", "TextControl",
                           "TabControl", "TabItemControl", "MenuItemControl"}
            while stack and nodes < 500:
                control, depth = stack.pop()
                nodes += 1
                controls += control.ControlTypeName in interactive
                if depth < 10:
                    stack.extend((c, depth + 1) for c in control.GetChildren())
            result.update(node_count=nodes, interactive_node_count=controls)
            options = {"version": "WeChat"} if variant == "international" else {}
            client = WeChat(debug=False, resize=False, **options)
            result["initialized"] = True
            result["read_attempted"] = True
            # Only counts leave this process. No names, text, account identifiers,
            # message objects, database records or downloads are persisted.
            sessions = client.GetSession()
            messages = client.GetAllMessage()
            if not isinstance(sessions, list) or not isinstance(messages, list):
                raise ValueError("unexpected_read_shape")
            result.update(session_count=len(sessions), visible_message_count=len(messages))
    except Exception as exc:
        result["error_code"] = classify_error(exc, result["initialized"])
    result["blocked_python_network_operations"] = blocked[0]
    result["elapsed_seconds"] = round(time.monotonic() - started, 2)
    return result


def run_trial(python):
    sys.path.insert(0, str(ROOT / "backend"))
    from app.wxauto_trial import Attempt, FreeTrialReport
    attempts, metadata = [], {}
    for variant in ("en", "cn", "international"):
        try:
            process = subprocess.run([str(python), "-X", "utf8", str(Path(__file__).resolve()), "--worker", variant],
                                     cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=15,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if process.returncode:
                raise ValueError("probe_failed")
            raw = json.loads(process.stdout)
            attempt = Attempt.model_validate({**raw, "variant": variant})
            for key in ("package_version", "wechat_version", "node_count", "interactive_node_count"):
                if key in raw and key not in metadata:
                    metadata[key] = raw[key]
        except subprocess.TimeoutExpired:
            attempt = Attempt(variant=variant, error_code="probe_timeout")
        except Exception:
            attempt = Attempt(variant=variant, error_code="probe_failed")
        attempts.append(attempt)
        print(json.dumps(attempt.model_dump(), ensure_ascii=True), flush=True)
    report = FreeTrialReport(checked_at=datetime.now(timezone.utc), attempts=attempts, **metadata)
    destination = ROOT / ".runtime/wxauto4-trial.json"
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    temporary.replace(destination)
    print("Local report: .runtime/wxauto4-trial.json (not a sync capability or send authorization).")
    return 0 if any(a.error_code is None and (a.visible_message_count or 0) > 0 for a in attempts) else 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, default=ROOT / ".runtime/wxauto-venv/Scripts/python.exe")
    parser.add_argument("--worker", choices=["en", "cn", "international"], help=argparse.SUPPRESS)
    parser.add_argument("--prepare", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.prepare:
        try:
            prepare()
        except Exception:
            sys.exit("Isolated wxauto4 privacy configuration failed. Package was not imported.")
    elif args.worker:
        print(json.dumps(worker(args.worker), ensure_ascii=True), flush=True)
    else:
        sys.exit(run_trial(args.python))
