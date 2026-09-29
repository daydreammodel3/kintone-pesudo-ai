const fs = require("fs");
const path = require("path");
const { certDir } = require("./config");

// scripts/https-cert.js（mkcert）が作るファイル
const CERT_FILE = path.join(certDir, "server.crt");
const KEY_FILE = path.join(certDir, "server.key");
// 端末に入れてもらう認証局の公開証明書（秘密鍵は含まない）
const CA_FILE = path.join(certDir, "ca.crt");

function loadHttpsCredentials() {
  if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) return null;
  return { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) };
}

module.exports = { CERT_FILE, KEY_FILE, CA_FILE, loadHttpsCredentials };
