# TRIANGLE Invoice OS

社内向けの請求書・受領請求書・入金・支払い管理アプリです。請求書を単なるPDFではなく、案件ごとの売上、入金、受領請求、支払い、粗利を追うためのInvoice OSとして構成しています。

## 実装済みMVP

- ログイン、ロール管理、権限チェック
- ダッシュボード
- クライアント管理、支払先管理
- 案件一覧、案件詳細、案件別の契約額・請求・入金・支払い・粗利
- 発行請求書作成、税率別計算、PDF出力
- 入金登録、一部入金、複数回入金
- 受領請求書PDF/JPEG/PNGアップロード、案件・支払先紐づけ、簡易重複検知
- 受領請求書ステータス変更、支払い登録
- 月別・案件別・取引先別レポート
- CSVエクスポート
- AuditLog記録
- PostgreSQL向けPrisma schema

## ローカル起動

```bash
npm install
copy .env.example .env
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

デモユーザー:

- `admin@triangle.local` / `password123`
- `accounting@triangle.local` / `password123`
- `pm@triangle.local` / `password123`
- `designer@triangle.local` / `password123`

## PostgreSQL / Prisma

MVPの画面はすぐ触れるように `data/app-data.json` へ保存するローカルデータ層で動きます。Prisma schemaは本番DB移行用の契約として用意しています。

PostgreSQLを起動する場合:

```bash
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
```

将来的に `src/lib/store.ts` のリポジトリ実装をPrismaへ差し替える想定です。DBスキーマは `prisma/schema.prisma` にあります。

## ファイル保存

受領請求書はローカル開発では `public/uploads/received-invoices` に保存します。保存処理は `src/app/api/uploads/received-invoices/route.ts` に集約しているため、本番ではS3互換ストレージのアダプターへ差し替えやすい構成です。

## セキュリティ

- ログイン必須
- ロールベースアクセス制御
- アップロードはPDF/JPEG/PNGのみ許可
- 10MBファイルサイズ制限
- 請求書番号の重複禁止
- `vendorId + total + issueDate` の受領請求書重複検知
- 主要な作成、更新、支払い、アップロードはAuditLogへ記録
- 削除はsoft delete前提のデータモデル

## 今後の拡張TODO

- Prismaリポジトリへの完全移行
- OCR読み取りキューと `ocrText` の自動更新
- 外部業者専用アップロードURL
- Gmail/メール取り込み
- freee、マネーフォワード連携
- 銀行口座API連携
- 自動リマインドメール
- AIによる請求書チェック
- 電子帳簿保存法を意識した保管ポリシー強化
