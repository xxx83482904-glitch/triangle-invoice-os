"""Isolated Mock-only server. Never reads .env, user token or real message databases."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from app.config import Settings
from app.main import create_app

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="komorebi-e2e-") as folder:
        settings = Settings(db_path=Path(folder) / "test.sqlite3", token="e2e-mock-only-" + "x" * 40, origins=("http://127.0.0.1:8877",), hosts=("127.0.0.1",))
        uvicorn.run(create_app(settings), host="127.0.0.1", port=8877, access_log=False, log_level="warning")
