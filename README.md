# kintone擬似AI v2 — FDE × kintone Backend × MCP

kintoneをバックエンドDBとして使い、生成AIが自然言語でkintoneを読み書きするWebアプリです。

- v1（2026.05 LT「kintone再定義論」）: kintoneを「作る場所」から「つなぐ基盤」へ。外部AIとAPI連携するデモとして作成
- v2（2026.10 LT「kintone再定義論 v2 — FDE時代のバックエンドデータ基盤として」）: スライドの3つの論点をアプリで実演できるようにブラッシュアップ

| v2スライドの論点 | アプリでの実演 |
| --- | --- |
| 即時性（スキーマ変更にマイグレーション不要） | kintoneのフォーム設定から**フィールドを自動同期**。kintoneで項目を足す → 「kintoneから同期」またはAIの問い合わせで即反映 |
| エンタープライズ品質（認証・権限・監査ログ） | **AI操作ポリシー**（アプリ側）と**kintone APIトークンの権限**（kintone側）の二段で統制し、AIの全操作を**AI操作ログ**に記録 |
| MCP × kintone × 生成AI（AIが直接CRUD） | **AIオペレーター**。AIがMCPと同じ形式のツールでkintoneを検索・登録・更新し、その実行トレースを画面に表示 |

## アーキテクチャ

```text
現場 / FDE ──自然言語──▶ 生成AI ──tool call──▶ ツール層（MCP相当） ──REST API──▶ kintone
                        Gemini API            ・AI操作ポリシー            データ・権限・変更履歴
                        （Claude APIも可）    ・フィールド公開範囲
                                              ・AI操作ログ
```

- ツール定義は MCP の `tools/list` と同じ `{ name, description, inputSchema }` 形式（[src/tools/kintoneTools.js](src/tools/kintoneTools.js)）
  - `kintone-get-form-fields` / `kintone-get-records` / `kintone-add-record` / `kintone-update-record`
  - 命名はサイボウズ公式 kintone MCPサーバーに倣っています
  - `GET /api/tools?appId=N` でAIに公開中のツールをMCP形式のJSONで確認できます
- LLMはユーザーごとに選択（[src/llm/](src/llm/)）
  - **Gemini API（既定）**: 公式SDK `@google/genai` の function calling。既定モデル `gemini-3.8-flash`
  - Claude API（任意）: 公式SDK `@anthropic-ai/sdk` の tool use。既定モデル `claude-opus-5`、安全性分類器で辞退されたときのサーバー側フォールバック有効
  - GitHub Models: 2026年7月30日に提供終了したため利用不可（選択肢には残し、警告を表示）

## 機能

- ユーザー認証（登録/ログイン/ログアウト）
- **AIオペレーター**（`/operator`）: 自然言語でkintoneを検索・登録・更新。ツール呼び出しのトレース（ツール名・入力・結果・所要時間）を表示
- **AI操作ログ**（`/audit`）: AIによる操作を「成功 / エラー / ポリシーで拒否 / kintone権限で拒否」に分けて記録
- **kintoneアプリ管理**（`/apps/manage`）
  - 接続先アプリ（ドメイン・アプリID）の登録
  - kintoneからのスキーマ同期（名称・種別・選択肢・必須）
  - フィールドごとの公開範囲（AIが読む / AIが書く）
  - AI操作ポリシー（読み取り / 登録 / 更新。既定は更新のみオフ）
- **トークン・AI設定**（`/tokens`）: 使用するAIの選択、Gemini APIキー・Claude APIキー・kintone APIトークン（アプリ別）の保存。DB内はAES-256-GCMで暗号化し、画面には末尾4桁のみ表示
- **1件登録**（`/records/new`）: 同期したスキーマから入力フォームを自動生成（選択肢はプルダウン、日付はカレンダー）
- **画面デザインの切り替え**: 画面右上の「デザイン」ドロップダウンで切り替え（選択はブラウザのCookieに保存）
  - v1 クラシック: 上部にボタンが並ぶ従来のデザイン
  - v2 Bridge（既定）: サイドバー＋ハンバーガーメニュー。kintone（イエロー）とAI（バイオレット）をつなぐ配色
  - v3 DevOps: 運用担当者向けのダークテーマ。ステータスバー（使用中のAI・接続アプリ数・直近24時間の拒否/エラー）、高密度の表、記号付きの状態表示、キーボード操作（`⌘K`/`Ctrl+K` コマンドパレット、`g`→キーで画面移動、`/` で入力欄へ）
- **レコード分析**（`/records/analyze`）: 自然言語の条件をkintoneクエリに変換して取得し、バックグラウンドでAI分析

## 1. 事前準備

