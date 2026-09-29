const db = require("./db");

const STATUS_LABELS = {
  ok: "成功",
  error: "エラー",
  denied_policy: "ポリシーで拒否",
  denied_kintone: "kintone権限で拒否"
};

function recordAiOperation(entry) {
  db.prepare(`
    INSERT INTO ai_operation_logs
      (user_id, managed_app_id, app_name, conversation_id, source, provider, model,
       tool_name, access, input_json, status, summary, kintone_error_code, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.userId,
    entry.managedAppId ?? null,
    entry.appName ?? null,
    entry.conversationId ?? null,
    entry.source,
    entry.provider ?? null,
    entry.model ?? null,
    entry.toolName,
    entry.access,
    entry.input ? JSON.stringify(entry.input) : null,
    entry.status,
    entry.summary ?? null,
    entry.kintoneErrorCode ?? null,
    entry.durationMs ?? null
  );
}

// userId が null のときは全ユーザー分（ゲストの閲覧用）
function listAiOperations({ userId, limit }) {
  return db
    .prepare(`
      SELECT l.*, u.username FROM ai_operation_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE (? IS NULL OR l.user_id = ?) ORDER BY l.id DESC LIMIT ?
    `)
    .all(userId, userId, limit || 100);
}

function countAiOperationsByStatus(userId) {
  return db
    .prepare("SELECT status, COUNT(*) AS count FROM ai_operation_logs WHERE (? IS NULL OR user_id = ?) GROUP BY status")
    .all(userId, userId)
    .reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {});
}

module.exports = { STATUS_LABELS, recordAiOperation, listAiOperations, countAiOperationsByStatus };
