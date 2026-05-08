kintone REST APIは、kintoneのアプリやレコード、スペースを操作できるAPIです。  
このページでは、kintone REST APIの共通仕様を説明します。  
各APIの仕様の詳細は、それぞれのAPIのページを確認してください。

### リクエスト

#### HTTPメソッド

APIによって異なります。

#### URL

`RESOURCE`は、APIによって異なります。  
詳細は各APIのページを確認してください。

通常（ゲストスペース以外）
: https\://sample.cybozu.com/k/v1/`RESOURCE`

ゲストスペース
: https\://sample.cybozu.com/k/guest/`SPACE_ID`/v1/`RESOURCE`

#### リクエストヘッダー

送信するリクエストに応じて次のリクエストヘッダーを指定します。  
kintone REST APIリクエストを送信するAPI（`kintone.api()`）を使って、kintone REST APIを実行する場合、リクエストヘッダーの指定は不要です。  
[kintone REST APIリクエストを送信するAPI](https://cybozu.dev/ja/id/84b51223dd9e63a226e3e985/)

##### Host

kintone REST APIを実行するドメインとポート番号（443）を、「ドメイン:ポート番号」の形式で指定します。  
Hostは必須です。

##### Content-Type

指定する値はリクエストボディの形式によって異なります。

- JSON文字列の場合：application/json
- マルチパートの場合：multipart/form-data

リクエストボディを送信する場合のみ指定します。

##### X-Cybozu-Authorization

「ログイン名:パスワード」をBase64エンコードした値を指定します。  
パスワードを使って認証する場合のみ指定します。  
パスワード認証の詳細は、次のページを参照してください。  
[パスワード認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#password)

##### X-Cybozu-API-Token

kintoneのAPIトークンを指定します。  
APIトークンを使って認証する場合のみ指定します。  
APIトークン認証の詳細は、次のページを参照してください。  
[APIトークン認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#api-token)

##### X-Requested-With

「XMLHttpRequest」または空文字列以外の文字列を指定します。  
セッションで認証する場合のみ指定します。  
セッション認証の詳細は、次のページを参照してください。  
[セッション認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#session)

##### Authorization

次の値を半角スペースで結合した値を指定します。

- Basic
- 「Basic認証のユーザー名:Basic認証のパスワード」をBase64エンコードした値

Basic認証を設定している場合のみ指定します。  
Basic認証を設定している環境でのリクエスト方法は、次のページを参照してください。  
[Basic認証を設定している環境](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#basic-authentication)

##### X-HTTP-Method-Override

実行するAPIのHTTPメソッド（GET／POST／PUT／DELETEのいずれか）を大文字で指定します。  
このヘッダーにHTTPメソッドを指定してPOSTリクエストを送信すると、指定したHTTPメソッドに対応するAPIが実行されます。

リクエストURLが8KBを超える場合に指定すると、Request URL Too Largeエラーを回避できます。  

たとえば、次のリクエスト例はレコードを複数取得するAPIを実行できます。

```shell
curl -X POST https://sample.cybozu.com/k/v1/records.json \
  -H 'X-Cybozu-Authorization: QWRtaW5pc3RyYXRvcjpjeWJvenU=' \
  -H 'Content-Type: application/json'  \
  -H 'X-HTTP-Method-Override: GET' \
  -d '{ "app": 1, "query": "更新日時 > \"2024-02-03T09:00:00Z\"" }'
```

このヘッダーは、すべてのkintone REST APIで利用できます。  
ただし、外部のAPIを実行するAPIでkintone REST APIを実行したときの動作はサポートしていません。  
[外部のAPIを実行する](https://cybozu.dev/ja/id/c9377c4b54b8cf6acca21283/)

##### Accept-Language

cybozu.comで利用できる表示言語の言語コードを指定します。  
表示言語が「Webブラウザーの設定に従う」の場合、このヘッダーで指定した言語がレスポンスボディの言語に反映されます。

リクエスト結果の表示言語を指定したい場合のみ指定します。

#### リクエストボディ

JSON形式で指定します。文字コードはUTF-8です。  
ただし、ファイルをアップロードするAPIはマルチパート形式で指定します。  
[ファイルをアップロードするAPI](https://cybozu.dev/ja/id/bb1225dd8d192245c3645a95/)

JSON文字列でエスケープが必要な文字は、`\`でエスケープしてください。

#### クエリパラメーター

GETメソッドのAPIでは、URLのクエリパラメーターとしてリクエストパラメーターを付与し、リクエストを送信できます。  
たとえばリクエストパラメーターの`app`が「1」の場合、クエリパラメーターは次のように指定します。

```plaintext
/k/v1/records.json?app=1
```

##### エスケープ

URLの仕様に従い、クエリパラメーターのキーや値はパーセントエンコーディングします。  
以下は、クエリパラメーターの「更新日時 &#62; "2024-10-01T09:00:00+0900"」をパーセントエンコーディングした例です。

```plaintext
/k/v1/records.json?app=1&query=%e6%9b%b4%e6%96%b0%e6%97%a5%e6%99%82%20%3E%20%222024-10-01T09%3A00%3A00%2B0900%22%20
```

##### 配列型のパラメーターを指定する場合

配列を要素に分解してパーセントエンコーディングします。

リクエストパラメーターの`fields`に、「レコード番号」と「ドロップダウン」を指定する例を示します。  

1. `fields=[レコード番号,ドロップボックス]`という配列を要素に分解します。

    ```plaintext
    /k/v1/records.json?app=1&fields[0]=レコード番号&fields[1]=ドロップダウン
    ```

1. クエリパラメーターのキーや値をパーセントエンコーディングします。

    ```plaintext
    /k/v1/records.json?app=1&fields%5B1%5D=%e4%bd%9c%e6%88%90%e6%97%a5%e6%99%82&fields%5B2%5D=%e3%83%89%e3%83%ad%e3%83%83%e3%83%97%e3%83%80%e3%82%a6%e3%83%b3
    ```

### レスポンス

#### HTTPステータスコード

リクエストに成功した場合、200番台のステータスコードが返ります。  
リクエストに失敗した場合、200番台以外のステータスコードとエラーレスポンスが返ります。  
[エラーレスポンス](#response-error)

#### レスポンスヘッダー

##### X-ConcurrencyLimit-Limit

同時接続数の上限値です。  
必ず100が返ります。

##### X-ConcurrencyLimit-Running

現在の同時接続数です。

##### kintone REST APIリクエストを送信するAPIで実行した場合

kintone REST APIリクエストを送信するAPIを使って、kintone REST APIを実行した場合、コールバック関数に渡される情報は、レスポンスボディだけです。  
レスポンスボディ以外の情報を利用する場合には、kintone REST APIリクエストを送信するAPI（`kintone.api()`）以外の方法で、kintone REST APIを実行してください。  
[kintone REST APIリクエストを送信するAPI](https://cybozu.dev/ja/id/84b51223dd9e63a226e3e985/)

#### レスポンスボディ

JSON形式で返されます。文字コードはUTF-8です。  
ただし、ファイルをダウンロードするAPIでは、バイナリデータが返されます。  
[ファイルをダウンロードするAPI](https://cybozu.dev/ja/id/c5da2ff7d17ed3b5764a4a3f/)

#### エラーレスポンス

次のプロパティをもつオブジェクトがJSON形式で返されます。

| パラメーター名 | 型 | 説明 |
|:---|:---|:---|
| id | 文字列 |エラーID<br>サポートへの問い合わせの際に利用します。 |
| code | 文字列 |エラーの種類を表すコード |
| message | 文字列 | エラーメッセージ<br>出力されるメッセージの言語は、APIを実行したユーザーの表示言語の設定によって異なります。<br>[表示言語の設定](https://jp.kintone.help/general/ja/id/020410) |

##### エラーの例

```json
```

### 日時のフォーマット

日時を扱うフィールドでは、次の形式の文字列を指定してください。

#### 日付

フォーマット
: `YYYY-MM-DD`

補足
: 次の形式も許容されます。
  
  - `YYYY`（例：2024）
  - `YYYY-MM`（例：2024-07）
  - `YYYY-M`（例：2024-7）
  - `YYYY-M-D`（例：2024-7-5）
  
: 月日を省略すると01で補完され、桁数が足りない場合は0埋めされます。
  
  - 2024 → 2024-01-01
  - 2024-07 → 2024-07-01
  - 2024-7 → 2024-07-01
  - 2024-7-5 → 2024-07-05
  

#### 時刻

フォーマット
: `HH:MM`

補足
: UTCには変換されません。

#### 日時（取得するとき）

フォーマット
: `YYYY-MM-DDTHH:MM:SSZ`

補足
: たとえば、日本時間（JST）の2024年3月22日14時00分は、「2024-03-22T05:00:00Z」と表します。  
  「YYYY-MM-DD」と「HH:MM:SS」の間の「T」や、「HH:MM:SS」の後ろの「Z」は固定値です。  
  「Z」はUTCを表します。
: 「T」以降を省略した場合、UTC 0時の指定と同等です。  
  例：2024-03-22を指定した場合、2024-03-22T00:00:00Zと同等になります。
: 一覧の設定を取得するAPIでは、日時はUTCで出力されます。  
  [一覧の設定を取得するAPI](https://cybozu.dev/ja/id/c4c5befe425032f6c36b9c4b/)

#### 日時（登録または更新するとき）

フォーマット
: `YYYY-MM-DDTHH:MM:SS±HH:MM`または`YYYY-MM-DDTHH:MM:SSZ`

補足
: たとえば、日本時間（JST）の2024年3月22日14時17分は、次のように表します。  
「2024-03-22T14:17:00+09:00」「2024-03-22T05:17:00Z」
: 「YYYY-MM-DD」と「HH:MM:SS」の間の「T」や、「HH:MM:SS」の後ろの「Z」は固定値です。
: 「±HH:MM」には、UTCとの時刻の差を指定します。
: 「T」以降を省略した場合、UTC 0時の指定と同等です。  
  例：2024-03-22を指定した場合、2024-03-22T00:00:00Zと同等になります。
: 秒情報を指定して登録または更新すると、秒情報は無視されます。  
  たとえば、「2024-02-06T12:59:59Z」と指定すると、「2024-02-06T12:59:00Z」として登録または更新されます。

### 注意事項

- リクエストデータ、およびレスポンスデータのJSONフォーマットには、今後フィールドやキーなどが追加される場合があります。
- REST APIを実行すると監査ログに記録されます。  
  [kintoneの監査ログの確認方法](https://jp.kintone.help/k/ja/id/04054#other_audit_logs_2095)

### 制限事項

#### 同時接続数

同時にリクエストできるAPIは、1ドメインにつき100までです。  
上限を超えるアクセスがあった場合、利用を制限させていただく場合がございます。

#### 1日に実行できるAPIリクエスト数

1つのアプリにつき実行できるAPIのリクエスト数の上限は、次のとおりです。

- スタンダードコース：10,000件
- ワイドコース：100,000件

##### 対象外のAPIリクエスト

また、次のリクエストは、1日に実行できるAPIリクエスト数としてカウントされません。

- [スペースの使用状況を取得する](https://cybozu.dev/ja/id/8d2d6e955eea07f32b8af62d/)
- [アプリの使用状況を取得する](https://cybozu.dev/ja/id/87b9a4d7093e6c78b1dff270/)
- [プラグインを追加しているアプリの一覧を取得する](https://cybozu.dev/ja/id/d756f228bad9ca044866aed0/)
- [インストールが必要なプラグインの一覧を取得する](https://cybozu.dev/ja/id/56524ae67a377d756e329bd2/)
- [スペースのスレッドを作成する](https://cybozu.dev/ja/id/24a2ad8d0fb574f3617e1b92/)
- [インストール済みのプラグインの一覧を取得する](https://cybozu.dev/ja/id/ace5777d9375efed42500278/)
- [スペースの設定を変更する](https://cybozu.dev/ja/id/d85a81945868db8c288a3b11/)
- [プラグインを更新する](https://cybozu.dev/ja/ja/id/4c0e93986f6a7c08033d874f/)
- [プラグインをアンインストールする](https://cybozu.dev/ja/id/8c2031cc1081afd160007699/)
- [スペースを作成する](https://cybozu.dev/ja/id/cfe546ad1afd18ba02685c8f/)
- [プラグインを読み込む](https://cybozu.dev/ja/id/6806ccee84420bfaf17ae74f/)
- [kintone REST APIの一覧を取得する](https://cybozu.dev/ja/id/b9eb79547d5b2eb184d56b7f/)
- [kintone REST APIのスキーマ情報を取得する](https://cybozu.dev/ja/id/0e51c5da54396a7a916f10b5/)
- [ファイルをアップロードする](https://cybozu.dev/ja/id/bb1225dd8d192245c3645a95/)
- [ファイルをダウンロードする](https://cybozu.dev/ja/id/c5da2ff7d17ed3b5764a4a3f/)
- [複数のアプリの情報を取得する](https://cybozu.dev/ja/id/bc9738cfc60c75502dedfc20/)
- [動作テスト環境にアプリを作成する](https://cybozu.dev/ja/id/be316bcfaa096d7943d4e669/)
- [複数アプリのレコード操作を一括処理する](https://cybozu.dev/ja/id/bc41b4cb11864e868abd2eb2/)
- [スペースの情報を取得する](https://cybozu.dev/ja/id/6e2a365943e303fbb30f01de/)
- [テンプレートからスペースを作成する](https://cybozu.dev/ja/id/d8ea4eaea0b2fc619ba7c782/)
- [スペースを削除する](https://cybozu.dev/ja/id/f64a35f9aad6459095e4dc17/)
- [スペースのメンバーとスペース管理者の情報を取得する](https://cybozu.dev/ja/id/febe6f4eb7efa2f2c77f583d/)
- [スペースのメンバーを更新する](https://cybozu.dev/ja/id/9227d39612c7a78c9161ad53/)
- [スペースの本文を更新する](https://cybozu.dev/ja/id/cf580126da2b465115ded1e6/)
- [スペースのスレッドを更新する](https://cybozu.dev/ja/id/030c46e9b685a5eee19637f0/)
- [スペースのスレッドにコメントを投稿する](https://cybozu.dev/ja/id/bcacb3ceff7039b39222ebb4/)
- [ゲストスペースのゲストメンバーを更新する](https://cybozu.dev/ja/id/712234897391d75133c3d464/)
- [ゲストユーザーを削除する](https://cybozu.dev/ja/id/943e420d94eb3d018df68d28/)
- [ゲストユーザーを追加する](https://cybozu.dev/ja/id/29318cb3da48dfeb065b884d/)

#### レコードを操作するAPI

- 複数のレコードを取得するAPIの`offset`で指定できるレコードの上限数は、10,000件までです。  
  [複数のレコードを取得するAPI](https://cybozu.dev/ja/id/ba1703e9391653c667ce958b/)
- 一度に登録／更新／削除できるレコードは、100件までです。
- 1つのテーブルに大量の行を追加しないでください。  
  アプリの構成によっては負荷がかかり、レコードの表示やREST APIを使った操作などのレコードの処理に影響します。  
  kintoneの性能を考慮したレコードの操作方法は、次のTipsを参照してください。  
  [kintoneの性能改善](https://cybozu.dev/ja/id/379066ca3ffad9ce665dae4e/#performance-knowhow)
- 存在しないフィールドコードを指定して、レコードを取得／登録／更新した場合でも、存在しないフィールドコードは無視されて処理されます。
- 次のフィールドは、値の取得のみです。登録や更新はできません。
  - ルックアップフィールドによって値が入力されるフィールド
  - カテゴリー
  - 計算
  - ステータス  
    更新する場合は、レコードのステータスを更新するAPIを使います。  
    [レコードのステータスを更新するAPI](https://cybozu.dev/ja/id/ff1f30dda4461d5bb807af27/)
  - 作業者  
    更新する場合は、レコードの作業者を更新するAPIを使います。  
    [レコードの作業者を更新するAPI](https://cybozu.dev/ja/id/709d819774fd8c4e0960c1a7/)
- レコードの登録や更新をするAPIでルックアップフィールドの値を変更する場合、ルックアップフィールドの「コピー元のフィールド」は、「レコード番号」フィールド、または「値の重複を禁止する」を設定したフィールドを指定してください。
- ルックアップフィールドの「コピー元のフィールド」に、自動計算を設定している「文字列1行」フィールドを選択している場合、ルックアップフィールドの値は変更できません。

#### ファイルをアップロードするAPI

アップロードしたファイルは、一時保管領域に保存されます。  
レコードの登録や更新をするAPIでレコードに添付しない限り、3日間で削除されます。  
一時保管領域に保存したファイルは、ディスク使用量に含まれます。

#### レコードにコメントするAPI

一度に取得できるレコードのコメントは10件までです。

#### その他の制限事項

- kintoneに関するその他の制限事項  
  [制限値一覽](https://jp.kintone.help/k/ja/id/04044)
- その他、サービスに関する制限事項
  - [サイボウズのクラウドサービス制限事項](https://www.cybozu.com/jp/service/restrictions.html)
