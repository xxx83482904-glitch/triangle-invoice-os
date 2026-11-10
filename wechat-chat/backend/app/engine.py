import asyncio
from contextlib import suppress
from dataclasses import asdict

from .adapters.base import Connection, DestinationMismatch
from .adapters.mock import MockWeChatAdapter


class EventHub:
    def __init__(self):
        self.listeners: set[asyncio.Queue] = set()
        self.sequence = 0

    def publish(self, kind="refresh", chat_id=None):
        self.sequence += 1
        event = {"type": kind, "sequence": self.sequence, "chat_id": chat_id}
        for queue in tuple(self.listeners):
            if queue.full():
                queue.get_nowait()  # Events are invalidations, not the source of truth.
            queue.put_nowait(event)


class Engine:
    def __init__(self, db, adapter, settings):
        self.db, self.adapter, self.settings = db, adapter, settings
        self.hub = EventHub()
        self.tasks = []
        self.adapter_lock = asyncio.Lock()
        self.worker_busy = False
        self.last_connection = ""
        self.sync_error = None

    async def start(self):
        try:
            await self.adapter.connect()
            await self.sync()
        except Exception:
            self.sync_error = "adapter_connection_failed"
            self.db.connection("error", self.sync_error)
        self.tasks = [asyncio.create_task(self.worker()), asyncio.create_task(self.watch()), asyncio.create_task(self.monitor()), asyncio.create_task(self.media_worker())]
        if isinstance(self.adapter, MockWeChatAdapter) and self.settings.mock_interval > 0:
            self.tasks.append(asyncio.create_task(self.simulate()))

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            with suppress(asyncio.CancelledError):
                await task
        await self.adapter.disconnect()

    async def status(self):
        try:
            result = asdict(await self.adapter.get_connection_status())
        except Exception:
            result = asdict(Connection("error", self.settings.adapter, "接続状態を確認できません"))
        result["sync_error"] = self.sync_error
        result["queue_pending"] = self.db.one("SELECT COUNT(*) AS n FROM send_queue WHERE status IN ('pending','sending')")["n"]
        result["unknown_count"] = self.db.one("SELECT COUNT(*) AS n FROM send_queue WHERE status='unknown'")["n"]
        return result

    async def sync(self, only_id=None):
        async with self.adapter_lock:
            connection = await self.adapter.get_connection_status()
            if not connection.can_read:
                self.db.connection(connection.state)
                return
            for chat in await self.adapter.get_chats():
                ident = self.db.upsert_chat(chat)
                if only_id and ident != only_id:
                    continue
                rows = await self.adapter.get_messages(chat.external_id)
                for message in rows:
                    self.db.ingest(message)
                self.db.sync_complete(ident, rows[-1].external_message_id if rows else None)
            self.sync_error = None
        self.hub.publish()

    async def watch(self):
        while True:
            try:
                async for message in self.adapter.watch_messages():
                    if not self.db.one("SELECT id FROM chats WHERE external_id=?", (message.chat_id,)):
                        # A real reader can discover the conversation the owner
                        # just opened after startup. Persist its verified metadata
                        # before ingesting the first event for that conversation.
                        await self.sync()
                        if not self.db.one("SELECT id FROM chats WHERE external_id=?", (message.chat_id,)):
                            raise RuntimeError("chat_metadata_unavailable")
                    if self.db.ingest(message):
                        chat = self.db.one("SELECT id FROM chats WHERE external_id=?", (message.chat_id,))
                        if chat:
                            self.db.sync_complete(chat["id"], message.external_message_id)
                        self.hub.publish("message", chat["id"] if chat else None)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.sync_error = "reader_unavailable"
                self.db.connection("error", self.sync_error)
                self.hub.publish("status")
                await asyncio.sleep(3)

    async def worker(self):
        while True:
            try:
                status = await self.adapter.get_connection_status()
                if status.state != "connected" or not status.can_send:
                    await asyncio.sleep(0.25)
                    continue
                async with self.adapter_lock:
                    item = self.db.claim()
                    if item:
                        self.worker_busy = True
                        self.hub.publish("queue", item["chat_id"])
                        await self.deliver(item)
                        self.worker_busy = False
                await asyncio.sleep(0.15 if self.settings.adapter == "mock" else 2)
            except asyncio.CancelledError:
                raise
            except Exception:
                # Fixed code only: never log exception text containing chat data.
                self.sync_error = "queue_worker_unavailable"
                self.hub.publish("status")
                await asyncio.sleep(1)

    async def deliver(self, item):
        chat = self.db.chat(item["chat_id"])
        if not chat or chat["external_id"] != item["expected_external_id"] or chat["name"] != item["expected_name"]:
            self.db.finish(item, "failed", "destination_mismatch")
            self.hub.publish("queue", item["chat_id"])
            return
        try:
            # Recheck adapter discovery immediately before handing off to the sender.
            matches = [c for c in await self.adapter.get_chats() if c.external_id == item["expected_external_id"] and c.name == item["expected_name"]]
            if len(matches) != 1:
                raise DestinationMismatch("destination_mismatch")
            receipt = await self.adapter.send_queued_message(chat["external_id"], item["content"], item["id"])
            if receipt.status == "confirmed" and (not receipt.message or receipt.message.chat_id != chat["external_id"] or receipt.message.content != item["content"] or receipt.message.direction != "outgoing"):
                self.db.finish(item, "unknown", "invalid_receipt")
            else:
                self.db.finish(item, receipt.status, receipt.error, receipt.message if receipt.status == "confirmed" else None)
        except DestinationMismatch:
            self.db.finish(item, "failed", "destination_mismatch")
        except asyncio.CancelledError:
            self.db.finish(item, "unknown", "interrupted_during_send")
            raise
        except Exception:
            self.db.finish(item, "unknown", "send_result_unavailable")
        self.hub.publish("queue", item["chat_id"])

    async def monitor(self):
        while True:
            try:
                connection = await self.adapter.get_connection_status()
                key = connection.state + connection.detail + str(connection.monitoring)
                if key != self.last_connection:
                    self.last_connection = key
                    self.db.connection(connection.state)
                    self.hub.publish("status")
                    if connection.can_read:
                        await self.sync()
            except Exception:
                self.db.connection("error", "monitor_unavailable")
                self.hub.publish("status")
            await asyncio.sleep(2)

    async def media_worker(self):
        """Only explicit authenticated read requests enter this bounded queue."""
        while True:
            item = None
            try:
                async with self.adapter_lock:
                    item = self.db.claim_attachment()
                    if item:
                        self.hub.publish("message", item["chat_id"])
                        status = await self.adapter.get_connection_status()
                        if not status.can_read:
                            raise ValueError("source_unavailable")
                        message = await self.adapter.fetch_attachment(item["external_id"], item["source_key"])
                        if (message.chat_id != item["external_id"] or message.source_key != item["source_key"]
                                or not message.attachment or message.attachment.get("id") != item["id"]
                                or message.attachment.get("status") not in ("ready", "failed", "unavailable", "too_large")):
                            raise ValueError("source_unavailable")
                        self.db.ingest(message)
            except asyncio.CancelledError:
                if item:
                    self.db.fail_attachment(item["id"], "interrupted")
                raise
            except Exception:
                if item:
                    self.db.fail_attachment(item["id"])
            finally:
                if item:
                    self.hub.publish("message", item["chat_id"])
            await asyncio.sleep(0.2 if self.settings.adapter == "mock" else 5 if item else 0.5)

    async def simulate(self):
        while True:
            await asyncio.sleep(max(3, self.settings.mock_interval))
            if self.adapter.online:
                await self.adapter.inject("mock:studio")
