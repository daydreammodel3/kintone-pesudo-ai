const POST_GET_FIELD_TYPES = [
  { code: "SINGLE_LINE_TEXT", label: "文字列(1行)", canPost: true, canGet: true },
  { code: "MULTI_LINE_TEXT", label: "文字列(複数行)", canPost: true, canGet: true },
  { code: "RICH_TEXT", label: "リッチエディター", canPost: true, canGet: true },
  { code: "NUMBER", label: "数値", canPost: true, canGet: true },
  { code: "CHECK_BOX", label: "チェックボックス", canPost: true, canGet: true },
  { code: "RADIO_BUTTON", label: "ラジオボタン", canPost: true, canGet: true },
  { code: "MULTI_SELECT", label: "複数選択", canPost: true, canGet: true },
  { code: "DROP_DOWN", label: "ドロップダウン", canPost: true, canGet: true },
  { code: "USER_SELECT", label: "ユーザー選択", canPost: true, canGet: true },
  { code: "ORGANIZATION_SELECT", label: "組織選択", canPost: true, canGet: true },
  { code: "GROUP_SELECT", label: "グループ選択", canPost: true, canGet: true },
  { code: "DATE", label: "日付", canPost: true, canGet: true },
  { code: "TIME", label: "時刻", canPost: true, canGet: true },
  { code: "DATETIME", label: "日時", canPost: true, canGet: true },
  { code: "LINK", label: "リンク", canPost: true, canGet: true },
  { code: "FILE", label: "添付ファイル", canPost: true, canGet: true },
  { code: "SUBTABLE", label: "テーブル", canPost: true, canGet: true },
  { code: "CREATOR", label: "作成者", canPost: true, canGet: true },
  { code: "CREATED_TIME", label: "作成日時", canPost: true, canGet: true },
  { code: "MODIFIER", label: "更新者", canPost: false, canGet: true },
  { code: "UPDATED_TIME", label: "更新日時", canPost: false, canGet: true }
];

const FIELD_TYPE_CODES = new Set(POST_GET_FIELD_TYPES.map((v) => v.code));

module.exports = {
  POST_GET_FIELD_TYPES,
  FIELD_TYPE_CODES
};
