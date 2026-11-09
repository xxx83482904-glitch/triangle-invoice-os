"""Run with both apps stopped. Prints counts only, never chat contents."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.reader_archive import import_reader_archive

parser = argparse.ArgumentParser(description="Copy a free Reader DB into a new Plus DB, retaining old history as an archive.")
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
try:
    print(json.dumps(import_reader_archive(args.source, args.destination)))
except (ValueError, OSError):
    raise SystemExit("Archive import refused. Use a real Reader DB with an empty queue and a new destination path.") from None
