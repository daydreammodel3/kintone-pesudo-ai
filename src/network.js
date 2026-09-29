const fs = require("fs");
const os = require("os");

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

module.exports = { lanAddresses, isInDocker };
