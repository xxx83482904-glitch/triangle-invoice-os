# Windowsセットアップ

現在は本人の指示で画面経由の取得を無効にしています。常駐版は `WECHAT_UI_ACCESS_ENABLED=false` のまま、既存のadapter/DBパスを維持してください。保存済み会話を閲覧できますが、新規取得・送信は停止します。[直接取込の調査結果](LOCAL_HISTORY_STORAGE.md)。

wxautox4 Plusへの移行は [Plus専用のセットアップ・認証・実機検証手順](WXAUTOX4_PLUS.md) を参照してください。このPCでは本人の明示許可で公式認証と読み取り検証を完了しています。別PCではそのPCの正規認証が必要です。

## Mockモード

```powershell
# リポジトリのルートから
cd wechat-chat
.\scripts\setup.ps1
.\scripts\start.ps1
```

`setup.ps1` は仮想環境作成、固定依存のインストール、未作成なら `.env.example` から `.env` の作成、Next.js本番ビルドを実行します。既存 `.env` は上書きしません。

`start.ps1` は隠れた常駐監視プロセスを起動し、正常性を確認後にブラウザを開きます。`-NoBrowser` でブラウザを開かず起動できます。起動済みなら二重起動せず状態を確認します。別のアプリが8765ポートを使用中なら起動せず、そのアプリを終了しません。停止は `stop.ps1` を使います。

## Windowsログイン時に自動起動する

```powershell
.\scripts\install-resident.ps1
.\.venv\Scripts\python.exe scripts/resident.py status
.\scripts\stop.ps1                  # 今回の常駐を停止。次回ログイン時には再開
.\scripts\start.ps1 -NoBrowser      # 今すぐ再開
.\scripts\uninstall-resident.ps1    # 自動起動の解除と停止。データは保持
```

本人のスタートアップフォルダーに `Komorebi Chat.lnk` を登録します。管理者権限やWindowsサービスは使いません。WeChatのUI操作に必要な対話ユーザーセッションで起動します。WeChatのログインは引き続き本人が行います。Windowsの再起動後は**Windowsにログインしてから**起動します。無人ログインやパスワード保存は設定しません。

`resident.py` は単一インスタンスのロック、バックエンドの状態監視、異常終了後の再起動（1〜30秒の待機）を行います。監視プロセス自体が終了した場合はWindows Job Objectで子プロセスを終了し、取り残しを防ぎます。監視プロセス自体の自動再起動は次回ログインまたは `start.ps1` です。起動コードだけを `.runtime/resident/lifecycle.log` に記録し、本文・接続キーは記録しません。

再起動時、送信途中のメッセージは「確認不能」とし自動再送しません。PCのスリープ設定は変更していません。携帯から使う間はPCを起動・接続状態に保ってください。ロック画面での将来の実WeChat UI操作は別途検証が必要です。

起動後に `.runtime/access-token.txt` を本人がエディターで開き、接続画面へコピーしてください。キーはログに表示しません。ブラウザのセッションは12時間、バックエンド再起動またはログアウトで失効します。

## スクリプトを使わない起動

PowerShellの実行ポリシーを変更する必要はありません。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-lock.txt
Copy-Item .env.example .env  # .envが未作成の場合だけ
cd frontend
npm ci
npm run build
cd ..\backend
..\.venv\Scripts\python.exe run.py
```

`http://127.0.0.1:8765` を開きます。手動起動はターミナルでCtrl+Cで停止します。以降はインストール・ビルド不要で `backend/run.py` を起動できます。

## 開発

`dev.ps1` でFastAPI 8765とNext.js 3100を起動します。フロントエンドはホットリロード、Pythonコード変更後は停止・再起動してください。開発サーバーをリモート公開しないでください。

## 無料wxauto4による実会話の読み取り

[無料Readerの手順](WXAUTO4_READER.md) に従って隔離依存を導入し、`WECHAT_ADAPTER=wxauto4` と専用の `data/wxauto4.sqlite3` を設定します。現在はWeixin 4.1.8.107の英語UIで実機検証済みです。PCで開いた会話のテキストだけを取り込み、実送信は無効です。

WeChat自体の再起動・アカウント変更後は自動で履歴を結合せず停止します。再バインドは未対応です。アプリだけの再起動では保存済み履歴・内部IDを保持します。Readerのキャッシュにも本文が含まれるため、DBと同様に `.runtime/` を非公開で保管してください。

## Windows版WeChat診断

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-windows.txt
.\.venv\Scripts\python.exe scripts/diagnose-wechat.py
```

診断はプロセス数・ファイルバージョン・UI応答・ログイン待機の有無のみを出力します。本文、アカウント名、認証情報は出力しません。ウィンドウ操作・ログイン・メッセージ送信はしません。

アプリ設定の「WeChatの読み取りを診断」は、Mockモードのまま使用できます。診断専用モードとして起動する場合のみ、停止後に `.env` を次のように編集します。

```dotenv
WECHAT_ADAPTER=windows-uia
WECHAT_DB_PATH=data/windows-uia.sqlite3
```

Mockとは別のDBが必要です。既存DBのAdapter種別が違う場合は起動を拒否します。現在は接続診断までの対応なので、切り替えても実チャットは表示されません。詳細は [連携状況](../WECHAT_INTEGRATION_STATUS.md) を参照してください。

表示中の会話を確認して手動保存する補助機能は [画面OCRの手順](SCREEN_OCR.md) を使用します。`setup.ps1 -WithOcr` で任意依存を追加し、`windows-ocr` モードと専用DBで起動します。自動同期の代わりではありません。

## よくある状態

無料wxauto4を試す場合は [専用のセットアップと再検証](FREE_WXAUTO4_TRIAL.md) を使用してください。`setup-wxauto4.ps1` で隔離環境に導入します。検証だけで稼働中のAdapter・DB・送信設定は変更しません。

| 状態 | 対応 |
|---|---|
| バックエンドに接続できない | 8765の起動、`.runtime/backend.err.log` を確認 |
| 接続キー不一致 | `.env` に明示キーがあるか確認。なければ `.runtime/access-token.txt` |
| Originが拒否される | 開いているURLを `.env` の許可URLに完全一致で追加し再起動 |
| WeChatログイン待機 | 正規クライアントで手動ログイン。アプリは認証を操作しない |
| WeChatのウィンドウなし | 本人がWeChatを表示。トレイにあるだけではUI取得できない場合がある |
| 未対応UI | 検証済みセレクター・宛先IDが未確立。送受信を有効にしない |
| 確認不能 | WeChat側を本人が確認。自動再送はしない |

## 保存先とバックアップ

本文は `data/*.sqlite3`、実行中の変更はSQLiteの `-wal` / `-shm` にあります。バックアップはアプリを停止してからDBをコピーしてください。起動中にDBファイルだけをコピーしないでください。キー・DBはGit対象外です。OSのディスク暗号化と本人専用のファイル権限を使ってください。

## 他の端末から使う場合

初期状態はlocalhost専用です。このPCでは本人の許可を得てFunnelを有効化し、携帯のVPNが不要なHTTPS接続に切り替えています。アプリの閲覧・管理・送信APIは引き続き接続キー認証が必要です。[携帯セットアップ](MOBILE_SETUP.md) に公開・解除・プライベート接続へ戻す手順を記載しています。ルーターの公開ポート転送は不要です。
