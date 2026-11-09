"""Manage only Komorebi's HTTPS route. Public access requires enable-public."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import httpx

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".runtime/mobile.json"
TARGET = "http://127.0.0.1:8765"


def command(*args, timeout=15):
    executable = shutil.which("tailscale") or str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Tailscale/tailscale.exe")
    result = subprocess.run([executable, *args], stdin=subprocess.DEVNULL, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=timeout,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise RuntimeError("Tailscale command failed. Check Tailscale sign-in and Serve/HTTPS permissions.")
    return result.stdout


def route_matches(config, endpoint, port):
    return config.get("TCP", {}).get(str(port)) == {"HTTPS": True} and config.get("Web", {}).get(endpoint) == {"Handlers": {"/": {"Proxy": TARGET}}}


def preflight_public():
    sys.path.insert(0, str(ROOT / "backend"))
    from app.config import Settings
    settings = Settings.from_env()
    if any("*" in value for value in (*settings.hosts, *settings.origins)):
        raise RuntimeError("Wildcard origins/hosts are not allowed for public access.")
    with httpx.Client(base_url=TARGET, timeout=5, trust_env=False) as client:
        if client.get("/api/health").json().get("service") != "komorebi":
            raise RuntimeError("Komorebi is not running on the expected localhost port.")
        for path in ("/api/chats", "/api/search?q=check", "/api/queue", "/api/status", "/api/device"):
            if client.get(path).status_code != 401:
                raise RuntimeError("Authentication preflight failed. No public route was enabled.")
        for path in ("/api/chats/preflight-invalid/send", "/api/mock", "/api/sync"):
            if client.post(path, json={}).status_code != 401:
                raise RuntimeError("Write API preflight failed. No public route was enabled.")
        for path in ("/.env", "/.runtime/access-token.txt", "/data/mock.sqlite3"):
            if client.get(path).status_code != 404:
                raise RuntimeError("Private file preflight failed. No public route was enabled.")
        response = client.get("/api/device", headers={"Authorization": "Bearer " + settings.token})
        if response.status_code != 200 or "mobile_access" not in response.json():
            raise RuntimeError("Restart the updated Komorebi app before enabling public access.")


def check_route(config, endpoint, port):
    occupied = str(port) in config.get("TCP", {}) or endpoint in config.get("Web", {})
    if occupied and not route_matches(config, endpoint, port):
        raise RuntimeError("This HTTPS port already serves another app. No route was changed.")
    if any(enabled for name, enabled in config.get("AllowFunnel", {}).items() if name != endpoint):
        raise RuntimeError("Another Funnel route exists. No settings were changed.")
    return occupied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["enable", "enable-public", "status", "disable"])
    parser.add_argument("--port", type=int, choices=[443, 8443], default=443)
    args = parser.parse_args()
    local = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.is_file() else {}
    config = json.loads(command("serve", "status", "--json")) or {}
    if args.action == "status":
        active = bool(local.get("enabled") and route_matches(config, local["endpoint"], local["port"]))
        public = bool(config.get("AllowFunnel", {}).get(local.get("endpoint")))
        print(json.dumps({"configured": local.get("enabled", False), "active": active,
                          "url": local.get("url"), "funnel": public,
                          "access_mode": "public" if public else "private", "configured_mode": local.get("access_mode", "private")}))
        return 0
    if args.action == "disable":
        if local.get("enabled"):
            if not route_matches(config, local["endpoint"], local["port"]):
                raise RuntimeError("Serve route changed. No route was removed.")
            if config.get("AllowFunnel", {}).get(local["endpoint"]):
                command("funnel", f"--https={local['port']}", "off")
            command("serve", f"--https={local['port']}", "off")
            local["enabled"] = False
            CONFIG.write_text(json.dumps(local, indent=2), encoding="utf-8")
        print("Mobile access disabled. Restart Komorebi to remove the allowed origin.")
        return 0
    public = args.action == "enable-public"
    status = json.loads(command("status", "--json"))
    if status.get("BackendState") != "Running" or not status.get("Self", {}).get("Online"):
        raise RuntimeError("Sign in to Tailscale manually before enabling mobile access.")
    hostname = status["Self"]["DNSName"].rstrip(".")
    if not hostname.endswith(".ts.net"):
        raise RuntimeError("A Tailscale MagicDNS hostname is required.")
    endpoint = f"{hostname}:{args.port}"
    occupied = check_route(config, endpoint, args.port)
    if local.get("enabled") and local.get("port") != args.port:
        raise RuntimeError("Disable the current Komorebi route before changing its port.")
    if public:
        preflight_public()
    currently_public = bool(config.get("AllowFunnel", {}).get(endpoint))
    if not occupied or currently_public != public:
        command("funnel" if public else "serve", "--bg", "--yes", f"--https={args.port}", TARGET, timeout=40)
    after = json.loads(command("serve", "status", "--json")) or {}
    if not route_matches(after, endpoint, args.port) or bool(after.get("AllowFunnel", {}).get(endpoint)) != public:
        raise RuntimeError("HTTPS route could not be verified. Check 'tailscale serve status'.")
    url = f"https://{hostname}" + (f":{args.port}" if args.port != 443 else "")
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({"enabled": True, "url": url, "endpoint": endpoint, "port": args.port, "target": TARGET, "access_mode": "public" if public else "private"}, indent=2), encoding="utf-8")
    print(f"{'Public (login required)' if public else 'Private'} mobile URL: {url}")
    print("Restart Komorebi to apply the mobile access instructions and exact origin allowlist.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired as exc:
        import re
        output = exc.stdout or b""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        links = re.findall(r"https://login\.tailscale\.com/f/[a-z]+\?node=[A-Za-z0-9_-]+", output)
        print("Tailscale requires attention in its account settings. No app credentials were printed.")
        for link in links:
            print(link)
        sys.exit(1)
    except (OSError, ValueError, RuntimeError, httpx.HTTPError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Tailscale configuration unavailable; no app credentials were printed.")
        sys.exit(1)
