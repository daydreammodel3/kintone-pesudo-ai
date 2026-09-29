// 同じWi-Fiの他PC・スマートフォンから開くURLを表示する（Dockerで起動した場合もホスト側で実行）
require("dotenv").config();

const fs = require("fs");
const { port, httpsPort } = require("../src/config");
const { CERT_FILE } = require("../src/tls");
const { lanAddresses, localHostName } = require("../src/network");

const addresses = lanAddresses();

if (!addresses.length) {
  console.log("LANのIPアドレスが見つかりません。Wi-Fiに接続しているか確認してください。");
  process.exit(1);
}

console.log("同じWi-Fiの他PC・スマートフォンから、次のURLを開いてください:");
addresses.forEach((address) => console.log(`  http://${address}:${port}`));

if (fs.existsSync(CERT_FILE)) {
  console.log("HTTPS:");
  [localHostName(), ...addresses].forEach((name) => console.log(`  https://${name}:${httpsPort}`));
  console.log("IPが変わったときは `npm run https:cert` で証明書を作り直してください。");
}
