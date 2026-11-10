"""Read-only inventory of an owner-selected WeChat backup.

Reads at most 16 header bytes per file. Does not decode protected payloads,
read process memory, extract archives, or manufacture chats/messages.
"""
from collections import Counter
import os
from pathlib import Path
import stat

from .adapters.base import now


def inspect_backup(root: Path, *, max_files=100000, header_samples_per_kind=32, progress=None):
    root = Path(root).absolute()
    def linked(path):
        info = path.lstat()
        return path.is_symlink() or bool(getattr(info,'st_file_attributes',0) & 0x400)
    if not root.is_dir() or any(linked(p) for p in (root,*root.parents)):
        raise ValueError('backup_path_unavailable')
    if not (root/'backup.attr').is_file() or not (root/'files').is_dir():
        raise ValueError('unsupported_backup_layout')
    report = dict(format='wechat_native',started_at=now(),complete=False,inventory_complete=False,
                  files=0,logical_bytes=0,session_candidates=0,header_counts={},kind_counts={},
                  unreadable=0,skipped_links=0,changed_files=0,imported_messages=0,
                  sampled_headers=0,header_sample_limit_per_kind=header_samples_per_kind,
                  reason='native_backup_requires_wechat')
    headers, kinds, sessions = Counter(),Counter(),set()
    samples=Counter()
    pending=[root]
    stopped=False
    while pending and not stopped:
        directory=pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    p=Path(entry.path)
                    try:
                        info=entry.stat(follow_symlinks=False)
                        if entry.is_symlink() or getattr(info,'st_file_attributes',0)&0x400:
                            report['skipped_links']+=1
                            continue
                        if stat.S_ISDIR(info.st_mode):
                            pending.append(p)
                            if p.name=='ChatPackage':
                                sessions.add(str(p.parent.relative_to(root)))
                            continue
                        if not stat.S_ISREG(info.st_mode):
                            continue
                        if report['files'] >= max_files:
                            stopped=True
                            break
                        report['files']+=1
                        report['logical_bytes']+=info.st_size
                        kind=next((k for k in ('ChatPackage','Index','Media') if k in p.relative_to(root).parts),'metadata')
                        kinds[kind]+=1
                        # Large native backups need a full inventory, not a full
                        # payload read. Format classification is explicitly sampled.
                        if samples[kind] < header_samples_per_kind:
                            with p.open('rb') as stream:
                                header=stream.read(16)
                            after=p.stat()
                            report['changed_files']+=int((info.st_size,info.st_mtime_ns)!=(after.st_size,after.st_mtime_ns))
                            samples[kind]+=1
                            report['sampled_headers']+=1
                            headers['rmfh' if header.startswith(b'RMFH') else 'sqlite' if header==b'SQLite format 3\0'
                                    else 'zip' if header.startswith(b'PK\x03\x04') else 'other']+=1
                        if progress and report['files']%1000==0:
                            progress(report['files'])
                    except OSError:
                        report['unreadable']+=1
        except OSError:
            report['unreadable']+=1
    report.update(inspected_at=now(),inventory_complete=not stopped and not report['unreadable'] and not report['skipped_links'] and not report['changed_files'],
                  session_candidates=len(sessions),header_counts=dict(headers),kind_counts=dict(kinds))
    return report
