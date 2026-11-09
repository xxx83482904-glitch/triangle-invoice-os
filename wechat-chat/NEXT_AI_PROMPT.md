# 次のAIへ渡す依頼文

以下をそのまま渡してください。

---

このリポジトリの `wechat-chat/` にある「こもれび」を引き継いで開発してください。最初に `wechat-chat/AGENTS.md`、`AI_HANDOFF.md`、`WECHAT_INTEGRATION_STATUS.md`、`TEST_RESULTS.md` を読んでください。

リポジトリ: https://github.com/xxx83482904-glitch/triangle-invoice-os

ブランチ: `codex/komorebi-wechat-mvp`。mainではなく、このブランチの `wechat-chat/` を開いてください。

目的は、既存の個人WeChatアカウントの友達・グループとの会話を自作アプリから確認して返信することです。Mockの双方向チャット、Next.js PWA、FastAPI/SQLite、永続送信キュー、Windows常駐、携帯VPN不要のFunnel接続までは動作しています。最終の自動テストは54件成功です。**実WeChatの本文取得・チャット検出・実送信は未実装です。** Windows Adapterは接続診断だけなので、完成済みと誤認しないでください。

Windows版Weixinは検証時4.1.15.56でした。本人の手動ログイン後、まずUI Automationで読み取り可能な項目と安定した宛先IDを確立し、版別Readerを実装・検証してください。実送信は宛先・本文を指定した本人の許可後だけ行ってください。プロセス/DLL注入、認証回避、不正な復号、通信偽装は禁止です。

現在のWindows常駐と、このアプリのFunnel外部公開は本人が許可済みです。携帯で毎回Tailscaleを接続する運用には戻さないでください。接続キー、実稼働URL、DB、ログはGitに含めていません。元のPCのローカル設定から確認し、秘密をGitやPRに載せないでください。将来のAI連携は別Providerとして拡張し、本人の許可なく会話を外部AIへ送らないでください。

設計だけで終わらず、実装・起動・テストまで進め、成功・失敗・未検証を分けて報告してください。未取得履歴を完全同期と表示しないこと、宛先照合と確認不能時の自動再送禁止を維持してください。親の請求書アプリや他の作業者の変更を巻き込まず、mainへのマージやSynologyデプロイは勝手に行わないでください。

---
