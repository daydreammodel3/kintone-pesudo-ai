// mkcert でHTTPS用の証明書を作る（ホスト側で実行）。
// IPアドレスが変わったら実行し直す。端末に入れた認証局はそのまま使えるので、端末側の設定し直しは不要。
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { certDir, httpsPort } = require("../src/config");
const { CERT_FILE, KEY_FILE, CA_FILE } = require("../src/tls");
const { lanAddresses, localHostNames } = require("../src/network");

function mkcert(args, options = {}) {
  return execFileSync("mkcert", args, { encoding: "utf8", ...options });
}

try {
  mkcert(["-help"], { stdio: "ignore" });
} catch {
  console.error("mkcert が見つかりません。次を実行してから、もう一度実行してください:");
  console.error("  brew install mkcert");
  console.error("  mkcert -install");
  process.exit(1);
}

const caRoot = mkcert(["-CAROOT"]).trim();
if (!fs.existsSync(path.join(caRoot, "rootCA.pem"))) {
  console.error("mkcert の認証局がまだありません。先に `mkcert -install` を実行してください（Macのパスワードを求められます）。");
  process.exit(1);
}

const hostNames = localHostNames();
const addresses = lanAddresses();
const names = ["localhost", "127.0.0.1", ...hostNames, ...addresses];

fs.mkdirSync(certDir, { recursive: true });
mkcert(["-cert-file", CERT_FILE, "-key-file", KEY_FILE, ...names], { stdio: "inherit" });
// 端末に配るのは公開証明書だけ。認証局の秘密鍵（rootCA-key.pem）は絶対にコピーしない
fs.copyFileSync(path.join(caRoot, "rootCA.pem"), CA_FILE);

console.log("");
console.log("HTTPSの証明書を作りました。起動中のサーバーは数秒で自動的に読み込み直します。");
console.log("同じWi-Fiの端末から次のURLで開けます:");
[...hostNames, ...addresses].forEach((name) => console.log(`  https://${name}:${httpsPort}`));
console.log("");
console.log("はじめて開く端末では、先に認証局を入れてください（READMEの手順を参照）:");
console.log(`  http://${addresses[0] || hostNames[0]}:${process.env.PORT || 3000}/ca.crt`);
