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
  sessionSecret: process.env.SESSION_SECRET || "replace-session-secret",
  dbPath: process.env.DB_PATH
    || (process.env.VERCEL ? "/tmp/app.db" : path.join(process.cwd(), "data", "app.db")),
  encryptionKey: getEncryptionKey(),
  copilotApiBase: process.env.COPILOT_API_BASE || "https://models.inference.ai.azure.com",
  copilotModel: process.env.COPILOT_MODEL || "gpt-4o-mini",
  copilotTimeoutMs: Number(process.env.COPILOT_TIMEOUT_MS || 45000)
};
