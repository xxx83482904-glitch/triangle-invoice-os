"""Isolated Mock-only server. Never reads .env, user token or real message databases."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from app.config import Settings
from app.main import create_app
import app.main as main_module
from app.security import Security
from test_ai import SyntheticProvider


class BrowserTestSecurity(Security):
    def rate_limit(self, key, limit=10, interval=60):
        # Many isolated browser contexts sign in within a minute. Production
        # limits and all failed-login / send / AI limits remain unchanged.
        return super().rate_limit(key, 100 if key == "login-success" else limit, interval)

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="komorebi-e2e-") as folder:
        settings = Settings(db_path=Path(folder) / "test.sqlite3", token="e2e-mock-only-" + "x" * 40, origins=("http://127.0.0.1:8877",), hosts=("127.0.0.1",), ai_enabled=True, wxauto_trial_report=Path(folder)/"no-real-trial.json")
        main_module.Security = BrowserTestSecurity
        uvicorn.run(create_app(settings, ai_provider=SyntheticProvider()), host="127.0.0.1", port=8877, access_log=False, log_level="warning")
