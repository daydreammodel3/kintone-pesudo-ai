1件のレコードを登録します。

| HTTPメソッド | POST |
| URL | https\://sample.cybozu.com/k/v1/record.json |
| URL（ゲストスペース）| https\://sample.cybozu.com/k/guest/`GUEST_SPACE_ID`/v1/record.json |
| 認証 | [パスワード認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#password), [APIトークン認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#api-token), [セッション認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#session), [OAuth認証](https://cybozu.dev/ja/id/edae2a9d04c6e7d0afffda3a/#oauth) |
| Content-Type | application/json |

### リクエストパラメーター

| パラメーター名 | 型 | 必須 | 説明 |
| :-- | :-- | :-- | :-- |
| app | 数値または文字列 | 必須 | アプリID |
| record | オブジェクト | 省略可 | レコードの情報（フィールドコードとフィールドの値）<br>フィールドの種類によって、指定できる値が異なります。<br>詳細は次のページを確認してください。<br>[フィールド形式](https://cybozu.dev/ja/id/2736678ef8d2aad09a33e8bb/)<br>省略すると、すべてのフィールドの値は初期値で登録されます。<br>存在しないフィールドコードを指定した場合、そのフィールドは無視されてレコードが登録されます。 |

### レスポンスプロパティ

| プロパティ名 | 型 | 説明 |
| :-- | :-- | :-- |
| id | 文字列 | 登録したレコードのレコードID |
| revision | 文字列 | 登録したレコードのリビジョン番号 |

### 必要なアクセス権

- アプリのレコード追加権限
- 値を登録するフィールドの編集権限

次のフィールドに値を登録する場合には、アプリ管理権限が必要です。

- 作成者
- 更新者
- 作成日時
- 更新日時

### サンプル

```json
```

リクエストヘッダーの詳細は共通仕様を参照してください。  
[kintone REST APIの共通仕様](https://cybozu.dev/ja/id/d509b956c8f84c45e1e129ae/)

```json,
    "文字列複数行": {
      "value": "テスト\nテスト2"
    },
    "数値": {
      "value": "20"
    },
    "日時": {
      "value": "2014-02-16T08:57:00Z"
    },
    "チェックボックス": {
      "value": ["sample1", "sample2"]
    },
    "ユーザー選択": {
      "value": [
        {
          "code": "sato"
        }
      ]
    },
    "ドロップダウン": {
      "value": "sample1"
    },
    "リンク_ウェブ": {
      "value": "https://www.cybozu.com"
    },
    "テーブル": {
      "value": [
        {
          "value": {
            "テーブル文字列": {
              "value": "テスト"
            }
          }
        }
      ]
    }
  }
}
```

```json
```

`kintone.api()`の詳細は、次のページを参照してください。  
[kintone REST APIリクエストを送信する](https://cybozu.dev/ja/id/84b51223dd9e63a226e3e985/)

```js
const body = {
  app: kintone.app.getId(),
  record: {
    文字列1行: {
      value: 'ABC'
    }
  }
};

await kintone.api(kintone.api.url('/k/v1/record.json', true), 'POST', body);
```

ご利用の環境によって、curlのフォーマットは異なる場合があります。  
詳細は、次のページを参照してください。  
[curlコマンドでkintone REST APIを実行してみよう/3.API実行](https://cybozu.dev/ja/id/49f27ea50d9f50901cdef93f/#api-execution-to-post)

```shell
curl -X POST 'https://sample.cybozu.com/k/v1/record.json' \
  -H 'X-Cybozu-API-Token: API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "app": 1,
    "record": {
      "文字列1行": {
        "value": "ABC"
      }
    }
  }'
```

### 制限事項

- 次のフィールドは、値を登録できません。
  - ルックアップ元からコピーされるフィールド
  - ステータス
  - カテゴリー
  - 計算
  - 作業者
  - 自動計算が設定されている文字列1行フィールド