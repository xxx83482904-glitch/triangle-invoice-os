"""Private bounded stdin/stdout RPC. SDK output never goes to application logs."""
from dataclasses import asdict
import json
import os
from pathlib import Path
import sys
from uuid import UUID

from .plus_core import PlusStore, PlusSupervisor

ROOT = Path(__file__).resolve().parents[3]
MAX_BYTES = 4 * 1024 * 1024


def main():
    wire = sys.stdout
    with open(os.devnull, "w", encoding="utf-8") as sink:
        sys.stdout = sys.stderr = sink
        # No license import or UI operation until the owner has run activation.
        if not (ROOT / ".runtime/wxautox4-activation.ready").is_file():
            return 2
        from .plus_sdk import PlusSDK
        from .wxauto4_worker import reader_mutex
        store = PlusStore(Path(os.environ["KOMOREBI_PLUS_STORE"]))
        supervisor = PlusSupervisor(lambda: PlusSDK(os.environ.get("KOMOREBI_PLUS_LANGUAGE", "en")), store,
                                    send_enabled=os.environ.get("KOMOREBI_PLUS_SEND") == "true",
                                    max_listeners=int(os.environ.get("KOMOREBI_PLUS_LIMIT", "8")))
        try:
            # Shared with the free reader: two adapters must not drive the same
            # WeChat desktop concurrently, even from different app instances.
            with reader_mutex():
                for _ in range(1000000):
                    line = sys.stdin.buffer.readline(65537)
                    if not line:
                        break
                    if len(line) > 65536:
                        break
                    try:
                        request = json.loads(line)
                        rid = str(UUID(request["id"]))
                        action = request["action"]
                        if action == "poll":
                            ack = request.get("ack", [])
                            if not isinstance(ack, list) or len(ack) > 100 or any(type(n) is not int or n < 1 for n in ack):
                                raise ValueError()
                            store.ack(ack)
                            supervisor.tick()
                            result = supervisor.snapshot()
                        elif action == "send":
                            qid = str(UUID(request["request_id"]))
                            content, chat = request["text"], request["chat_id"]
                            if not isinstance(content, str) or not 0 < len(content.strip()) <= 4000 or not isinstance(chat, str) or len(chat) > 200:
                                raise ValueError()
                            result = asdict(supervisor.send(qid, chat, content))
                        else:
                            raise ValueError()
                        encoded = json.dumps({"id": rid, "result": result}, ensure_ascii=False)
                        if len(encoded.encode()) > MAX_BYTES:
                            break
                        wire.write(encoded + "\n")
                        wire.flush()
                    except Exception:
                        break  # Fixed error at parent; never emit request/exception.
        finally:
            supervisor.close()
            store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
