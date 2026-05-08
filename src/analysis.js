const db = require("./db");
const { copilotApiBase, copilotModel, copilotTimeoutMs } = require("./config");

function buildSummary(records) {
  const sample = records.slice(0, 10);
  return JSON.stringify({
    total: records.length,
    sample
  }, null, 2);
}

async function callCopilot({ copilotToken, records }) {
  const system = "あなたはkintoneレコード分析アシスタントです。要点、傾向、異常、改善提案を日本語で簡潔に示してください。";
  const user = `次のレコード群を分析してください。\n${buildSummary(records)}`;
  return callCopilotChat({ copilotToken, system, user, temperature: 0.2 });
}

async function callCopilotChat({ copilotToken, system, user, temperature }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), copilotTimeoutMs);

  try {
    const response = await fetch(`${copilotApiBase}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: copilotModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: temperature ?? 0.2
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Copilot API failed: ${response.status} ${JSON.stringify(body)}`);
    }

    const text = body?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Copilot API response has no message content.");
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeKintoneQuery(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return ["order by", " limit ", " offset ", " and ", " or ", "$id", "="]
    .some((token) => normalized.includes(token));
}

function getTodayJstDate() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return jst.toISOString().slice(0, 10);
}

function parseDateString(dateString) {
  const [y, m, d] = String(dateString).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
}

