"""Local read-only OCR smoke check. Outputs counts only, never screen text."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.adapters.base import AdapterError
from app.ocr_inbox import capture_local

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--language", choices=("ja", "zh-Hans-CN", "en-US"), default="ja")
args = parser.parse_args()
try:
    result = asyncio.run(capture_local(args.language))
    print(json.dumps({"state": "preview_available", "line_count": len(result["lines"]), "language": result["language"], "installed_languages": result["languages"], "can_auto_sync": False, "can_send": False}))
except AdapterError as error:
    print(json.dumps({"state": "unavailable", "error": str(error), "can_auto_sync": False, "can_send": False}))
    sys.exit(1)
except Exception:
    print(json.dumps({"state": "unavailable", "error": "ocr_capture_failed", "can_auto_sync": False, "can_send": False}))
    sys.exit(1)
