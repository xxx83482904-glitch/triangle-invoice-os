import os
import json
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    db_path: Path
    token: str
    adapter: str = "mock"
    origins: tuple[str, ...] = ("http://127.0.0.1:8765", "http://localhost:8765", "http://127.0.0.1:3100", "http://localhost:3100")
    hosts: tuple[str, ...] = ("127.0.0.1", "localhost", "::1")
    secure_cookie: bool = False
    mobile_url: str | None = None
    mobile_access: str = "private"
    mock_interval: float = 0
    poll_seconds: float = 3
    frontend: Path = field(default_factory=lambda: ROOT / "frontend" / "out")

    @classmethod
    def from_env(cls):
        load_dotenv(ROOT / ".env")
        mode = os.getenv("WECHAT_ADAPTER", "mock")
        if mode not in ("mock", "windows-uia"):
            raise ValueError("WECHAT_ADAPTER must be mock or windows-uia")
        token = os.getenv("WECHAT_ACCESS_TOKEN", "").strip()
        if not token:
            path = ROOT / ".runtime" / "access-token.txt"
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with path.open("x", encoding="utf-8") as stream:
                    stream.write(secrets.token_urlsafe(32))
                if os.name != "nt":
                    path.chmod(0o600)
            except FileExistsError:
                pass
            token = path.read_text(encoding="utf-8").strip()
        if len(token) < 32:
            raise ValueError("WECHAT_ACCESS_TOKEN must contain at least 32 characters")
        origins = tuple(x.strip() for x in os.getenv("WECHAT_ALLOWED_ORIGINS", ",".join(cls.origins)).split(","))
        hosts = tuple(x.strip() for x in os.getenv("WECHAT_ALLOWED_HOSTS", ",".join(cls.hosts)).split(","))
        mobile_url = None
        mobile_access = "private"
        mobile_path = Path(os.getenv("WECHAT_MOBILE_CONFIG", str(ROOT / ".runtime/mobile.json")))
        if mobile_path.is_file():
            mobile = json.loads(mobile_path.read_text(encoding="utf-8-sig"))
            if mobile.get("enabled"):
                mobile_access = mobile.get("access_mode", "private")
                if mobile_access not in ("private", "public"):
                    raise ValueError("Invalid mobile access mode")
                url = urlsplit(mobile["url"])
                if url.scheme != "https" or not re.fullmatch(r"[a-z0-9-]+\.[a-z0-9-]+\.ts\.net", url.hostname or "") or url.port not in (None, 443, 8443) or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
                    raise ValueError("Invalid private mobile URL")
                mobile_url = f"https://{url.netloc}"
                origins = tuple(dict.fromkeys((*origins, mobile_url)))
                hosts = tuple(dict.fromkeys((*hosts, url.hostname)))
        return cls(
            db_path=ROOT / os.getenv("WECHAT_DB_PATH", f"data/{mode}.sqlite3"),
            token=token, adapter=mode,
            origins=origins, hosts=hosts, mobile_url=mobile_url, mobile_access=mobile_access,
            secure_cookie=os.getenv("WECHAT_SECURE_COOKIE", "false").lower() == "true",
            mock_interval=max(0, float(os.getenv("WECHAT_MOCK_INTERVAL", "0"))),
            poll_seconds=max(1, float(os.getenv("WECHAT_UI_POLL_SECONDS", "3"))),
        )
