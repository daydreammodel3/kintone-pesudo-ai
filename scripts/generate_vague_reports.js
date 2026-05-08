#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const INCIDENTS = ["アラート", "問い合わせ"];
const PRIORITIES = ["緊急", "高", "中", "低"];

const ALERT_TITLE_PARTS = [
  "挙動が不安定な件",
  "しきい値超過に見える件",
  "監視通知の内容が曖昧な件",
  "断続的な異常が出る件",
  "復旧したか判断しづらい件"
];

const INQUIRY_TITLE_PARTS = [
  "表示内容が時々違う件",
  "結果が一定しない件",
  "想定どおりか判断しづらい件",
  "再現条件が不明な件",
  "問い合わせ内容の整理依頼"
];

const OPENERS = [
  "さきほどから何となくおかしい気がします。",
  "たぶん不具合だと思うのですが、断言はできません。",
  "同じ操作をしても毎回同じ結果にはなりません。",
  "いつからか分かりませんが、以前より挙動が違います。",
  "状況をうまく説明できないのですが、気になる点があります。"
];

const UNCERTAIN_WHEN = [
  "今朝くらいからのようです。",
  "昨日の夕方には起きていた気もします。",
  "正確な時刻は控えていません。",
  "再現タイミングは一定ではありません。",
  "特定の時間帯だけかもしれません。"
];

const UNCERTAIN_SCOPE = [
  "一部のユーザーだけか、全体かは未確認です。",
  "自分の環境だけの可能性もあります。",
  "他画面でも同様かは確認できていません。",
  "本番だけか検証環境でも起きるか不明です。",
  "ネットワーク要因かもしれず切り分けできていません。"
];

const CONTRADICTIONS = [
  "先ほどは直ったように見えましたが、また発生しました。",
  "同じ操作でも成功したり失敗したりします。",
  "更新されたように見えますが、再読込すると戻ることがあります。",
  "エラー表示は出ないのに完了していないようです。",
  "問題ない時もあるので再現条件が特定できません。"
];

const MISSING_INFO = [
  "画面キャプチャは取得していません。",
  "エラーコードは控えていません。",
  "どのボタンだったか曖昧です。",
  "手順は覚えている範囲で記載します。",
  "直前に別作業をしていたので因果関係は不明です。"
];

const ACTION_REQUESTS = [
  "まず見てもらえると助かります。",
  "急ぎではないですが確認をお願いします。",
  "優先度はお任せしますが対応いただきたいです。",
  "念のため調査してもらえると安心です。",
  "必要なら追加で確認します。"
];

const EXTRA_NOISE = [
  "ブラウザ再起動後は一時的に落ち着きました。",
  "キャッシュ削除は試しましたが関係あるか分かりません。",
  "他のタブを閉じると改善したような気もします。",
  "通信が遅いだけの可能性もあります。",
  "以前も似たことがあった気がしますが記録がありません。"
];

function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

function pickOne(items) {
  return items[randomInt(items.length)];
}

function pickSome(items, min, max) {
  const count = min + randomInt(max - min + 1);
  const pool = [...items];
  const out = [];

  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const idx = randomInt(pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return out;
}

function parseArgs(argv) {
  const args = {
    count: 30,
    output: path.join(process.cwd(), "data", "vague_reports.csv"),
    format: "csv"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--count" && argv[i + 1]) {
      args.count = Math.max(1, Number(argv[i + 1]) || 30);
      i += 1;
      continue;
    }

    if (token === "--output" && argv[i + 1]) {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token === "--format" && argv[i + 1]) {
      const v = String(argv[i + 1]).toLowerCase();
      if (v === "csv" || v === "txt" || v === "jsonl") {
        args.format = v;
      }
      i += 1;
    }
  }

  return args;
}

function buildVagueReport() {
  const lines = [
    pickOne(OPENERS),
    pickOne(UNCERTAIN_WHEN),
    pickOne(UNCERTAIN_SCOPE),
    pickOne(CONTRADICTIONS),
    ...pickSome(EXTRA_NOISE, 1, 2),
    pickOne(MISSING_INFO),
    pickOne(ACTION_REQUESTS)
  ];

  return lines.join("\n");
}

function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

function pickOne(items) {
  return items[randomInt(items.length)];
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

function randomDateWithin120Days() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = randomInt(121);
  const out = new Date(today);
  out.setDate(today.getDate() + offset);
  return out;
}

function buildWorkPeriod() {
  const start = randomDateWithin120Days();
  const end = new Date(start);
  end.setDate(start.getDate() + randomInt(15));
  return `${formatDate(start)}〜${formatDate(end)}`;
}

function buildReceptionNumber(incident) {
  const prefix = incident === "アラート" ? "ALT" : "QST";
  return `${prefix}${randomAlphaNum(17)}`;
}

function buildTitle(incident) {
  if (incident === "アラート") {
    return pickOne(ALERT_TITLE_PARTS);
  }
  return pickOne(INQUIRY_TITLE_PARTS);
}

function buildRecord() {
  const incident = pickOne(INCIDENTS);
  return {
    インシデント: incident,
    受付番号: buildReceptionNumber(incident),
    優先度: pickOne(PRIORITIES),
    作業期間: buildWorkPeriod(),
    タイトル: buildTitle(incident),
    内容: buildVagueReport()
  };
}

function escapeCsv(value) {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function renderCsv(records) {
  const headers = ["インシデント", "受付番号", "優先度", "作業期間", "タイトル", "内容"];
  const lines = [headers.join(",")];
  for (const record of records) {
    const row = headers.map((key) => escapeCsv(record[key]));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function renderTxt(records) {
  const blocks = [];
  for (let i = 0; i < records.length; i += 1) {
    blocks.push(`--- report ${i + 1} ---`);
    blocks.push(`インシデント: ${records[i].インシデント}`);
    blocks.push(`受付番号: ${records[i].受付番号}`);
    blocks.push(`優先度: ${records[i].優先度}`);
    blocks.push(`作業期間: ${records[i].作業期間}`);
    blocks.push(`タイトル: ${records[i].タイトル}`);
    blocks.push("内容:");
    blocks.push(records[i].内容);
    blocks.push("");
  }
  return blocks.join("\n");
}

function renderJsonl(records) {
  return records.map((record, idx) => JSON.stringify({ id: idx + 1, ...record })).join("\n");
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const records = Array.from({ length: args.count }, () => buildRecord());

  let outputText = "";
  if (args.format === "txt") {
    outputText = renderTxt(records);
  } else if (args.format === "jsonl") {
    outputText = renderJsonl(records);
  } else {
    outputText = renderCsv(records);
  }

  ensureDir(args.output);
  fs.writeFileSync(args.output, outputText, "utf8");

  console.log(`Generated ${records.length} vague reports.`);
  console.log(`Format: ${args.format}`);
  console.log(`Output: ${args.output}`);
}

main();
