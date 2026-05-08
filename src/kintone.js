function normalizeDomain(domain) {
  const trimmed = String(domain || "").trim();
  return trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");
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

async function addRecord({ domain, appId, apiToken, record }) {
  const host = normalizeDomain(domain);
  const url = `https://${host}/k/v1/record.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildKintoneHeaders({ host, apiToken, method: "POST" }),
    body: JSON.stringify({
      app: appId,
      record: record || {}
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`kintone POST failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function getRecords({ domain, appId, apiToken, query }) {
  const host = normalizeDomain(domain);

  async function requestByQuery(rawQuery) {
    const params = new URLSearchParams({ app: String(appId) });
    if (rawQuery && String(rawQuery).trim()) {
      params.set("query", String(rawQuery));
    }

    const url = `https://${host}/k/v1/records.json?${params.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: buildKintoneHeaders({ host, apiToken, method: "GET" })
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  function rewriteSelectionEqualsToIn(rawQuery) {
    if (!rawQuery || !String(rawQuery).trim()) return "";
    return String(rawQuery)
      .replace(/([^\s()]+)\s*!=\s*"([^"]*)"/g, "$1 not in (\"$2\")")
      .replace(/([^\s()]+)\s*=\s*"([^"]*)"/g, "$1 in (\"$2\")");
  }

  const initialQuery = query || "";
  const first = await requestByQuery(initialQuery);
  if (first.response.ok) {
    return first.body.records || [];
  }

  const code = first.body?.code;
  const canRetryByOperatorFallback = code === "GAIA_IQ03" && !!String(initialQuery).trim();
  if (canRetryByOperatorFallback) {
    const rewritten = rewriteSelectionEqualsToIn(initialQuery);
    if (rewritten !== String(initialQuery)) {
      const second = await requestByQuery(rewritten);
      if (second.response.ok) {
        return second.body.records || [];
      }
      throw new Error(`kintone GET failed: ${second.response.status} ${JSON.stringify(second.body)}`);
    }
  }

  throw new Error(`kintone GET failed: ${first.response.status} ${JSON.stringify(first.body)}`);
}

module.exports = { addRecord, getRecords, normalizeDomain, buildKintoneHeaders };
