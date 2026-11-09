import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from .base import Chat, Connection, DestinationMismatch, Message, Receipt, WeChatAdapter, now


class MockWeChatAdapter(WeChatAdapter):
    """Local simulator. Never contacts WeChat or any network service."""

    def __init__(self):
        self.online = False
        self.events: asyncio.Queue[Message] = asyncio.Queue()
        self.next_result = "confirmed"
        self.sent_count = 0
        self.chats = [
            Chat("mock:lin", "林 佳怡", "individual", "complete", "Mockのサンプル履歴をすべて取得済み。実際のWeChat履歴ではありません。"),
            Chat("mock:studio", "日中デザイン室", "group", "partial", "Mockの直近履歴のみ。これ以前の履歴は未取得です。", 5),
            Chat("mock:chen", "陳 浩", "individual", "complete", "Mockのサンプル履歴をすべて取得済み。"),
            Chat("mock:weekend", "週末の計画", "group", "partial", "Mockの直近履歴のみ。これ以前の履歴は未取得です。", 4),
            Chat("mock:yuki", "佐藤 ゆき", "individual", "complete", "Mockのサンプル履歴をすべて取得済み。"),
        ]
        rows = [
            ("mock:lin", "lin", "林 佳怡", "incoming", "おはよう！週末に見つけたカフェ、すごくよかったよ。", 42),
            ("mock:lin", "self", "自分", "outgoing", "気になる！どのあたり？", 40),
            ("mock:lin", "lin", "林 佳怡", "incoming", "蔵前の川沿い。窓が大きくて、午後の光がきれいだった ☀️", 38),
            ("mock:lin", "self", "自分", "outgoing", "いいね。今度、一緒に行こう。", 35),
            ("mock:lin", "lin", "林 佳怡", "incoming", "うん！土曜日の14時はどう？\nお店の場所、あとで送るね。", 3),
            ("mock:studio", "chen", "陳 浩", "incoming", "入口の素材サンプルが届きました。", 60),
            ("mock:studio", "lin", "林 佳怡", "incoming", "明日の打ち合わせ、10時からでお願いします。", 12),
            ("mock:chen", "chen", "陳 浩", "incoming", "資料を確認しました。ありがとうございます！", 68),
            ("mock:weekend", "yuki", "佐藤 ゆき", "incoming", "みんなで美術館に行かない？", 130),
            ("mock:yuki", "yuki", "佐藤 ゆき", "incoming", "また近いうちに、お茶しましょう 🍵", 1440),
        ]
        self.history: dict[str, list[Message]] = {c.external_id: [] for c in self.chats}
        for index, (chat, sender, name, direction, content, minutes) in enumerate(rows):
            stamp = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat(timespec="milliseconds")
            self.history[chat].append(Message(chat, content, sender, name, direction, stamp, f"mock:seed:{index}"))

    async def connect(self):
        self.online = True
        return await self.get_connection_status()

    async def disconnect(self):
        self.online = False

    async def get_connection_status(self):
        return Connection("connected" if self.online else "disconnected", "mock", "ローカルのシミュレーターに接続中" if self.online else "Mock接続を停止中", self.online, self.online, limitations=["サンプルデータです。実際のWeChatとは接続していません。"])

    async def get_chats(self):
        return list(self.chats) if self.online else []

    async def get_messages(self, chat_id):
        return list(self.history.get(chat_id, [])) if self.online else []

    async def inject(self, chat_id, content="新着メッセージのテストです。ちゃんと届いていますか？", external_id=None):
        if not self.online:
            raise ValueError("offline")
        chat = next((c for c in self.chats if c.external_id == chat_id), None)
        if chat is None:
            raise DestinationMismatch("destination_mismatch")
        message = Message(chat_id, content, "mock:friend", "林 佳怡" if chat.type == "group" else chat.name, "incoming", now(), external_id or f"mock:{uuid4()}")
        self.history[chat_id].append(message)
        await self.events.put(message)
        return message

    async def watch_messages(self):
        while True:
            yield await self.events.get()

    async def send_message(self, chat_id, text):
        if not self.online:
            return Receipt("failed", error="offline_before_send")
        # Exact stable identifier validation at the adapter boundary.
        if chat_id not in self.history:
            raise DestinationMismatch("destination_mismatch")
        outcome, self.next_result = self.next_result, "confirmed"
        self.sent_count += 1
        await asyncio.sleep(0.08)
        if outcome == "failed":
            return Receipt("failed", error="mock_send_failed")
        message = Message(chat_id, text, "self", "自分", "outgoing", now(), f"mock:sent:{uuid4()}")
        if outcome == "unknown":
            # Simulates a lost acknowledgement: deliberately do not offer a retry.
            return Receipt("unknown", error="acknowledgement_unavailable")
        self.history[chat_id].append(message)
        return Receipt("confirmed", message)
