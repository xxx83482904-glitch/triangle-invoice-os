"""Serve the existing local database without starting a WeChat UI adapter."""
import asyncio

from .base import Connection, Receipt, WeChatAdapter


class StoredHistoryAdapter(WeChatAdapter):
    def __init__(self, source_mode):
        self.source_mode = source_mode

    async def connect(self):
        return await self.get_connection_status()

    async def disconnect(self):
        pass

    async def get_chats(self):
        return []

    async def get_messages(self, chat_id):
        return []

    async def watch_messages(self):
        await asyncio.Event().wait()
        # An async generator with no emitted messages; cancellation stops it.
        if False:
            yield

    async def send_message(self, chat_id, text):
        return Receipt('failed', error='ui_access_disabled')

    async def get_connection_status(self):
        return Connection('disconnected', self.source_mode,
            '画面経由のWeChat連携は無効です。保存済みの会話を閲覧できます。',
            limitations=['新着の取得・画面の巡回・送信は停止しています。',
                         'ファイルからの履歴直接インポートは未対応です。'])
