// 同じWi-Fiの他PC・スマートフォンから開くURLを表示する（Dockerで起動した場合もホスト側で実行）
require("dotenv").config();

const { lanAddresses } = require("../src/network");

const port = Number(process.env.PORT || 3000);
const addresses = lanAddresses();

if (!addresses.length) {
  console.log("LANのIPアドレスが見つかりません。Wi-Fiに接続しているか確認してください。");
  process.exit(1);
}

console.log("同じWi-Fiの他PC・スマートフォンから、次のURLを開いてください:");
addresses.forEach((address) => console.log(`  http://${address}:${port}`));
