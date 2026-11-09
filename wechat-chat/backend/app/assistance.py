"""Local, deterministic assistance. No model, credentials, or network calls.

The provider boundary is intentionally separate from both the send queue and the
WeChat adapter. Suggestions have no authority to send messages or create tasks.
"""
import re
from datetime import datetime, timezone
from typing import Protocol


class AssistantProvider(Protocol):
    def assess(self, chat: dict, messages: list[dict], priority: str | None) -> dict: ...


class LocalRulesProvider:
    def assess(self, chat, messages, priority=None):
        incoming = [m for m in messages if m["direction"] == "incoming"]
        source = incoming[-1] if incoming else None
        last = messages[-1] if messages else None
        unresolved = any(m["direction"] == "outgoing" and m.get("message_type") != "ocr_text" and m.get("identity_quality") != "uia_runtime" and m["delivery_status"] in ("pending", "sending", "unknown", "failed") for m in messages)
        confirmed = max((m["id"] for m in messages if m["direction"] == "outgoing" and m["delivery_status"] == "confirmed"), default=0)
        text = source["content"] if source else ""
        question = bool(re.search(r"[?？]|どう|お願い|ください|確認して|教えて|できます|能否|请|麻烦", text))
        urgent = bool(re.search(r"至急|急ぎ|本日|今日|明日|締[め切]*切|期限|urgent|asap|今天|明天|尽快|截止", text, re.I))
        no_hurry = bool(re.search(r"急ぎません|急がなく|急ぎでは|不要急|不急|no rush", text, re.I))
        candidate = bool(source and source["id"] > confirmed and (question or (urgent and not no_hurry)))
        age_hours = 0
        if source:
            try:
                stamp = datetime.fromisoformat(source["timestamp"] or "")
                if stamp.tzinfo is not None:
                    age_hours = max(0, (datetime.now(timezone.utc) - stamp).total_seconds() / 3600)
            except (ValueError, TypeError):
                pass
        reasons = []
        inferred = "low"
        if unresolved:
            state, inferred = "review_send", "high"
            reasons.append("未確定または失敗した送信があります。送信状態の確認を優先してください。")
        elif candidate:
            state, inferred = "reply_candidate", "normal"
            if urgent and not no_hurry:
                inferred = "high"
                reasons.append("期限・急ぎに関する語句があります。実際の期限は本文で確認してください。")
            if question:
                reasons.append("質問・依頼に使われる表現を検出しました。")
            if age_hours >= 24:
                inferred = "high" if not no_hurry else "normal"
                reasons.append("この受信から24時間以上経過しています。")
            if no_hurry:
                reasons.append("急ぎではない旨の表現があります。")
            if chat["type"] == "group":
                reasons.append("グループの発言です。あなたへの依頼か確認してください。")
        else:
            state = "no_candidate"
            reasons.append("簡易ルールで返信候補を検出していません。返信不要の確定ではありません。")
        if chat["sync_status"] != "complete":
            reasons.append("取得済みの一部履歴だけを参照しています。")
        if source and source["timestamp_quality"] != "exact":
            reasons.append("メッセージの正確な日時は取得できていません。")
        if source and source.get("message_type") == "ocr_text":
            reasons.append("画面OCRの手動取り込みです。誤認識・不足・取り込み順による影響があります。")
        if priority:
            reasons.insert(0, "あなたが指定した優先度を使用しています。")
        suggestions = []
        if source and not unresolved:
            # Templates never accept an appointment, price, or deadline on behalf
            # of the user, and never claim that work has already been completed.
            suggestions = [
                {"label": "確認して返事", "text": "ご連絡ありがとうございます。内容を確認して、改めてお返事します。"},
                {"label": "期限を確認", "text": "ありがとうございます。いつまでにお返事すればよいか、教えていただけますか？"},
                {"label": "短く返す", "text": "ありがとう！確認してから返事するね。"},
            ]
        return {
            "chat_id": chat["id"], "chat_name": chat["name"], "chat_type": chat["type"],
            "source_message_id": source["id"] if source else None,
            "source_content": text[:2000], "source_at": source["timestamp"] if source else None,
            "latest_message_id": last["id"] if last else None,
            "priority": priority or inferred, "priority_origin": "manual" if priority else "rule",
            "state": state, "reasons": reasons, "suggestions": suggestions,
            "task_title": f"{chat['name']}：内容を確認して返信する"[:200] if source else None,
        }


def attention_snapshot(db, provider: AssistantProvider):
    with db.lock:
        overrides = {r["chat_id"]: r["priority"] for r in db.all("SELECT * FROM chat_priorities")}
        items = [provider.assess(chat, db.messages(chat["id"], limit=50), overrides.get(chat["id"])) for chat in db.chats()]
    return {"provider": "local_rules", "ai_connected": False, "history_scope": "stored_recent_50", "items": items}