function toDateString(year, month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function pickDateLikeField(getFields) {
  const fields = getFields || [];
  const priorities = ["DATE", "DATETIME", "CREATED_TIME", "UPDATED_TIME"];
  for (const type of priorities) {
    const found = fields.find((f) => f.field_type === type);
    if (found) return found;
  }
  return null;
}

function pickIncidentField(getFields) {
  return findFieldByKeywords(
    getFields,
    ["インシデント", "incident", "種別", "type"],
    ["DROP_DOWN", "RADIO_BUTTON", "SINGLE_LINE_TEXT"]
  );
}

function pickPriorityField(getFields) {
  return findFieldByKeywords(
    getFields,
    ["優先度", "priority", "重要度", "severity"],
    ["DROP_DOWN", "RADIO_BUTTON", "SINGLE_LINE_TEXT"]
  );
}

function findFieldByKeywords(getFields, keywords, typeHints) {
  const fields = getFields || [];
  const hinted = fields.filter((f) => !typeHints || typeHints.includes(f.field_type));
  const source = hinted.length ? hinted : fields;
  return source.find((f) => {
    const hay = `${f.field_name || ""} ${f.field_code || ""}`.toLowerCase();
    return keywords.some((k) => hay.includes(k.toLowerCase()));
  }) || null;
}

function extractIncidentValue(text) {
  const normalized = String(text || "").toLowerCase();
  const values = [];
  if (normalized.includes("アラート") || normalized.includes("alert")) values.push("アラート");
  if (normalized.includes("問い合わせ") || normalized.includes("問合せ") || normalized.includes("inquiry")) values.push("問い合わせ");
  return values;
}

function extractPriorityValue(text) {
  const normalized = String(text || "").toLowerCase();
  const explicit = normalized.match(/優先度[^\n。]*?(緊急|高|中|低)/);
  if (explicit) return explicit[1];

  if (normalized.includes("緊急優先") || normalized.includes("優先度緊急") || normalized.includes("緊急")) return "緊急";
  if (normalized.includes("高優先") || normalized.includes("優先度高")) return "高";
  if (normalized.includes("中優先") || normalized.includes("優先度中")) return "中";
  if (normalized.includes("低優先") || normalized.includes("優先度低")) return "低";
  return "";
}

function extractPriorityTokens(text) {
  const matches = String(text || "").match(/緊急|高|中|低/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

function detectPriorityComparator(text) {
  const source = String(text || "");
  const hasOver = /(より上|超|より高|より大)/.test(source);
  const hasUnder = /(より下|より低|より小|未満)/.test(source);
  const hasGte = /以上/.test(source);
  const hasLte = /以下/.test(source);

  if (hasOver) return "gt";
  if (hasUnder) return "lt";
  if (hasGte) return "gte";
  if (hasLte) return "lte";
  return "eq";
}

function hasLogicalOr(text) {
  return /(または|もしくは|あるいは|\bor\b|\bOR\b)/.test(String(text || ""));
}

function hasLogicalAnd(text) {
  return /(かつ|且つ|\band\b|\bAND\b|両方|どちらも)/.test(String(text || ""));
}

function buildIncidentQueryFromInstruction(instruction, getFields) {
  const incidentValues = extractIncidentValue(instruction);
  if (!incidentValues.length) return "";

  const field = pickIncidentField(getFields);
  if (!field) return "";

  const text = String(instruction || "");

  const alertExcept = /アラート\s*(以外|除く|ではない|じゃない)/.test(text);
  if (alertExcept) return `${field.field_code} != "アラート"`;

  const inquiryExcept = /(問い合わせ|問合せ)\s*(以外|除く|ではない|じゃない)/.test(text);
  if (inquiryExcept) return `${field.field_code} != "問い合わせ"`;

  if (incidentValues.length >= 2) {
    return `${field.field_code} in ("アラート", "問い合わせ")`;
  }

  return `${field.field_code} = "${incidentValues[0]}"`;
}

function buildPriorityQueryFromInstruction(instruction, getFields) {
  const text = String(instruction || "");
  const priorityTokens = extractPriorityTokens(text);
  const priorityValue = extractPriorityValue(text) || priorityTokens[0] || "";
  if (!priorityValue) return "";

  const field = pickPriorityField(getFields);
  if (!field) return "";

  const ordered = ["低", "中", "高", "緊急"];
  const idx = ordered.indexOf(priorityValue);
  if (idx < 0) return "";

  const comparator = detectPriorityComparator(text);
  const hasNot = /(以外|除く|ではない|じゃない)/.test(text);
  const orFlag = hasLogicalOr(text);
  const andFlag = hasLogicalAnd(text);

  if (hasNot) {
    return `${field.field_code} != "${priorityValue}"`;
  }

  if (orFlag && priorityTokens.length >= 2) {
    const values = priorityTokens.filter((v) => ordered.includes(v)).map((v) => `"${v}"`).join(", ");
    if (values) return `${field.field_code} in (${values})`;
  }

  if (andFlag && priorityTokens.length >= 2) {
    // For single-select fields, AND on same field is interpreted as inclusion of listed values.
    const values = priorityTokens.filter((v) => ordered.includes(v)).map((v) => `"${v}"`).join(", ");
    if (values) return `${field.field_code} in (${values})`;
  }

  if (comparator === "gte") {
    const values = ordered.slice(idx).map((v) => `"${v}"`).join(", ");
    return `${field.field_code} in (${values})`;
  }

  if (comparator === "lte") {
    const values = ordered.slice(0, idx + 1).map((v) => `"${v}"`).join(", ");
    return `${field.field_code} in (${values})`;
  }

  if (comparator === "gt") {
    const values = ordered.slice(idx + 1).map((v) => `"${v}"`).join(", ");
    if (!values) return "";
    return `${field.field_code} in (${values})`;
  }

  if (comparator === "lt") {
    const values = ordered.slice(0, idx).map((v) => `"${v}"`).join(", ");
    if (!values) return "";
    return `${field.field_code} in (${values})`;
  }

  return `${field.field_code} = "${priorityValue}"`;
}

function buildRelativeDateRangeQueryFromInstruction(instruction, getFields) {
  const text = String(instruction || "");
  const dateField = pickDateLikeField(getFields);
  if (!dateField) return "";

  const today = parseDateString(getTodayJstDate());

  if (text.includes("先週")) {
    const day = today.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    const thisWeekMonday = addDays(today, -mondayOffset);
    const start = addDays(thisWeekMonday, -7);
    const end = addDays(thisWeekMonday, -1);
    return `${dateField.field_code} >= "${formatDate(start)}" and ${dateField.field_code} <= "${formatDate(end)}"`;
  }

  if (text.includes("今週")) {
    const day = today.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    const start = addDays(today, -mondayOffset);
    const end = addDays(start, 6);
    return `${dateField.field_code} >= "${formatDate(start)}" and ${dateField.field_code} <= "${formatDate(end)}"`;
  }

  if (text.includes("今月")) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return `${dateField.field_code} >= "${formatDate(start)}" and ${dateField.field_code} <= "${formatDate(end)}"`;
  }

  if (text.includes("先月")) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return `${dateField.field_code} >= "${formatDate(start)}" and ${dateField.field_code} <= "${formatDate(end)}"`;
  }

  return "";
}

function buildDateRangeQueryFromInstruction(instruction, getFields) {
  const text = String(instruction || "");
  const match = text.match(/(\d{1,2})月\s*(\d{1,2})日\s*から\s*(\d{1,2})月\s*(\d{1,2})日\s*まで/);
  if (!match) return "";

  const dateField = pickDateLikeField(getFields);
  if (!dateField) return "";

  const currentYear = Number(getTodayJstDate().slice(0, 4));
  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = Number(match[3]);
  const endDay = Number(match[4]);

  // If the period wraps over year end, shift the end year to next year.
  const startYear = currentYear;
  const endYear = endMonth < startMonth ? currentYear + 1 : currentYear;

  const from = toDateString(startYear, startMonth, startDay);
  const to = toDateString(endYear, endMonth, endDay);
  return `${dateField.field_code} >= "${from}" and ${dateField.field_code} <= "${to}"`;
}

function extractQueryFromCopilotResponse(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.query === "string") return parsed.query.trim();
  } catch {
    // Accept plain text query responses.
  }

  return raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
}

