"""Manual OCR adapter. It deliberately provides no unattended sync or sending."""
import asyncio

from .base import AdapterError, Connection, Receipt, WeChatAdapter


class WindowsOCRAdapter(WeChatAdapter):
    def __init__(self):
        self.active = False

    async def connect(self):
        self.active = True
        return await self.get_connection_status()

    async def disconnect(self):
        self.active = False

    async def get_chats(self):
        return []  # Reviewed imports are stored by the OCR inbox transaction.

    async def get_messages(self, chat_id):
        raise AdapterError("ocr_manual_review_required")

    async def watch_messages(self):
        while True:
            await asyncio.sleep(60)
            if not self.active:
                return
            # Keep the adapter's async iterator contract without inventing events.
            if False:
                yield None

    async def send_message(self, chat_id, text):
        return Receipt("failed", error="real_sending_not_validated")

    async def get_connection_status(self):
        return Connection(
            "limited" if self.active else "disconnected", "windows-ocr",
            "画面OCRは手動取り込みです。設定から表示中の会話を読み取り、確認して保存してください。自動同期・送信は停止しています。",
            limitations=["表示中の文字だけが対象です。全チャット・過去履歴の自動同期は未対応です。", "OCRには誤認識があります。本文・会話・送信者・方向を保存前に確認してください。", "WeChatのID・正確な日時・配信結果は取得しません。同じ文章の再投稿を区別できない場合があります。"],
        )
