# セキュリティ強化（2026-10-31、PR-0）

対象: `src/lib/store.ts`（本番利用者の定数）、`src/app/api/admin/deploy/route.ts`（自己デプロイの認証）、`src/lib/auth.ts`（セッション秘密鍵）、`eslint.config.mjs`、`docs/codex-handoff.md`。

## 変更

1. **本番利用者の認証情報をソースから除去**（`src/lib/release-users.ts`）。管理者・郵便担当のメールアドレスとパスワードの文字列定数を削除し、`RELEASE_ADMIN_EMAIL` / `RELEASE_ADMIN_PASSWORD` / `RELEASE_MAIL_EDITOR_EMAIL` / `RELEASE_MAIL_EDITOR_PASSWORD` から読む。挙動は「そのアドレス（または旧ID・旧アドレス）の利用者が存在しないときだけ作成」に変更し、既存利用者の名前・役割・パスワード・削除状態を読み込みごとに強制的に戻す処理を廃止した。環境変数が未設定なら何も作らない。デモ用アカウント（`*@triangle.local`）の退役は従来どおり。
2. **自己デプロイの固定ハッシュを削除**（`src/lib/deploy-auth.ts`）。`ALLOW_SELF_DEPLOY=true` かつ `DEPLOY_TOKEN`（32文字以上）が設定されている場合だけ有効。比較は従来どおり `timingSafeEqual`。10分間に5回失敗すると、その後の試行を 429 で拒否する（プロセス内カウンター。成功で解除）。
3. `SESSION_SECRET` 未設定で本番起動したときに1回だけ警告ログを出す（既定値の使用は変えていない）。
4. `eslint.config.mjs` に `tmp/**` を追加（ローカルの検証用コピーが lint 対象に入らない）。
5. `docs/codex-handoff.md` を `docs/archive/codex-handoff-2026-06.md` へ移し、旧公開URL・LAN IP・デモ用パスワード・ポートの行を削除し、先頭に「現役ではない」注記を付けた。

## デプロイ前の前提条件（必ず確認）

この PR を `main` に入れてデプロイすると、NAS 側の環境変数が揃っていない場合は自己デプロイが止まる。事前に NAS（Container Manager の環境変数）で次を確認する。

- `ALLOW_SELF_DEPLOY=true`
- `DEPLOY_TOKEN`: 32文字以上で、GitHub Secrets の `TRIANGLE_DEPLOY_TOKEN` と同じ値。未設定・不一致なら、両方を同時に新しい値へ再発行する。
- `SESSION_SECRET`: 設定済みか（未設定でも動くが警告が出る。設定すると既存のログインは一度切れる）。
- `RELEASE_*`: 本番の利用者はすでに存在するので未設定でよい。設定する場合も既存利用者は変更されない。

デプロイ後に本番でパスワード変更を行うこと（旧パスワードは公開リポジトリの履歴に残っている）。履歴の書き換え（`git filter-repo`）はリポジトリの private 化の後に別作業で行う。

## 変更しないこと

- 本番データ・利用者レコードは書き換えない。
- 鍵・トークンの値はこの PR では扱わない（ユーザーが NAS と GitHub Secrets で設定する）。

## 検証

```powershell
node --conditions=react-server --import tsx --test tests/security-hardening.test.ts
node --conditions=react-server --import tsx --test tests/*.test.ts
npx eslint src tests scripts
npx tsc --noEmit
```

ローカルの standalone 起動で、`ALLOW_SELF_DEPLOY` 未設定なら `/api/admin/deploy` が 404、設定済みで誤ったトークンなら 403、5回失敗後は 429 になることを確認する。合成データで `RELEASE_*` 未設定のとき本番利用者が注入されないことも確認する。
