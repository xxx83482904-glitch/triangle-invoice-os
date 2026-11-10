"""Inspect a native backup without modifying it. Reports never contain paths/body."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.backup_inspector import inspect_backup

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--report',type=Path)
    parser.add_argument('--database',type=Path,help='Existing real Plus database; writes aggregate inspection only')
    args=parser.parse_args()
    try:
        report=inspect_backup(args.source)
        if args.report:
            target=args.report.resolve()
            if target.is_relative_to(args.source.resolve()):
                raise ValueError('report_must_be_outside_backup')
            target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        if args.database:
            if not args.database.is_file() or args.database.resolve().is_relative_to(args.source.resolve()):
                raise ValueError('existing_app_database_required')
            # The app must already have applied migration 009.
            import sqlite3
            with sqlite3.connect(args.database) as db:
                if db.execute("SELECT value FROM metadata WHERE key='adapter'").fetchone()!=('wxautox4',):
                    raise ValueError('real_plus_database_required')
                db.execute('INSERT INTO backup_inspections(inspected_at,report) VALUES(?,?)',
                           (report['inspected_at'],json.dumps(report,ensure_ascii=False)))
        print(json.dumps(report,ensure_ascii=True))
    except (ValueError,OSError):
        print(json.dumps({'error':'backup_inspection_failed','imported_messages':0}))
        return 1
    return 0

if __name__=='__main__':
    raise SystemExit(main())
