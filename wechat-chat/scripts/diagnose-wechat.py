"""Run with .venv/Scripts/python.exe scripts/diagnose-wechat.py.
Only prints connection state/version/counts, never account names or message text.
"""
import asyncio
from dataclasses import asdict
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.adapters.windows_uia import WindowsUIAAdapter


async def main():
    adapter = WindowsUIAAdapter()
    result = await adapter.connect()
    print(json.dumps({"connection": asdict(result), "diagnostic": adapter.diagnostic}, ensure_ascii=True, indent=2))
    await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
