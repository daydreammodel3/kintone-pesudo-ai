// フォーム入力やAIからの値を、kintone REST API の record 形式に変換するためのユーティリティ

function parseFieldInputValue(raw, fieldType) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to plain-text parsing
    }
  }

  if (fieldType === "CHECK_BOX" || fieldType === "MULTI_SELECT") {
    return text.split(",").map((v) => v.trim()).filter(Boolean);
  }

  if (fieldType === "USER_SELECT" || fieldType === "ORGANIZATION_SELECT" || fieldType === "GROUP_SELECT") {
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((code) => ({ code }));
  }

  if (fieldType === "FILE") {
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((fileKey) => ({ fileKey }));
  }

  if (fieldType === "CREATOR" || fieldType === "MODIFIER") {
    return { code: text };
  }

  return text;
}

/**
 * AIが渡した値（プレーンな文字列・数値・配列）をkintoneのvalue形式に変換する。
 * 選択肢フィールドは選択肢外の値をエラーにして、AIに自己修正させる。
 */
function toKintoneValue(field, raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? raw.value : raw;
  const type = field.field_type;
  const options = field.options || [];

  if (type === "CHECK_BOX" || type === "MULTI_SELECT") {
    const list = Array.isArray(value) ? value.map(String) : String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const invalid = options.length ? list.filter((v) => !options.includes(v)) : [];
    if (invalid.length) {
      throw new Error(`${field.field_name}(${field.field_code}) に選択肢外の値があります: ${invalid.join(", ")} / 選択肢: ${options.join(", ")}`);
    }
    return list;
  }

  if (type === "DROP_DOWN" || type === "RADIO_BUTTON") {
    const text = String(value ?? "");
    if (text && options.length && !options.includes(text)) {
      throw new Error(`${field.field_name}(${field.field_code}) の値「${text}」は選択肢にありません / 選択肢: ${options.join(", ")}`);
    }
    return text;
  }

  if (type === "USER_SELECT" || type === "ORGANIZATION_SELECT" || type === "GROUP_SELECT") {
    const list = Array.isArray(value) ? value : [value];
    return list
      .filter((v) => v != null && v !== "")
      .map((v) => (typeof v === "object" ? { code: v.code } : { code: String(v) }));
  }

  if (typeof value === "string") {
    return parseFieldInputValue(value, type);
  }
  return value ?? "";
}

function buildRecordFromPlainObject(writableFields, plain) {
  const byCode = new Map(writableFields.map((f) => [f.field_code, f]));
  const record = {};
  const denied = [];

  Object.entries(plain || {}).forEach(([code, raw]) => {
    const field = byCode.get(code);
    if (!field) {
      denied.push(code);
      return;
    }
    record[code] = { value: toKintoneValue(field, raw) };
  });

  return { record, denied };
}

function simplifyValue(field) {
  const { type, value } = field;
  if (value == null) return null;
  if (type === "USER_SELECT" || type === "ORGANIZATION_SELECT" || type === "GROUP_SELECT" || type === "STATUS_ASSIGNEE") {
    return value.map((v) => v.name || v.code);
  }
  if (type === "CREATOR" || type === "MODIFIER") {
    return value.name || value.code;
  }
  if (type === "FILE") {
    return value.map((v) => v.name);
  }
  if (type === "SUBTABLE") {
    return value.map((row) => Object.fromEntries(Object.entries(row.value).map(([k, v]) => [k, simplifyValue(v)])));
  }
  if (typeof value === "string" && value.length > 800) {
    return `${value.slice(0, 800)}…(省略)`;
  }
  return value;
}

// kintoneのレコードを { フィールドコード: 値 } の平易な形にする（AIに渡すトークンを節約）
function simplifyRecord(record) {
  const out = {};
  Object.entries(record || {}).forEach(([code, field]) => {
    if (code === "$revision") return;
    out[code] = simplifyValue(field);
  });
  return out;
}

module.exports = {
  parseFieldInputValue,
  toKintoneValue,
  buildRecordFromPlainObject,
  simplifyRecord
};
