const db = require("./db");
const { getFormFields } = require("./kintone");
const { FIELD_TYPE_CODES, SYSTEM_FIELD_TYPES } = require("./fieldTypes");

const APP_COLUMNS = "id, app_name, kintone_domain, kintone_app_id, schema_synced_at, ai_can_read, ai_can_create, ai_can_update";
const FIELD_COLUMNS = "id, field_name, field_type, field_code, can_post, can_get, options_json, required, source";

function withOptions(field) {
  let options = [];
  try {
    options = field.options_json ? JSON.parse(field.options_json) : [];
  } catch {
    options = [];
  }
  return { ...field, options };
}

function getManagedApps() {
  return db.prepare(`SELECT ${APP_COLUMNS} FROM managed_kintone_apps ORDER BY app_name ASC`).all();
}

function getManagedAppById(appId) {
  return db.prepare(`SELECT ${APP_COLUMNS} FROM managed_kintone_apps WHERE id = ?`).get(appId);
}

function getManagedAppFields(appId, mode) {
  const filter = mode === "post" ? " AND can_post = 1" : mode === "get" ? " AND can_get = 1" : "";
  return db
    .prepare(`SELECT ${FIELD_COLUMNS} FROM managed_kintone_app_fields WHERE managed_app_id = ?${filter} ORDER BY id ASC`)
    .all(appId)
    .map(withOptions);
}

function deleteManagedApp(appId) {
  // foreign_keys が無効なため、関連データは明示的に削除する
  db.transaction(() => {
    db.prepare("DELETE FROM managed_kintone_app_fields WHERE managed_app_id = ?").run(appId);
    db.prepare("DELETE FROM user_kintone_app_tokens WHERE managed_app_id = ?").run(appId);
    db.prepare("DELETE FROM managed_kintone_apps WHERE id = ?").run(appId);
  })();
}

function updateAiPolicy(appId, { canRead, canCreate, canUpdate }) {
  db.prepare(`
    UPDATE managed_kintone_apps
    SET ai_can_read = ?, ai_can_create = ?, ai_can_update = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(canRead ? 1 : 0, canCreate ? 1 : 0, canUpdate ? 1 : 0, appId);
}

function extractOptions(property) {
  if (!property.options) return [];
  return Object.values(property.options)
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((o) => o.label);
}

/**
 * kintoneのフォーム設定を正として、ローカルのフィールド定義を同期する。
 * - kintoneに新しく追加されたフィールドは自動で追加（GET対象、入力可能な種別はPOST対象にも）
 * - 既存フィールドは名称・種別・選択肢・必須を更新（POST/GETフラグは維持）
 * - kintoneから消えたフィールドは削除
 */
async function syncAppSchema({ app, apiToken }) {
  const properties = await getFormFields({
    domain: app.kintone_domain,
    appId: app.kintone_app_id,
    apiToken
  });

  const remote = Object.values(properties).filter((p) => FIELD_TYPE_CODES.has(p.type));
  const existing = getManagedAppFields(app.id);
  const existingByCode = new Map(existing.map((f) => [f.field_code, f]));
  const remoteCodes = new Set(remote.map((p) => p.code));

  const summary = { added: [], updated: [], removed: [], total: remote.length };

  const insert = db.prepare(`
    INSERT INTO managed_kintone_app_fields
      (managed_app_id, field_name, field_type, field_code, can_post, can_get, options_json, required, source)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'kintone')
  `);
  const update = db.prepare(`
    UPDATE managed_kintone_app_fields
    SET field_name = ?, field_type = ?, options_json = ?, required = ?, source = 'kintone', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const remove = db.prepare("DELETE FROM managed_kintone_app_fields WHERE id = ?");

  db.transaction(() => {
    remote.forEach((p) => {
      const optionsJson = JSON.stringify(extractOptions(p));
      const required = p.required ? 1 : 0;
      const current = existingByCode.get(p.code);
      if (!current) {
        const canPost = SYSTEM_FIELD_TYPES.has(p.type) ? 0 : 1;
        insert.run(app.id, p.label, p.type, p.code, canPost, optionsJson, required);
        summary.added.push(p.label);
        return;
      }
      const changed = current.field_name !== p.label
        || current.field_type !== p.type
        || (current.options_json || "[]") !== optionsJson
        || current.required !== required;
      if (changed) {
        update.run(p.label, p.type, optionsJson, required, current.id);
        summary.updated.push(p.label);
      }
    });

    existing
      .filter((f) => !remoteCodes.has(f.field_code))
      .forEach((f) => {
        remove.run(f.id);
        summary.removed.push(f.field_name);
      });

    db.prepare("UPDATE managed_kintone_apps SET schema_synced_at = CURRENT_TIMESTAMP WHERE id = ?").run(app.id);
  })();

  return summary;
}

function describeSyncSummary(summary) {
  const parts = [`${summary.total}フィールド`];
  if (summary.added.length) parts.push(`追加: ${summary.added.join(", ")}`);
  if (summary.updated.length) parts.push(`更新: ${summary.updated.join(", ")}`);
  if (summary.removed.length) parts.push(`削除: ${summary.removed.join(", ")}`);
  if (!summary.added.length && !summary.updated.length && !summary.removed.length) parts.push("変更なし");
  return parts.join(" / ");
}

module.exports = {
  getManagedApps,
  getManagedAppById,
  getManagedAppFields,
  deleteManagedApp,
  updateAiPolicy,
  syncAppSchema,
  describeSyncSummary
};
