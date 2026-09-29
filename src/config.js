const path = require("path");
const crypto = require("crypto");

function getEncryptionKey() {
  const base64 = process.env.TOKEN_ENCRYPTION_KEY_BASE64;
  if (base64) {
    const key = Buffer.from(base64, "base64");
    if (key.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY_BASE64 must decode to 32 bytes.");
    }
    return key;
  }

  const fallback = process.env.TOKEN_ENCRYPTION_PASSPHRASE || "local-dev-change-me";
  return crypto.createHash("sha256").update(fallback).digest();
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  // npm run https:cert で証明書を作ると、このポートでHTTPSも待ち受ける
  httpsPort: Number(process.env.HTTPS_PORT || 3443),
  certDir: process.env.CERT_DIR || path.join(process.cwd(), "certs"),
  sessionSecret: process.env.SESSION_SECRET || "replace-session-secret",
  dbPath: process.env.DB_PATH
    || (process.env.VERCEL ? "/tmp/app.db" : path.join(process.cwd(), "data", "app.db")),
  encryptionKey: getEncryptionKey(),
  copilotApiBase: process.env.COPILOT_API_BASE || "https://models.inference.ai.azure.com",
  copilotModel: process.env.COPILOT_MODEL || "gpt-4o-mini",
  copilotTimeoutMs: Number(process.env.COPILOT_TIMEOUT_MS || 45000),
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 120000),
  // 503(混雑)・429・500系を自動再試行する回数（初回を含む）
  geminiRetryAttempts: Number(process.env.GEMINI_RETRY_ATTEMPTS || 4),
  // 再試行しても混雑が続くときに切り替えるモデル。空なら切り替えない
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.6-flash",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  // low | medium | high | xhigh | max（未指定ならモデルのデフォルト）
  anthropicEffort: process.env.ANTHROPIC_EFFORT || "",
  // "default" でサーバー側のrefusalフォールバックを有効化。"off" で無効化
  anthropicFallbacks: process.env.ANTHROPIC_FALLBACKS || "default",
  anthropicTimeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS || 120000),
  aiMaxToolSteps: Number(process.env.AI_MAX_TOOL_STEPS || 8)
};
