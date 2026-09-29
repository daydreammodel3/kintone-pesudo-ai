function normalizeDomain(domain) {
  const trimmed = String(domain || "").trim();
  return trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

// kintone側の権限で拒否されたことを示すエラーコード
const PERMISSION_ERROR_CODES = new Set(["CB_NO02", "GAIA_NO01"]);

class KintoneApiError extends Error {
  constructor(operation, status, body) {
    super(`kintone ${operation} failed: ${status} ${JSON.stringify(body)}`);
    this.name = "KintoneApiError";
    this.status = status;
    this.code = body?.code || "";
    this.kintoneMessage = body?.message || "";
    this.errors = body?.errors || null;
    this.isPermissionError = status === 403 || PERMISSION_ERROR_CODES.has(this.code);
  }
}

function buildKintoneHeaders({ host, apiToken, method }) {
  const headers = {
    // Host header itself is handled by the HTTP client. We set API-token auth and language headers here.
    "X-Cybozu-API-Token": apiToken,
    "Accept-Language": "ja"
  };

  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function kintoneRequest({ domain, apiToken, method, path, params, body }) {
  const host = normalizeDomain(domain);
  const search = params ? `?${params.toString()}` : "";
  const response = await fetch(`https://${host}${path}${search}`, {
    method,
    headers: buildKintoneHeaders({ host, apiToken, method }),
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  return { response, body: json };
}

async function addRecord({ domain, appId, apiToken, record }) {
  const { response, body } = await kintoneRequest({
    domain,
    apiToken,
    method: "POST",
    path: "/k/v1/record.json",
    body: { app: appId, record: record || {} }
  });
  if (!response.ok) {
    throw new KintoneApiError("POST", response.status, body);
  }
  return body;
}

async function updateRecord({ domain, appId, apiToken, id, record }) {
  const { response, body } = await kintoneRequest({
    domain,
    apiToken,
    method: "PUT",
    path: "/k/v1/record.json",
    body: { app: appId, id, record: record || {} }
  });
  if (!response.ok) {
    throw new KintoneApiError("PUT", response.status, body);
  }
  return body;
}

// フォームのフィールド設定を取得する。返り値は { フィールドコード: プロパティ } 形式。
async function getFormFields({ domain, appId, apiToken }) {
  const params = new URLSearchParams({ app: String(appId) });
  const { response, body } = await kintoneRequest({
    domain,
    apiToken,
    method: "GET",
    path: "/k/v1/app/form/fields.json",
    params
  });
  if (!response.ok) {
    throw new KintoneApiError("GET form/fields", response.status, body);
  }
  return body.properties || {};
}

function rewriteSelectionEqualsToIn(rawQuery) {
  if (!rawQuery || !String(rawQuery).trim()) return "";
  return String(rawQuery)
    .replace(/([^\s()]+)\s*!=\s*"([^"]*)"/g, "$1 not in (\"$2\")")
    .replace(/([^\s()]+)\s*=\s*"([^"]*)"/g, "$1 in (\"$2\")");
}

async function searchRecords({ domain, appId, apiToken, query, fields, totalCount }) {
  async function requestByQuery(rawQuery) {
    const params = new URLSearchParams({ app: String(appId) });
    if (rawQuery && String(rawQuery).trim()) {
      params.set("query", String(rawQuery));
    }
    (fields || []).forEach((code, i) => params.set(`fields[${i}]`, code));
    if (totalCount) params.set("totalCount", "true");

    return kintoneRequest({ domain, apiToken, method: "GET", path: "/k/v1/records.json", params });
  }

  function toResult(body, usedQuery) {
    return {
      records: body.records || [],
      totalCount: body.totalCount != null ? Number(body.totalCount) : null,
      query: usedQuery
    };
  }

  const initialQuery = query || "";
  const first = await requestByQuery(initialQuery);
  if (first.response.ok) {
    return toResult(first.body, initialQuery);
  }

  const code = first.body?.code;
  const canRetryByOperatorFallback = code === "GAIA_IQ03" && !!String(initialQuery).trim();
  if (canRetryByOperatorFallback) {
    const rewritten = rewriteSelectionEqualsToIn(initialQuery);
    if (rewritten !== String(initialQuery)) {
      const second = await requestByQuery(rewritten);
      if (second.response.ok) {
        return toResult(second.body, rewritten);
      }
      throw new KintoneApiError("GET", second.response.status, second.body);
    }
  }

  throw new KintoneApiError("GET", first.response.status, first.body);
}

async function getRecords(options) {
  const { records } = await searchRecords(options);
  return records;
}

module.exports = {
  KintoneApiError,
  addRecord,
  updateRecord,
  getFormFields,
  getRecords,
  searchRecords,
  normalizeDomain,
  buildKintoneHeaders
};
