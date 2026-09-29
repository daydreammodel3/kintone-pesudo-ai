const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

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

module.exports = { lanAddresses, isInDocker, localHostName };
