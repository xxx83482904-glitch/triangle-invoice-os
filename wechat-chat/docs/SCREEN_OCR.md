# WeChat画面OCRの使い方

このPCではWindows版Weixin 4.1.15.56と、本人が変更した4.1.8.107の両方で、ログイン後にUI Automationへ会話の部品が公開されず、本文の自動取得ができませんでした。表示中の文字をWindows標準OCRで読む**手動取り込み**は補助機能です。双方向同期の完成版ではなく、恒久的な同期方式とも位置づけていません。OCRの実機検証は4.1.15.56で行っています。

## セットアップ

正規のWeChatで本人が手動ログインしてください。WeChatのダウングレード、認証の自動化、メモリ読み出しやDB復号は行いません。

```powershell
cd wechat-chat
.\scripts\setup.ps1 -WithOcr
.\scripts\stop.ps1
```

`.env` の次の2項目だけを変更します。接続キーや携帯用設定は保持してください。

```dotenv
WECHAT_ADAPTER=windows-ocr
WECHAT_DB_PATH=data/windows-ocr.sqlite3
```

```powershell
.\scripts\start.ps1 -NoBrowser
```

Mockに戻す場合は `WECHAT_ADAPTER=mock` と `WECHAT_DB_PATH=data/mock.sqlite3` に戻して再起動します。モードごとの履歴は別DBに保存されます。既存環境では `pip install -r backend/requirements-ocr.txt` だけでOCR依存を追加できます。

## 取り込み

1. PCのWeChatで対象の会話を開きます。ウィンドウを最小化しないでください。PCがロック中・スリープ中の場合は使用できません。
2. 携帯またはPCの「こもれび」で「設定」→「画面から取り込む」を開きます。
3. 日本語・中国語（簡体字）・英語から画面に合うOCR言語を選び、「表示中のWeChatを読み取る」を押します。WindowsにそのOCR言語が必要です。
4. 「読み取った画面を確認」で対象を確認します。左の会話一覧や画像内の文字も認識されるため、**メッセージ1件の本文に相当する行だけ**を選びます。複数行を選ぶと1件として結合されます。
5. 保存先、個人／グループ、送受信、送信者、本文を確認・修正し、確認欄をチェックして保存します。同名会話の自動結合はありません。既存の会話へ追加する際は保存先を選んでください。
6. 保存した会話を開くと、検索・優先度・定型返信案・タスクを利用できます。**WeChatへの実送信は無効です。**

この機能はPC内のPillow `PrintWindow` による対象HWNDの画像取得と、Windows `Windows.Media.Ocr` を使用します。デスクトップ全体の画像取得にフォールバックしません。画像をクラウドOCR・LLMへ送りません。認証済みのアプリ画面には確認用画像と文字が配信されます。画像はファイル・DB・ログには保存しません。プレビューは最大2件、保存期限5分。期限切れはAPIで即拒否し、サーバーメモリは30秒周期でも破棄します。

## 精度・取得範囲

- 自動監視ではありません。画面外の会話・過去履歴・新着を自動収集しません。必要な範囲を本人が表示して取り込みます。
- OCRには誤認識があります。名前、絵文字、改行、混在言語、画像中の文字には特に注意してください。認識精度を保証しません。
- WeChatのアカウントID・チャットID・メッセージIDは取れません。保存先は利用者が選ぶローカルIDです。実アカウントを切り替えた場合は既存会話に混ぜず、別DBを使ってください。
- 正確な発言日時を推測せず、`timestamp=NULL` / `timestamp_quality=unavailable` とします。画面を取得した時刻は `observed_at` に記録します。古い履歴を新着時刻として扱う意味ではありません。
- 会話の並び順は取り込んだ順の影響を受けます。返信優先度も部分的な手動データを参照する簡易判定で、OCRや取り込み順の誤りに影響されます。
- 同じ会話に対する同じ認識文＋画面内の同文出現順は重複保存を防ぎます。同時に見えている同文2件は別の出現順として扱います。スクロール、再投稿、別言語・別の認識結果では誤った抑制や重複が起こり得ます。完全な重複排除とは扱いません。
- 自分の発言を取り込んでも配信成功は確認できません。キューに入れず、配信結果未取得と表示します。通信断後の保存の再確認は同じ受付IDで行い、WeChatへの再送は発生しません。
- 対象ウィンドウを一意に特定できない、最小化、非表示、画面切替、ロック・入力デスクトップ不明、対応外サイズでは読み取りを中止します。画面サイズからログイン済みとは推定しません。最終的な対象と本文の照合は保存前の確認画面で行います。

## 診断（本文を出力しない）

```powershell
.\.venv\Scripts\python.exe scripts/diagnose-ocr.py --language ja
```

出力は成功・失敗、言語と行数のみです。内部の `windows_ocr_capture` モジュールは非公開のプロセス間通信用であり、直接CLI実行すると画面データを標準出力に出すため、診断には使わないでください。

検証環境はWindows 11 / Python 3.10.6 / Pillow 12.3.0（MIT-CMU）/ PyWinRT 3.2.1（MIT）。Python 3.10との互換性のためPyWinRT 3.2.1を固定しています。Windows OCRは [Microsoftのドキュメント](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr?view=winrt-26100) でパッケージIDを持つデスクトップアプリ向けとされており、今回の通常Python環境では実行できたものの、別のWindows環境・将来版での利用は未検証です。対応しない場合はエラーにし、クラウドOCRへ自動転送しません。

依存元: [PyWinRT](https://github.com/pywinrt/pywinrt)、[Pillow ImageGrab](https://pillow.readthedocs.io/en/stable/reference/ImageGrab.html)、[Windows OCRの言語](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.trycreatefromlanguage?view=winrt-26100)。
