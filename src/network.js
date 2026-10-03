const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { mdnsAlias } = require("./config");

// 同じWi-Fi（LAN）の他端末からアクセスできるIPv4アドレスの一覧
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => net.address);
}

// Dockerコンテナ内ではホスト（Mac）のLAN側IPが見えない
function isInDocker() {
  return fs.existsSync("/.dockerenv");
}

// IPが変わっても同じ名前で開けるよう、Bonjour（mDNS）の「<名前>.local」を使う
function localHostName() {
  let name = "";
  if (process.platform === "darwin") {
    try {
      name = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
    } catch {
      // 取得できなければ os.hostname() を使う
    }
  }
  name = name || os.hostname().split(".")[0];
  return `${name.toLowerCase()}.local`;
}

// Macの名前とは別に、npm run mdns-alias で公開する「<別名>.local」（未設定なら null）
function aliasHostName() {
  return mdnsAlias ? `${mdnsAlias.toLowerCase()}.local` : null;
}

// HTTPSで案内する名前（別名 → Macの名前 の順）
function localHostNames() {
  return [aliasHostName(), localHostName()].filter(Boolean);
}

module.exports = { lanAddresses, isInDocker, localHostName, aliasHostName, localHostNames };
