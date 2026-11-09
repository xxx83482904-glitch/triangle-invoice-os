from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator, Literal


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@dataclass
class Chat:
    external_id: str
    name: str
    type: Literal["individual", "group"]
    sync_status: str = "partial"
    history_note: str = "取得できた範囲のみ。全履歴の同期は保証されません。"
    member_count: int | None = None


@dataclass
class Message:
    chat_id: str  # adapter's external chat id
    content: str
    sender_id: str
    sender_name: str
    direction: Literal["incoming", "outgoing"]
    timestamp: str | None
    external_message_id: str | None = None
    message_type: str = "text"
    occurrence: str = ""  # stable UI occurrence marker, when available
    timestamp_quality: str = "exact"
    source_key: str | None = None  # Local observation identity, never a WeChat message ID.
    identity_quality: str | None = None
    delivery_status: str | None = None


@dataclass
class Connection:
    state: str
    mode: str
    detail: str
    can_send: bool = False
    can_read: bool = False
    version: str | None = None
    limitations: list[str] = field(default_factory=list)
    monitoring: dict | None = None


@dataclass
class Receipt:
    status: Literal["confirmed", "unknown", "failed"]
    message: Message | None = None
    error: str | None = None


class AdapterError(Exception):
    """Only fixed, non-sensitive error codes may leave an adapter."""


class DestinationMismatch(AdapterError):
    pass


class WeChatAdapter(ABC):
    @abstractmethod
    async def connect(self) -> Connection: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def get_chats(self) -> list[Chat]: ...

    @abstractmethod
    async def get_messages(self, chat_id: str) -> list[Message]: ...

    @abstractmethod
    def watch_messages(self) -> AsyncIterator[Message]: ...

    @abstractmethod
    async def send_message(self, chat_id: str, text: str) -> Receipt: ...

    async def send_queued_message(self, chat_id: str, text: str, request_id: str) -> Receipt:
        """Persistent queue identity is available to adapters with an IPC sender."""
        return await self.send_message(chat_id, text)

    @abstractmethod
    async def get_connection_status(self) -> Connection: ...
