#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const INCIDENTS = ["アラート", "問い合わせ"];
const PRIORITIES = ["緊急", "高", "中", "低"];

const COMPONENTS = [
  "認証API",
  "分析ジョブ",
  "通知連携",
  "kintone同期処理",
  "CSV出力処理",
  "画面表示ロジック",
  "バッチ連携処理",
  "アラート集計処理",
  "添付ファイル連携",
  "検索インデックス更新"
];

const ENVIRONMENTS = ["本番", "検証", "ステージング", "開発"];
const REPORTERS = ["運用担当", "業務部門", "監視チーム", "カスタマーサポート", "営業担当", "システム管理者"];
const CHANNELS = ["メール", "電話", "チャット", "定例会", "監視通知"];

const ALERT_EVENTS = [
  "応答遅延", "タイムアウト", "エラー率上昇", "ジョブ失敗", "CPU高騰", "メモリ逼迫", "DB接続断", "通知遅延"
];
const ALERT_SYMPTOMS = [
  "リトライ回数が急増", "処理キューが滞留", "一部画面が白画面化", "外部連携が断続失敗", "API成功率が低下"
];
const ALERT_IMPACTS = [
  "一部ユーザーで操作不可", "帳票出力に遅延", "通知の到達遅れ", "問い合わせ件数の増加", "定期連携の未完了"
];
const ALERT_REQUESTS = [
  "一次切り分けを実施してください", "関連ログを採取してください", "暫定対処の可否を判断してください", "影響範囲を共有してください", "恒久対策の草案を作成してください"
];

const INQUIRY_THEMES = [
  "検索結果の不一致", "CSV出力の不足", "表示更新の遅延", "通知未達", "権限エラー", "登録後の反映遅れ", "集計値のずれ", "添付ファイル操作"
];
const INQUIRY_DETAILS = [
  "同条件で再検索しても結果件数が変動する", "保存直後に画面再読込すると値が戻る場合がある", "特定手順でボタン押下後に画面が固まる", "権限変更後も挙動が変わらない", "一部レコードのみ一覧に表示されない"
];
const INQUIRY_EXPECTATIONS = [
  "期待値と現状の差分整理", "再現手順の明文化", "回避策の提示", "恒久対応の見通し", "利用者向け案内文の作成"
];
const INQUIRY_STEPS = [
  "1) 一覧画面を開く",
  "2) 条件を入力して検索",
  "3) 対象レコードを更新",
  "4) 再読込して結果を確認"
];

function parseArgs(argv) {
  const args = {
    count: 50,
    output: path.join(process.cwd(), "data", "demo_records.csv")
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--count" && argv[i + 1]) {
      args.count = Math.max(1, Number(argv[i + 1]) || 50);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

function pickOne(items) {
  return items[randomInt(items.length)];
}

function pickSome(items, count) {
  const pool = [...items];
  const out = [];
  const target = Math.min(Math.max(0, count), pool.length);
  for (let i = 0; i < target; i += 1) {
    const idx = randomInt(pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function randomAlphaNum(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function randomDeadlineWithin120Days() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = randomInt(121);
  const out = new Date(today);
  out.setDate(today.getDate() + offset);
  return formatDate(out);
}

function nowTimestampText() {
  const now = randomTimestampInPastDays(45);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function randomTimestampInPastDays(days) {
  const now = Date.now();
  const rangeMs = days * 24 * 60 * 60 * 1000;
  const randomPast = now - randomInt(rangeMs + 1);
  return new Date(randomPast);
}

function randomCount(min, max) {
  return min + randomInt(max - min + 1);
}

function buildTitle(incident) {
  const component = pickOne(COMPONENTS);
  const env = pickOne(ENVIRONMENTS);

  if (incident === "アラート") {
    const event = pickOne(ALERT_EVENTS);
    const templates = [
      `${env}環境で${component}の${event}を検知`,
      `${component}で${event}が連続発生`,
      `監視アラート: ${component} ${event}`,
      `${component}の異常兆候(${event})について`
    ];
    return pickOne(templates);
  }

  const theme = pickOne(INQUIRY_THEMES);
  const templates = [
    `${component}に関する問い合わせ: ${theme}`,
    `${env}環境での${theme}について確認依頼`,
    `${theme}が発生する件について`,
    `${component}の利用時における${theme}`
  ];
  return pickOne(templates);
}

function buildContent(incident) {
  const values = {
    timestamp: nowTimestampText(),
    component: pickOne(COMPONENTS),
    environment: pickOne(ENVIRONMENTS),
    reporter: pickOne(REPORTERS),
    channel: pickOne(CHANNELS)
  };

  if (incident === "アラート") {
    const symptoms = pickSome(ALERT_SYMPTOMS, randomCount(1, 2));
    const impacts = pickSome(ALERT_IMPACTS, randomCount(1, 2));
    const requests = pickSome(ALERT_REQUESTS, randomCount(2, 3));
    const lines = [
      "【概要】",
      `${values.environment}環境の${values.component}で異常アラートを検知しました。`,
      `検知時刻: ${values.timestamp}`,
      `通報元: ${values.reporter} / ${values.channel}`,
      "",
      "【観測された症状】",
      ...symptoms.map((s) => `- ${s}`),
      "",
      "【想定される影響】",
      ...impacts.map((i) => `- ${i}`),
      "",
      "【依頼事項】",
      ...requests.map((r) => `- ${r}`),
      "",
      "備考: 関連ログの保存期間に注意し、調査開始時刻を記録してください。"
    ];
    return lines.join("\n");
  }

  const details = pickSome(INQUIRY_DETAILS, randomCount(1, 2));
  const expectations = pickSome(INQUIRY_EXPECTATIONS, randomCount(2, 3));
  const steps = pickSome(INQUIRY_STEPS, randomCount(2, 4));
  const lines = [
    "【問い合わせ概要】",
    `${values.reporter}より${values.channel}で連絡がありました。`,
    `受付時刻: ${values.timestamp}`,
    `対象: ${values.environment}環境 / ${values.component}`,
    "",
    "【申告内容】",
    ...details.map((d) => `- ${d}`),
    "",
    "【再現手順(申告ベース)】",
    ...steps,
    "",
    "【依頼事項】",
    ...expectations.map((e) => `- ${e}`),
    "",
    "補足: 画面キャプチャと操作時刻を取得できる場合は添付予定です。"
  ];

  return lines.join("\n");
}

function buildReceptionNumber(incident) {
  const prefix = incident === "アラート" ? "ALT" : "QST";
  return `${prefix}${randomAlphaNum(17)}`;
}

function escapeCsv(value) {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function buildRecord() {
  const incident = pickOne(INCIDENTS);
  return {
    インシデント: incident,
    受付番号: buildReceptionNumber(incident),
    優先度: pickOne(PRIORITIES),
    作業期限: randomDeadlineWithin120Days(),
    タイトル: buildTitle(incident),
    内容: buildContent(incident)
  };
}

function toCsv(records) {
  const headers = ["インシデント", "受付番号", "優先度", "作業期限", "タイトル", "内容"];
  const lines = [headers.join(",")];

  for (const record of records) {
    const row = headers.map((key) => escapeCsv(record[key]));
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const records = Array.from({ length: args.count }, () => buildRecord());
  const csv = toCsv(records);

  ensureDir(args.output);
  fs.writeFileSync(args.output, csv, "utf8");

  console.log(`Generated ${records.length} demo records.`);
  console.log(`Output: ${args.output}`);
}

main();
