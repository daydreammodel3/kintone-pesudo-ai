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
- **ゲストログイン**: プレゼン用。ログイン画面から1クリックで、ダッシュボードと分析結果を閲覧のみで確認（[3. 使い方](#3-使い方)）
- **同じWi-Fiの他端末からのアクセス**: スマートフォン表示に対応。HTTPS（mkcert）も利用可（[2. 運用手順](#2-運用手順)）

## 1. 事前準備（最初に1回だけ）

### 1-1. 環境変数

1. `.env.example` を複製して `.env` を作成
2. `SESSION_SECRET` を安全な値へ変更
3. `TOKEN_ENCRYPTION_KEY_BASE64` を設定

鍵の作成例:

```bash
openssl rand -base64 32
```

### 1-2. Mac側のツール

アプリ本体はDockerで動きますが、URLの表示や証明書の作成はMac側で実行します。

```bash
npm install          # npm run lan-url / npm run https:cert / npm run mdns-alias を使うため
brew install mkcert  # HTTPSを使う場合
mkcert -install      # HTTPSを使う場合。Macのパスワードを求められます
```

### 1-3. 開く端末に認証局を入れる（HTTPSを使う場合・端末ごとに1回だけ）

HTTPSは、Macの中に作った自分専用の認証局（mkcert）で発行した証明書で配信します。インターネットには公開されません。認証局を入れていない端末では、HTTPSのURLを開くと警告が出ます。

アプリを起動したあと（[2-1. 起動](#2-1-起動)）、端末のブラウザで `http://<MacのIP>:3000/ca.crt` を開いて、認証局の証明書を入れてください。一度入れておけば、IPアドレスが変わって証明書を作り直しても、入れ直す必要はありません。

- **iPhone / iPad**: Safariで開く →「許可」→ 設定 → 一般 → VPNとデバイス管理 →「mkcert development CA」をインストール → 設定 → 一般 → 情報 → 証明書信頼設定 で「mkcert development CA」をオンにする
- **Android**: ダウンロード後、設定 → セキュリティ → 暗号化と認証情報 → 証明書のインストール →「CA証明書」を選んで、ダウンロードした `ca.crt` を選ぶ（メニューの名前は機種によって異なります）
- **Windows**: ダウンロードした `ca.crt` をダブルクリック →「証明書のインストール」→ 保存場所に「信頼されたルート証明機関」を選ぶ
- **Mac（このMac以外）**: ダウンロードした `ca.crt` をダブルクリックしてキーチェーンに追加 → 証明書を開き「信頼」を「常に信頼」にする

## 2. 運用手順

### 2-1. 起動

```bash
npm run https:cert          # HTTPSを使う場合。前回からIPアドレスが変わっていなければ省略可
docker compose up -d --build
npm run lan-url             # 他の端末から開くURLを表示
npm run mdns-alias          # https://kinpai.local:3443 で開けるようにする（別のターミナルで動かしたままにする）
```

表示例:

```text
同じWi-Fiの他PC・スマートフォンから、次のURLを開いてください:
  http://192.168.1.23:3000
HTTPS:
  https://kinpai.local:3443
  https://mysterio.local:3443
  https://192.168.1.23:3443
```

- このMacからは <http://localhost:3000>（HTTPSは <https://localhost:3443>）
- `https://kinpai.local:3443` は、Macの名前とは別に `npm run mdns-alias` で公開する別名です。動かしている間だけ開けて、止める（Ctrl+C）と消えます。別名は `.env` の `MDNS_ALIAS` で変えられます
- `https://kinpai.local:3443`・`https://<Macの名前>.local:3443` はIPアドレスが変わっても同じURLで開けます（iPhone・Mac・Windows）。Androidでは開けないことがあるため、IPアドレスのURLを使ってください
- 起動できたかは `docker compose logs -f` で確認できます（`listening on https://…` が出ていればHTTPSも有効）
- HTTPS（3443）は、起動したときに証明書があれば有効になります。起動したあとで、はじめて `npm run https:cert` を実行したときだけ、`docker compose restart` で起動し直してください

Dockerを使わない場合は `npm run dev` で起動します（他端末から開くURLは起動ログに表示されます）。

### 2-2. 終了

```bash
docker compose down
```

- ユーザー・設定・操作ログは `data/` に保存されているため、終了しても消えません
- プレゼンが終わったら、端末に入れた認証局を削除してください（iPhoneは 設定 → 一般 → VPNとデバイス管理 から削除）。認証局を入れた端末は、このMacの認証局で発行した証明書をすべて信頼します

### 2-3. IPアドレスが変わるたびにやること

会場のWi-Fiにつないだとき、Wi-Fiにつなぎ直したときは、IPアドレスが変わることがあります。

```bash
npm run https:cert   # 新しいIPアドレスで証明書を作り直す（HTTPSを使う場合）
npm run lan-url      # 新しいURLを確認して、参加者に伝える
```

- アプリの再起動は不要です。作り直した証明書は、起動中のサーバーが数秒で自動的に読み込みます（`docker compose logs` に「HTTPS証明書を読み込み直しました。」と出ます）
- 端末側の認証局の入れ直しは不要です
- `npm run mdns-alias` は新しいIPアドレスで自動的に公開し直します（起動し直しは不要）
- `https://kinpai.local:3443`・`https://<Macの名前>.local:3443` を使っている端末は、URLも変わりません

### 2-4. つながらないとき

- URLが `https://…:3000` になっていないか（3000はHTTP専用。HTTPSは3443）。ブラウザが自動で `https://` を補うことがあるので、`http://` から入力してください
- 他の端末が同じWi-Fiにつながっているか。ゲスト用Wi-Fiや公衆Wi-Fi、社内Wi-Fiなど、端末どうしの通信を禁止しているWi-Fiではつながりません。テザリングなど別のネットワークを使ってください
- macOSのファイアウォール（システム設定 → ネットワーク → ファイアウォール）で、Docker（`npm run dev` なら node）への着信が許可されているか
- `kinpai.local` で開けない: `npm run mdns-alias` を動かしたままにしているか。HTTPSで警告が出る場合は、別名を追加する前に作った証明書かもしれないので `npm run https:cert` で作り直す
- HTTPSで警告が出る: その端末に認証局が入っていない（[1-3](#1-3-開く端末に認証局を入れるhttpsを使う場合端末ごとに1回だけ)）か、IPアドレスが変わったのに証明書を作り直していない（[2-3](#2-3-ipアドレスが変わるたびにやること)）

HTTP（3000）の通信は暗号化されません。信頼できるWi-Fiで使うか、HTTPS（3443）を使ってください。認証局の秘密鍵（`mkcert -CAROOT` の場所にある `rootCA-key.pem`）はMacから外に出さないでください。アプリが配るのは公開証明書（`ca.crt`）だけです。

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

### ゲスト（プレゼン用・閲覧のみ）

ログイン画面の「ゲストとしてログイン（閲覧のみ）」を押すと、パスワードなしでログインできます。ゲストはマネージャー視点で、全ユーザー分の次の画面だけを閲覧できます。

- ダッシュボード（接続アプリ数・AI操作の件数・最近のAI操作・最近の分析ジョブ）
- レコード分析の結果

AIオペレーター、1件登録、分析の実行、アプリ管理、トークン・AI設定、AI操作ログは使えません。ゲストのボタンは常に表示されるため、アプリを開ける人は誰でも上記を閲覧できます。社外に公開する環境では注意してください。

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
| `PORT` | `3000` | HTTPのポート |
| `HTTPS_PORT` | `3443` | HTTPSのポート（`npm run https:cert` で証明書を作ったときだけ有効） |
| `MDNS_ALIAS` | `kinpai` | `npm run mdns-alias` で公開する別名（`<別名>.local`）。証明書にも入る。空にすると使わない |

## 6. 今後: MCPサーバー化

ツール層はMCPと同じ定義形式で実装しているため、[src/tools/kintoneTools.js](src/tools/kintoneTools.js) の `TOOL_DEFINITIONS` と `executeTool()` をMCPサーバーの `tools/list` / `tools/call` に接続すれば、Claude Desktop などのMCPクライアントから同じポリシー・同じ操作ログのもとでkintoneを操作できるようになります。

## 7. セキュリティ注意

- 本実装はローカル開発・デモ向け
- 本番利用時は以下を追加推奨
  - 正式な証明書によるHTTPS（本リポジトリのmkcert方式は同じWi-Fi内のデモ用）
  - CSRF対策
  - レート制限
  - より厳格なパスワードポリシー
  - AIによる書き込み前の人間の承認フロー
