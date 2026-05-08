# kintone擬似AI

kintoneアプリと連携するローカルWebアプリです。以下を実装しています。

- ユーザー認証（登録/ログイン/ログアウト）
- ユーザーごとのAPIトークン管理
  - kintone APIトークン（アプリごと）
  - GitHub Copilot分析用トークン
  - DB内はAES-256-GCMで暗号化保存
- アクセス先kintoneアプリ管理（全ユーザー共通）
  - kintoneドメイン
  - kintoneアプリID
  - アプリ名
  - フィールド名 / フィールド種別 / フィールドコード / POST・GET対象フラグ
- kintoneへの1件登録（POST）
- kintoneレコード一覧取得（GET）+ バックグラウンド分析

## 1. 事前準備

1. `.env.example` を複製して `.env` を作成
2. `SESSION_SECRET` を安全な値へ変更
3. `TOKEN_ENCRYPTION_KEY_BASE64` を設定

鍵の作成例:

```bash
openssl rand -base64 32
```

## 2. Dockerで起動（Mac含む）

```bash
docker compose up --build
```

起動後: <http://localhost:3000>

## 3. 使い方

1. ユーザー登録・ログイン

1. kintoneアプリ管理ページで共通利用するkintoneアプリ情報を登録

1. APIトークン管理ページで、GitHub Copilot分析用トークン（ユーザー単位）とkintone APIトークン（ユーザー × アプリ単位）を保存

1. 1件登録ページで対象アプリを選択し、record JSON を入力してPOST

1. レコード分析ページで対象アプリとqueryを指定して分析ジョブ開始

## 4. 分析の実装メモ

- 分析APIは `COPILOT_API_BASE` に対して `POST /chat/completions` を実行
- デフォルトは GitHub Models 互換の `https://models.inference.ai.azure.com`
- 利用するトークンの権限要件は組織設定に依存

## 5. セキュリティ注意

- 本実装はローカル開発向け
- 本番利用時は以下を追加推奨
  - HTTPS
  - CSRF対策
  - レート制限
  - 監査ログ
  - より厳格なパスワードポリシー
