const db = require("./db");
const { encrypt, decrypt } = require("./crypto");
const { getManagedAppById } = require("./apps");

const LLM_PROVIDERS = [
  { code: "gemini", label: "Gemini API（Google）" },
  { code: "anthropic", label: "Claude API（Anthropic）" },
  { code: "github", label: "GitHub Models（2026/7/30 提供終了）", retired: true }
];

function getLegacyUserTokens(userId) {
  const row = db.prepare("SELECT * FROM user_tokens WHERE user_id = ?").get(userId);
  if (!row) return null;

  return {
    domain: row.kintone_domain,
    appId: row.kintone_app_id,
    kintoneApiToken: decrypt(row.kintone_api_token_enc),
    copilotApiToken: decrypt(row.copilot_api_token_enc)
  };
}

function getUserCopilotToken(userId) {
  const row = db.prepare("SELECT copilot_api_token_enc FROM user_copilot_tokens WHERE user_id = ?").get(userId);
  if (row) return decrypt(row.copilot_api_token_enc);

  const legacy = getLegacyUserTokens(userId);
  return legacy?.copilotApiToken || "";
}

function saveUserCopilotToken(userId, token) {
  db.prepare(`
    INSERT INTO user_copilot_tokens (user_id, copilot_api_token_enc)
    VALUES (?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET
      copilot_api_token_enc = excluded.copilot_api_token_enc,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, encrypt(token));
}

function getUserKintoneTokenForApp(userId, managedAppId) {
  const row = db
    .prepare("SELECT kintone_api_token_enc FROM user_kintone_app_tokens WHERE user_id = ? AND managed_app_id = ?")
    .get(userId, managedAppId);
  if (row) return decrypt(row.kintone_api_token_enc);

  // Legacy fallback for older schema where domain/app were stored in user_tokens.
  const legacy = getLegacyUserTokens(userId);
  const app = getManagedAppById(managedAppId);
  if (!legacy || !app) return "";
  if (legacy.domain === app.kintone_domain && String(legacy.appId) === String(app.kintone_app_id)) {
    return legacy.kintoneApiToken;
  }
  return "";
}

function saveUserKintoneTokenForApp(userId, managedAppId, token) {
  db.prepare(`
    INSERT INTO user_kintone_app_tokens (user_id, managed_app_id, kintone_api_token_enc)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, managed_app_id)
    DO UPDATE SET
      kintone_api_token_enc = excluded.kintone_api_token_enc,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, managedAppId, encrypt(token));
}

function getUserLlmSettings(userId) {
  const row = db
    .prepare("SELECT provider, anthropic_api_key_enc, gemini_api_key_enc FROM user_llm_settings WHERE user_id = ?")
    .get(userId);
  return {
    provider: row?.provider || "gemini",
    geminiApiKey: row?.gemini_api_key_enc ? decrypt(row.gemini_api_key_enc) : "",
    anthropicApiKey: row?.anthropic_api_key_enc ? decrypt(row.anthropic_api_key_enc) : "",
    copilotApiToken: getUserCopilotToken(userId)
  };
}

// 空欄で送られたキーは既存の値を維持する
function saveUserLlmSettings(userId, { provider, geminiApiKey, anthropicApiKey }) {
  const current = getUserLlmSettings(userId);
  const nextGeminiKey = geminiApiKey || current.geminiApiKey;
  const nextAnthropicKey = anthropicApiKey || current.anthropicApiKey;
  db.prepare(`
    INSERT INTO user_llm_settings (user_id, provider, gemini_api_key_enc, anthropic_api_key_enc)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET
      provider = excluded.provider,
      gemini_api_key_enc = excluded.gemini_api_key_enc,
      anthropic_api_key_enc = excluded.anthropic_api_key_enc,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    userId,
    provider,
    nextGeminiKey ? encrypt(nextGeminiKey) : null,
    nextAnthropicKey ? encrypt(nextAnthropicKey) : null
  );
}

module.exports = {
  LLM_PROVIDERS,
  getUserCopilotToken,
  saveUserCopilotToken,
  getUserKintoneTokenForApp,
  saveUserKintoneTokenForApp,
  getUserLlmSettings,
  saveUserLlmSettings
};
