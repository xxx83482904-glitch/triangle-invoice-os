"""Per-user supervisor. No Windows service/session 0; WeChat needs the user's desktop.

Only lifecycle codes are logged. The lock prevents duplicate supervisors, and a
Windows job kills owned children if the supervisor itself crashes or signs out.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


class InstanceLock:
    def __init__(self, path):
        self.file = path.open("a+b")
        self.file.seek(0)
        # Inspect metadata: reading the locked byte is forbidden on Windows.
        if os.fstat(self.file.fileno()).st_size == 0:
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)

    def acquire(self):
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def close(self):
        self.file.close()


def own_windows_job():
    if os.name != "nt":
        return None
    from ctypes import wintypes as w

    class Basic(ctypes.Structure):
        _fields_ = [("ProcessTime", ctypes.c_int64), ("JobTime", ctypes.c_int64),
                    ("Flags", w.DWORD), ("MinWorkingSet", ctypes.c_size_t),
                    ("MaxWorkingSet", ctypes.c_size_t), ("ActiveProcesses", w.DWORD),
                    ("Affinity", ctypes.c_size_t), ("Priority", w.DWORD), ("Scheduling", w.DWORD)]

    class Extended(ctypes.Structure):
        _fields_ = [("Basic", Basic), ("Io", ctypes.c_uint64 * 6),
                    ("ProcessMemory", ctypes.c_size_t), ("JobMemory", ctypes.c_size_t),
                    ("PeakProcessMemory", ctypes.c_size_t), ("PeakJobMemory", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes, kernel.CreateJobObjectW.restype = [w.LPVOID, w.LPCWSTR], w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()):
        error = ctypes.get_last_error()
        if handle:
            kernel.CloseHandle(handle)
        raise OSError(error, "resident_job_unavailable")
    # Do not close here: closing the last handle terminates the whole job,
    # including this supervisor. Windows closes it when this process exits.
    return handle


def read_state(folder):
    try:
        return json.loads((folder / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(folder, state):
    temporary = folder / "state.tmp"
    temporary.write_text(json.dumps(state), encoding="utf-8")
    temporary.replace(folder / "state.json")


def locked(folder):
    lock = InstanceLock(folder / "instance.lock")
    result = not lock.acquire()
    lock.close()
    return result


def healthy(port):
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
            return json.load(response).get("service") == "komorebi"
    except Exception:
        return False


def available(port):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def event(folder, name, **fields):
    path = folder / "lifecycle.log"
    if path.exists() and path.stat().st_size > 262144:
        path.replace(folder / "lifecycle.previous.log")
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"time": time.time(), "event": name, **fields}) + "\n")


def stop_child(child):
    if child is None or child.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill.exe", "/PID", str(child.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=15, check=False)
    else:
        child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def run(folder, port):
    lock = InstanceLock(folder / "instance.lock")
    if not lock.acquire():
        lock.close()
        return 0
    child = None
    state = {"pid": os.getpid(), "generation": str(uuid4()), "port": port,
             "state": "starting", "healthy": False, "restarts": 0}
    try:
        job = own_windows_job()
        write_state(folder, state)
        if not (ROOT / "frontend/out/index.html").is_file():
            raise RuntimeError("frontend_not_built")
        if not available(port):
            raise RuntimeError("port_in_use")
        (folder / "stop.json").unlink(missing_ok=True)
        event(folder, "supervisor_started", pid=os.getpid())
        next_start = 0.0
        backoff = 1
        next_health = 0.0
        failed_health = 0
        while True:
            try:
                stop = json.loads((folder / "stop.json").read_text(encoding="utf-8"))
                if stop.get("generation") == state["generation"]:
                    break
            except (OSError, ValueError):
                pass
            current = time.monotonic()
            if child is not None and child.poll() is not None:
                event(folder, "backend_exited", code=child.returncode)
                child = None
                state.update(state="restarting", healthy=False, child_pid=None)
                state["restarts"] += 1
                next_start = current + backoff
                backoff = min(backoff * 2, 30)
                write_state(folder, state)
            if child is None and current >= next_start:
                if not available(port):
                    raise RuntimeError("port_in_use")
                env = dict(os.environ, WECHAT_PORT=str(port))
                child = subprocess.Popen([sys.executable.replace("pythonw.exe", "python.exe"), "run.py"],
                                         cwd=ROOT / "backend", env=env, stdin=subprocess.DEVNULL,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                state.update(state="starting", healthy=False, child_pid=child.pid)
                write_state(folder, state)
                next_health, failed_health = current + 1, 0
            if child is not None and current >= next_health:
                ok = healthy(port)
                failed_health = 0 if ok else failed_health + 1
                if ok:
                    backoff = 1
                state.update(state="running" if ok else "starting", healthy=ok)
                write_state(folder, state)
                if failed_health >= 6:
                    event(folder, "health_timeout")
                    stop_child(child)
                next_health = current + 5
            time.sleep(0.25)
        state.update(state="stopped", healthy=False)
        event(folder, "supervisor_stopped")
        return 0
    except Exception as exc:
        # Fixed codes/types only; never serialize request/exception contents.
        code = str(exc) if isinstance(exc, RuntimeError) and str(exc) in {"frontend_not_built", "port_in_use"} else type(exc).__name__
        state.update(state="failed", healthy=False, error=code)
        event(folder, "supervisor_failed", code=code)
        return 1
    finally:
        stop_child(child)
        write_state(folder, state)
        lock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["run", "start", "stop", "status"])
    parser.add_argument("--runtime-dir", type=Path, default=ROOT / ".runtime/resident")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    folder = args.runtime_dir.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    if args.command == "run":
        return run(folder, args.port)
    if args.command == "stop":
        if locked(folder):
            state = read_state(folder)
            (folder / "stop.json").write_text(json.dumps({"generation": state.get("generation")}), encoding="utf-8")
            for _ in range(100):
                if not locked(folder):
                    break
                time.sleep(0.2)
            else:
                print("Resident stop timed out; no unrelated processes were terminated.")
                return 1
        print("Resident stopped.")
        return 0
    if args.command == "start":
        previous = read_state(folder).get("generation")
        starting = not locked(folder)
        if starting:
            executable = Path(sys.executable)
            if os.name == "nt":
                executable = executable.with_name("pythonw.exe")
            subprocess.Popen([str(executable), str(Path(__file__).resolve()), "run", "--runtime-dir", str(folder), "--port", str(args.port)],
                             cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        for _ in range(100):
            state = read_state(folder)
            if locked(folder) and (not starting or state.get("generation") != previous) and state.get("healthy") and healthy(state.get("port", args.port)):
                print(f"Running: http://127.0.0.1:{state['port']}")
                return 0
            time.sleep(0.2)
        print("Resident startup failed; check .runtime/resident/state.json and lifecycle.log.")
        return 1
    state = read_state(folder)
    state["supervisor_running"] = locked(folder)
    state["healthy"] = state["supervisor_running"] and healthy(state.get("port", args.port))
    print(json.dumps(state))
    return 0


if __name__ == "__main__":
    sys.exit(main())