1. `.env.example` を複製して `.env` を作成
2. `SESSION_SECRET` を安全な値へ変更
3. `TOKEN_ENCRYPTION_KEY_BASE64` を設定

鍵の作成例:

```bash
openssl rand -base64 32
```

## 2. 起動

Docker（Mac含む）:

```bash
docker compose up --build
```

ローカル:

```bash
npm install
npm run dev
```

起動後: <http://localhost:3000>

### 同じWi-Fiの他PC・スマートフォンから開く

サーバーはLAN側からの接続も受け付けます。起動したPCで次を実行すると、他端末から開くURLが表示されます（Dockerで起動した場合も、ホスト側で実行してください）。

```bash
npm run lan-url
# 例: http://192.168.1.23:3000
```

つながらないときは次を確認してください。

- 他端末が同じWi-Fiにつながっているか（ゲスト用Wi-Fiや、端末どうしの通信を禁止しているWi-Fi（公衆Wi-Fiなど）ではつながりません）
- macOSのファイアウォール（システム設定 → ネットワーク → ファイアウォール）で、Docker（ローカル起動なら node）への着信が許可されているか
- IPアドレスはWi-Fiにつなぎ直すと変わることがあります。変わったら `npm run lan-url` で確認し直してください

通信はHTTP（暗号化なし）です。自宅や社内など、信頼できるWi-Fiだけで使ってください。

## 3. 使い方

1. ユーザー登録・ログイン
1. 「アプリ管理」で接続するkintoneアプリ（ドメイン・アプリID・アプリ名）を登録
1. 「トークン・AI設定」で
   - 使用するAI（既定: Gemini API）を選び、APIキーを保存（Gemini APIキーは Google AI Studio で発行）
   - アプリごとにkintone APIトークンを保存（保存と同時にスキーマを同期）
1. 「アプリ管理」でAI操作ポリシーとフィールドの公開範囲を確認
1. 「AIオペレーター」で自然言語で依頼

kintone APIトークンに付与する権限の目安:

| やりたいこと | 必要な権限 |
| --- | --- |
| スキーマ同期・検索 | レコード閲覧 |
| AIによる登録 | レコード追加 |
| AIによる更新 | レコード編集 |

## 4. LTデモの流れ（例）

1. **即時性**: kintone側で項目（例: 「担当部署」）を追加 → 「kintoneから同期」を押す、またはAIオペレーターで「どんな項目がある？」と聞く → 項目が即反映される
2. **AIが直接CRUD**: 「さっきから画面が固まる、という問い合わせを優先度中で登録して」→ 実行トレースに `kintone-get-form-fields` → `kintone-add-record` が表示される
3. **ガバナンス**: 「期限切れのアラートを優先度緊急に変更して」
   - AI操作ポリシーで更新がオフ → ツール自体がAIに渡らず、AIは「許可されていない」と回答
   - ポリシーを更新オンにしても、APIトークンに編集権限がなければ「kintone権限で拒否」
   - どちらも「AI操作ログ」に記録される

デモ用CSVは `data/` にあります（`npm run generate:demo-csv` / `npm run generate:vague-reports` で再生成可能）。

## 5. 設定（環境変数）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini APIで使うモデル |
| `GEMINI_TIMEOUT_MS` | `120000` | Gemini APIのタイムアウト（1回の試行あたり） |
| `GEMINI_RETRY_ATTEMPTS` | `4` | 混雑（503）・レート制限（429）・500系のときの試行回数（初回を含む）。2秒→4秒→8秒…と間隔を広げて再試行 |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.6-flash` | 再試行しても混雑が続くときに切り替えるモデル。空にすると切り替えない |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Claude APIで使うモデル |
| `ANTHROPIC_EFFORT` | （空） | `low`〜`max`。空ならモデルの既定 |
| `ANTHROPIC_FALLBACKS` | `default` | `off` で辞退時のサーバー側フォールバックを無効化 |
| `AI_MAX_TOOL_STEPS` | `8` | 1回の依頼で呼べるツールの最大回数 |

## 6. 今後: MCPサーバー化

ツール層はMCPと同じ定義形式で実装しているため、[src/tools/kintoneTools.js](src/tools/kintoneTools.js) の `TOOL_DEFINITIONS` と `executeTool()` をMCPサーバーの `tools/list` / `tools/call` に接続すれば、Claude Desktop などのMCPクライアントから同じポリシー・同じ操作ログのもとでkintoneを操作できるようになります。

## 7. セキュリティ注意

- 本実装はローカル開発・デモ向け
- 本番利用時は以下を追加推奨
  - HTTPS
  - CSRF対策
  - レート制限
  - より厳格なパスワードポリシー
  - AIによる書き込み前の人間の承認フロー
