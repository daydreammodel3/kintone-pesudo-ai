// Macの名前とは別に「<別名>.local」（既定は kinpai.local）を同じWi-Fiに公開する（ホスト側で実行）。
// macOS標準の dns-sd を使う。止めると別名も消えるので、プレゼン中は動かしたままにする。
// IPアドレスが変わったら自動で公開し直す。
require("dotenv").config();

const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { port, httpsPort, mdnsAlias } = require("../src/config");
const { CERT_FILE } = require("../src/tls");
const { lanAddresses, aliasHostName } = require("../src/network");

const CHECK_INTERVAL_MS = 5000;

if (process.platform !== "darwin") {
  console.error("このコマンドはMac専用です（dns-sd を使います）。");
  process.exit(1);
}

const hostName = aliasHostName();
if (!hostName) {
  console.error("MDNS_ALIAS が空のため、別名は公開しません。");
  process.exit(1);
}

if (fs.existsSync(CERT_FILE)) {
  const cert = new crypto.X509Certificate(fs.readFileSync(CERT_FILE));
  if (!cert.checkHost(hostName)) {
    console.warn(`いまの証明書に ${hostName} が入っていません。HTTPSで開くには \`npm run https:cert\` で作り直してください。`);
  }
}

let child = null;
let currentAddress = null;
let stopping = false;

function publish(address) {
  if (child) child.kill();
  child = null;
  currentAddress = address;
  if (!address) {
    console.log("LANのIPアドレスが見つかりません。Wi-Fiにつながるのを待っています…");
    return;
  }

  // dns-sd -P <名前> <種類> <ドメイン> <ポート> <ホスト名> <IP>: ホスト名 → IP の対応を代理で公開する
  const proc = spawn("dns-sd", ["-P", mdnsAlias, "_http._tcp", "local", String(port), hostName, address], {
    stdio: ["ignore", "ignore", "inherit"]
  });
  child = proc;
  proc.on("exit", (code) => {
    if (stopping || child !== proc) return;
    console.error(`dns-sd が終了しました（コード ${code}）。同じ名前が他の端末で使われていないか確認してください。`);
    process.exit(1);
  });

  console.log(`${hostName} → ${address} を公開しました。`);
  console.log(`  http://${hostName}:${port}`);
  if (fs.existsSync(CERT_FILE)) console.log(`  https://${hostName}:${httpsPort}`);
  console.log("止めるときは Ctrl+C を押してください（別名も消えます）。");
}

publish(lanAddresses()[0] || null);

setInterval(() => {
  const address = lanAddresses()[0] || null;
  if (address === currentAddress) return;
  console.log(`IPアドレスが変わりました（${currentAddress || "なし"} → ${address || "なし"}）。`);
  publish(address);
}, CHECK_INTERVAL_MS);

function stop() {
  stopping = true;
  if (child) child.kill();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