async function generateKintoneQueryFromInstruction({ copilotToken, instruction, getFields }) {
  const text = String(instruction || "").trim();
  if (!text) return "";

  if (looksLikeKintoneQuery(text)) {
    return text;
  }

  const dateRangeQuery = buildDateRangeQueryFromInstruction(text, getFields);
  const relativeDateRangeQuery = buildRelativeDateRangeQueryFromInstruction(text, getFields);
  const incidentQuery = buildIncidentQueryFromInstruction(text, getFields);
  const priorityQuery = buildPriorityQueryFromInstruction(text, getFields);
  const coreConditions = [incidentQuery, priorityQuery].filter(Boolean);
  let mergedCore = coreConditions.join(" and ");
  if (coreConditions.length >= 2 && hasLogicalOr(text) && !hasLogicalAnd(text)) {
    mergedCore = `(${coreConditions.join(" or ")})`;
  }

  const deterministicQuery = [dateRangeQuery, relativeDateRangeQuery, mergedCore]
    .filter(Boolean)
    .join(" and ");
  if (deterministicQuery) {
    return deterministicQuery;
  }

  const fieldsSummary = (getFields || [])
    .map((f) => `${f.field_name}(${f.field_code}:${f.field_type})`)
    .join(", ");

  const system = [
    "あなたはkintone query生成アシスタントです。",
    "入力された日本語指示をkintoneのquery文字列に変換してください。",
    "フィールド名ではなく、必ず field_code を使ってください。",
    "選択肢の値は推測しないでください。不明な場合は条件から除外してください。",
    "インシデントの候補値は主に『アラート』『問い合わせ』です。",
    "優先度の候補値は主に『緊急』『高』『中』『低』です。",
    "必ずJSONのみを返答してください。形式は {\"query\":\"...\"}。",
    "queryを省略する場合は空文字を返してください。"
  ].join(" ");

  const user = [
    `本日(JST): ${getTodayJstDate()}`,
    `利用可能フィールド: ${fieldsSummary || "(不明)"}`,
    `指示: ${text}`,
    "補足: 例えば『5月1日から5月8日まで』は日付比較条件に変換してください。"
  ].join("\n");

  const responseText = await callCopilotChat({
    copilotToken,
    system,
    user,
    temperature: 0
  });

  return extractQueryFromCopilotResponse(responseText);
}

function createJob(userId, records) {
  const insert = db.prepare(`
    INSERT INTO analysis_jobs (user_id, status, input_summary, result, error)
    VALUES (?, 'pending', ?, NULL, NULL)
  `);
  const info = insert.run(userId, buildSummary(records));
  return info.lastInsertRowid;
}

function updateJob(jobId, patch) {
  const current = db.prepare("SELECT * FROM analysis_jobs WHERE id = ?").get(jobId);
  if (!current) return;

  const next = {
    status: patch.status ?? current.status,
    result: patch.result ?? current.result,
    error: patch.error ?? current.error
  };

  db.prepare(`
    UPDATE analysis_jobs
    SET status = ?, result = ?, error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next.status, next.result, next.error, jobId);
}

async function runJobInBackground({ jobId, copilotToken, records }) {
  updateJob(jobId, { status: "running", error: null });
  try {
    const result = await callCopilot({ copilotToken, records });
    updateJob(jobId, { status: "completed", result, error: null });
  } catch (error) {
    updateJob(jobId, { status: "failed", error: error.message, result: null });
  }
}

module.exports = {
  createJob,
  runJobInBackground,
  generateKintoneQueryFromInstruction
};
