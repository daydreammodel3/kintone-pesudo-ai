require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcryptjs");

const db = require("./db");
const { port, sessionSecret, geminiModel, anthropicModel, copilotModel } = require("./config");
const { GUEST_LABEL, GUEST_PATHS, isGuest, requireAuth, requireViewer } = require("./auth");
const { addRecord, searchRecords, normalizeDomain, KintoneApiError } = require("./kintone");
const { createJob, runJobInBackground, generateKintoneQueryFromInstruction } = require("./analysis");
const { POST_GET_FIELD_TYPES, FIELD_TYPE_CODES } = require("./fieldTypes");
const {
  getManagedApps,
  getManagedAppById,
  getManagedAppFields,
  deleteManagedApp,
  updateAiPolicy,
  syncAppSchema,
  describeSyncSummary
} = require("./apps");
const {
  LLM_PROVIDERS,
  getUserCopilotToken,
  saveUserCopilotToken,
  getUserKintoneTokenForApp,
  saveUserKintoneTokenForApp,
  getUserLlmSettings,
  saveUserLlmSettings
} = require("./userSettings");
const { getLlmForUser } = require("./llm");
const { parseFieldInputValue } = require("./recordValues");
const { STATUS_LABELS, recordAiOperation, listAiOperations, countAiOperationsByStatus } = require("./aiLog");
const { listToolsForApp, toMcpToolList, TOOL_DEFINITIONS, ACCESS_LABELS } = require("./tools/kintoneTools");
const { runOperator } = require("./operator");
const { lanAddresses, isInDocker } = require("./network");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isVercel = !!process.env.VERCEL;

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.locals.statusLabels = STATUS_LABELS;
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/static", express.static(path.join(process.cwd(), "public")));

const sessionConfig = {
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
};

if (!isVercel) {
  sessionConfig.store = new SQLiteStore({ db: "sessions.db", dir: path.join(process.cwd(), "data") });
}

app.use(session(sessionConfig));

// 画面デザイン。新しいデザインは末尾に追加していく
const DESIGNS = [
  { code: "v1", label: "v1 クラシック" },
  { code: "v2", label: "v2 Bridge" },
  { code: "v3", label: "v3 DevOps" }
];
const DEFAULT_DESIGN = "v2";
// 旧名称のCookieを引き継ぐ
const LEGACY_DESIGN_NAMES = { classic: "v1", bridge: "v2" };
const DESIGN_COOKIE = "ui_design";

function resolveDesign(value) {
  const code = LEGACY_DESIGN_NAMES[value] || value;
  return DESIGNS.some((d) => d.code === code) ? code : DEFAULT_DESIGN;
}

function readCookie(req, name) {
  const pair = String(req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}

app.use((req, res, next) => {
  res.locals.design = resolveDesign(readCookie(req, DESIGN_COOKIE));
  res.locals.designs = DESIGNS;
  res.locals.currentUrl = req.originalUrl;
  res.locals.currentUser = req.session.username || null;
  res.locals.isGuest = isGuest(req);
  res.locals.guestPaths = GUEST_PATHS;
  res.locals.currentPath = req.path;
  res.locals.error = req.session.flashError || null;
  res.locals.message = req.session.flashMessage || null;
  delete req.session.flashError;
  delete req.session.flashMessage;
  next();
});

// 画面共有しても漏れないよう、保存済みトークンは末尾4桁のみ表示する
function maskSecret(secret) {
  if (!secret) return "";
  return `保存済み（…${secret.slice(-4)}）`;
}

function safeReturnTo(value, fallback) {
  const text = String(value || "");
  return text.startsWith("/") && !text.startsWith("//") ? text : fallback;
}

function describeError(error) {
  if (error instanceof KintoneApiError) {
    const prefix = error.isPermissionError ? "kintoneの権限で拒否されました" : "kintoneエラー";
    return `${prefix}: [${error.code || error.status}] ${error.kintoneMessage || error.message}`;
  }
  return error.message;
}

function buildRecordBodyFromForm({ postFields, body }) {
  const record = {};
  postFields.forEach((field) => {
    const inputName = `field_${field.id}`;
    const value = parseFieldInputValue(body[inputName], field.field_type);
    record[field.field_code] = { value };
  });
  return record;
}

function selectApp(apps, requestedId) {
  const selectedAppId = Number(requestedId || apps[0]?.id || 0);
  return selectedAppId ? getManagedAppById(selectedAppId) : null;
}

// v3（DevOps）のステータスバー: 使用中のAI・接続アプリ数・直近24時間の拒否/エラー件数
const PROVIDER_MODELS = { gemini: geminiModel, anthropic: anthropicModel, github: copilotModel };

app.use((req, res, next) => {
  if (res.locals.design !== "v3" || !req.session.userId) return next();
  const userId = req.session.userId;
  const settings = getUserLlmSettings(userId);
  const provider = LLM_PROVIDERS.find((p) => p.code === settings.provider);
  const hasKey = settings.provider === "gemini" ? !!settings.geminiApiKey
    : settings.provider === "anthropic" ? !!settings.anthropicApiKey
      : !!settings.copilotApiToken;
  const recent = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('denied_policy', 'denied_kintone') THEN 1 ELSE 0 END) AS denied,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
    FROM ai_operation_logs
    WHERE user_id = ? AND created_at >= datetime('now', '-1 day')
  `).get(userId);

  res.locals.opsStatus = {
    llmLabel: provider ? provider.label.replace(/（.*）/, "") : settings.provider,
    llmModel: PROVIDER_MODELS[settings.provider] || "",
    llmReady: hasKey && !provider?.retired,
    appCount: getManagedApps().length,
    denied24h: recent.denied || 0,
    errors24h: recent.errors || 0,
    env: process.env.VERCEL ? "vercel" : process.env.NODE_ENV || "local"
  };
  return next();
});

app.get("/", (req, res) => {
  if (req.session.userId || isGuest(req)) return res.redirect("/dashboard");
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.userId || isGuest(req)) return res.redirect("/dashboard");
  return res.render("login", { title: "ログイン" });
});

app.get("/register", (req, res) => {
  if (req.session.userId || isGuest(req)) return res.redirect("/dashboard");
  return res.render("register", { title: "ユーザー登録" });
});

app.post("/auth/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password || password.length < 8) {
    req.session.flashError = "ユーザー名と8文字以上のパスワードを入力してください。";
    return res.redirect("/register");
  }

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) {
    req.session.flashError = "そのユーザー名は既に使用されています。";
    return res.redirect("/register");
  }

  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);

  req.session.userId = Number(info.lastInsertRowid);
  req.session.username = username;
  req.session.flashMessage = "登録完了しました。";
  return res.redirect("/dashboard");
});

app.post("/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) {
    req.session.flashError = "ユーザー名またはパスワードが不正です。";
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    req.session.flashError = "ユーザー名またはパスワードが不正です。";
    return res.redirect("/login");
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  return res.redirect("/dashboard");
});

// プレゼン用: パスワードなしで閲覧専用のゲストとしてログイン
app.post("/auth/guest", (req, res) => {
  delete req.session.userId;
  req.session.role = "guest";
  req.session.username = GUEST_LABEL;
  return res.redirect("/dashboard");
});

app.post("/auth/logout", requireViewer, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// 分析ジョブ一覧。userId が null のときは全ユーザー分（ゲストの閲覧用）
function listAnalysisJobs(userId, limit) {
  return db
    .prepare(`
      SELECT j.id, j.status, j.created_at, j.updated_at, j.error, u.username
      FROM analysis_jobs j LEFT JOIN users u ON u.id = j.user_id
      WHERE (? IS NULL OR j.user_id = ?) ORDER BY j.id DESC LIMIT ?
    `)
    .all(userId, userId, limit);
}

app.get("/dashboard", requireViewer, (req, res) => {
  // ゲストはマネージャー視点で全ユーザー分を見る
  const userId = isGuest(req) ? null : req.session.userId;
  const jobs = listAnalysisJobs(userId, 5);

  const apps = getManagedApps();
  const fieldCount = db.prepare("SELECT COUNT(*) AS count FROM managed_kintone_app_fields WHERE source = 'kintone'").get().count;
  const opCounts = countAiOperationsByStatus(userId);
  const recentOps = listAiOperations({ userId, limit: 5 });
  let providerLabel;
  if (userId) {
    const llmSettings = getUserLlmSettings(userId);
    providerLabel = LLM_PROVIDERS.find((p) => p.code === llmSettings.provider)?.label || llmSettings.provider;
  } else {
    providerLabel = LLM_PROVIDERS.filter((p) => !p.retired).map((p) => p.label.replace(/（.*）/, "")).join(" / ");
  }

  return res.render("dashboard", {
    title: "ダッシュボード",
    jobs,
    apps,
    fieldCount,
    opCounts,
    recentOps,
    providerLabel
  });
});

app.get("/tokens", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const apps = getManagedApps();
  const appTokens = apps.map((managedApp) => ({
    ...managedApp,
    tokenStatus: maskSecret(getUserKintoneTokenForApp(userId, managedApp.id))
  }));
  const llmSettings = getUserLlmSettings(userId);

  return res.render("tokens", {
    title: "APIトークン・AI設定",
    appTokens,
    providers: LLM_PROVIDERS,
    llmProvider: llmSettings.provider,
    copilotStatus: maskSecret(getUserCopilotToken(userId)),
    geminiStatus: maskSecret(llmSettings.geminiApiKey),
    anthropicStatus: maskSecret(llmSettings.anthropicApiKey)
  });
});

app.post("/settings/llm", requireAuth, (req, res) => {
  const provider = String(req.body.provider || "");
  if (!LLM_PROVIDERS.some((p) => p.code === provider)) {
    req.session.flashError = "不明なAIプロバイダーです。";
    return res.redirect("/tokens");
  }
  saveUserLlmSettings(req.session.userId, {
    provider,
    geminiApiKey: String(req.body.geminiApiKey || "").trim(),
    anthropicApiKey: String(req.body.anthropicApiKey || "").trim()
  });
  req.session.flashMessage = "AI設定を保存しました（APIキーは暗号化保存）。";
  return res.redirect("/tokens");
});

app.post("/tokens/copilot", requireAuth, (req, res) => {
  const existing = getUserCopilotToken(req.session.userId);
  const copilotApiToken = String(req.body.copilotApiToken || "").trim() || existing;
  if (!copilotApiToken) {
    req.session.flashError = "GitHub Copilot APIトークンを入力してください。";
    return res.redirect("/tokens");
  }

  saveUserCopilotToken(req.session.userId, copilotApiToken);
  req.session.flashMessage = "Copilotトークンを保存しました（暗号化保存）。";
  return res.redirect("/tokens");
});

app.post("/tokens/kintone", requireAuth, async (req, res) => {
  const managedAppId = Number(req.body.managedAppId);
  const managedApp = getManagedAppById(managedAppId);
  if (!managedApp) {
    req.session.flashError = "対象アプリが見つかりません。";
    return res.redirect("/tokens");
  }

  const existing = getUserKintoneTokenForApp(req.session.userId, managedAppId);
  const kintoneApiToken = String(req.body.kintoneApiToken || "").trim() || existing;
  if (!kintoneApiToken) {
    req.session.flashError = "kintone APIトークンを入力してください。";
    return res.redirect("/tokens");
  }

  saveUserKintoneTokenForApp(req.session.userId, managedAppId, kintoneApiToken);

  // トークン保存と同時にスキーマを取り込む（フィールドの手入力は不要）
  try {
    const summary = await syncAppSchema({ app: managedApp, apiToken: kintoneApiToken });
    req.session.flashMessage = `kintone APIトークンを保存し、スキーマを同期しました: ${managedApp.app_name}（${describeSyncSummary(summary)}）`;
  } catch (error) {
    req.session.flashMessage = `kintone APIトークンを保存しました: ${managedApp.app_name}`;
    req.session.flashError = `スキーマ同期に失敗しました。${describeError(error)}`;
  }
  return res.redirect("/tokens");
});

app.get("/apps/manage", requireAuth, (req, res) => {
  const apps = getManagedApps();
  const selectedApp = selectApp(apps, req.query.appId);
  const fields = selectedApp ? getManagedAppFields(selectedApp.id) : [];
  const hasToken = selectedApp ? !!getUserKintoneTokenForApp(req.session.userId, selectedApp.id) : false;

  return res.render("apps_manage", {
    title: "kintoneアプリ管理",
    apps,
    selectedApp,
    fields,
    hasToken,
    fieldTypes: POST_GET_FIELD_TYPES
  });
});

app.post("/apps/manage", requireAuth, (req, res) => {
  const domain = normalizeDomain(req.body.kintoneDomain);
  const appId = String(req.body.kintoneAppId || "").trim();
  const appName = String(req.body.appName || "").trim();

  if (!domain || !appId || !appName) {
    req.session.flashError = "kintoneドメイン、アプリID、アプリ名は必須です。";
    return res.redirect("/apps/manage");
  }

  try {
    const info = db.prepare(`
      INSERT INTO managed_kintone_apps (kintone_domain, kintone_app_id, app_name)
      VALUES (?, ?, ?)
    `).run(domain, appId, appName);
    req.session.flashMessage = "共通アプリを追加しました。次に「APIトークン・AI設定」でこのアプリのトークンを保存すると、フィールドが自動で取り込まれます。";
    return res.redirect(`/apps/manage?appId=${info.lastInsertRowid}`);
  } catch {
    req.session.flashError = "同じドメイン/アプリIDの組み合わせは既に登録されています。";
  }
  return res.redirect("/apps/manage");
});

app.post("/apps/manage/:appId/delete", requireAuth, (req, res) => {
  deleteManagedApp(Number(req.params.appId));
  req.session.flashMessage = "共通アプリを削除しました。";
  return res.redirect("/apps/manage");
});

app.post("/apps/manage/:appId/sync", requireAuth, async (req, res) => {
  const appId = Number(req.params.appId);
  const returnTo = safeReturnTo(req.body.returnTo, `/apps/manage?appId=${appId}`);
  const managedApp = getManagedAppById(appId);
  if (!managedApp) {
    req.session.flashError = "対象アプリが見つかりません。";
    return res.redirect("/apps/manage");
  }

  const apiToken = getUserKintoneTokenForApp(req.session.userId, appId);
  if (!apiToken) {
    req.session.flashError = "スキーマ同期には、このアプリのkintone APIトークンが必要です。";
    return res.redirect("/tokens");
  }

  try {
    const summary = await syncAppSchema({ app: managedApp, apiToken });
    req.session.flashMessage = `kintoneからスキーマを同期しました（${describeSyncSummary(summary)}）`;
  } catch (error) {
    req.session.flashError = `スキーマ同期に失敗しました。${describeError(error)}`;
  }
  return res.redirect(returnTo);
});

app.post("/apps/manage/:appId/policy", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  if (!getManagedAppById(appId)) {
    req.session.flashError = "対象アプリが見つかりません。";
    return res.redirect("/apps/manage");
  }
  updateAiPolicy(appId, {
    canRead: !!req.body.aiCanRead,
    canCreate: !!req.body.aiCanCreate,
    canUpdate: !!req.body.aiCanUpdate
  });
  req.session.flashMessage = "AI操作ポリシーを更新しました。";
  return res.redirect(`/apps/manage?appId=${appId}`);
});

app.post("/apps/manage/:appId/fields", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  const managedApp = getManagedAppById(appId);
  if (!managedApp) {
    req.session.flashError = "対象アプリが見つかりません。";
    return res.redirect("/apps/manage");
  }

  const fieldName = String(req.body.fieldName || "").trim();
  const fieldType = String(req.body.fieldType || "").trim();
  const fieldCode = String(req.body.fieldCode || "").trim();
  const canPost = req.body.canPost ? 1 : 0;
  const canGet = req.body.canGet ? 1 : 0;

  if (!fieldName || !fieldType || !fieldCode) {
    req.session.flashError = "フィールド名、種別、コードは必須です。";
    return res.redirect(`/apps/manage?appId=${appId}`);
  }
  if (!FIELD_TYPE_CODES.has(fieldType)) {
    req.session.flashError = "サポート対象外のフィールド種別です。";
    return res.redirect(`/apps/manage?appId=${appId}`);
  }
  if (!canPost && !canGet) {
    req.session.flashError = "POSTまたはGETのいずれかは有効にしてください。";
    return res.redirect(`/apps/manage?appId=${appId}`);
  }

  try {
    db.prepare(`
      INSERT INTO managed_kintone_app_fields (managed_app_id, field_name, field_type, field_code, can_post, can_get)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(appId, fieldName, fieldType, fieldCode, canPost, canGet);
    req.session.flashMessage = "フィールド定義を追加しました。";
  } catch {
    req.session.flashError = "同じフィールドコードが既に登録されています。";
  }

  return res.redirect(`/apps/manage?appId=${appId}`);
});

app.post("/apps/manage/:appId/fields/:fieldId/flags", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  const fieldId = Number(req.params.fieldId);
  db.prepare(`
    UPDATE managed_kintone_app_fields
    SET can_post = ?, can_get = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND managed_app_id = ?
  `).run(req.body.canPost ? 1 : 0, req.body.canGet ? 1 : 0, fieldId, appId);
  req.session.flashMessage = "フィールドの公開範囲を更新しました。";
  return res.redirect(`/apps/manage?appId=${appId}`);
});

app.post("/apps/manage/:appId/fields/:fieldId/delete", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  const fieldId = Number(req.params.fieldId);
  db.prepare("DELETE FROM managed_kintone_app_fields WHERE id = ? AND managed_app_id = ?").run(fieldId, appId);
  req.session.flashMessage = "フィールド定義を削除しました。";
  return res.redirect(`/apps/manage?appId=${appId}`);
});

app.get("/records/new", requireAuth, (req, res) => {
  const apps = getManagedApps();
  const selectedApp = selectApp(apps, req.query.appId);
  const postFields = selectedApp ? getManagedAppFields(selectedApp.id, "post") : [];
  return res.render("record_create", { title: "1件登録", apps, selectedApp, postFields });
});

app.post("/records", requireAuth, async (req, res) => {
  const managedAppId = Number(req.body.managedAppId);
  const managedApp = getManagedAppById(managedAppId);
  if (!managedApp) {
    req.session.flashError = "対象のkintoneアプリが見つかりません。";
    return res.redirect("/tokens");
  }

  const postFields = getManagedAppFields(managedAppId, "post");
  if (!postFields.length) {
    req.session.flashError = "このアプリにPOST対象フィールドが設定されていません。";
    return res.redirect(`/records/new?appId=${managedAppId}`);
  }

  const kintoneApiToken = getUserKintoneTokenForApp(req.session.userId, managedAppId);
  if (!kintoneApiToken) {
    req.session.flashError = "先にAPIトークン管理で、このアプリのkintone APIトークンを保存してください。";
    return res.redirect("/tokens");
  }

  const record = buildRecordBodyFromForm({ postFields, body: req.body });

  try {
    const result = await addRecord({
      domain: managedApp.kintone_domain,
      appId: managedApp.kintone_app_id,
      apiToken: kintoneApiToken,
      record
    });

    req.session.flashMessage = `登録成功: record id=${result.id}, revision=${result.revision}`;
  } catch (error) {
    req.session.flashError = `登録失敗: ${describeError(error)}`;
  }

  return res.redirect(`/records/new?appId=${managedAppId}`);
});

app.get("/records/analyze", requireViewer, (req, res) => {
  if (isGuest(req)) {
    return res.render("analyze", { title: "分析結果", jobs: listAnalysisJobs(null, 20), apps: [], selectedApp: null, getFields: [] });
  }
  const jobs = listAnalysisJobs(req.session.userId, 20);

  const apps = getManagedApps();
  const selectedApp = selectApp(apps, req.query.appId);
  const getFields = selectedApp ? getManagedAppFields(selectedApp.id, "get") : [];

  return res.render("analyze", { title: "レコード分析", jobs, apps, selectedApp, getFields });
});

app.post("/analysis/start", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const managedAppId = Number(req.body.managedAppId);
  const managedApp = getManagedAppById(managedAppId);
  if (!managedApp) {
    req.session.flashError = "対象のkintoneアプリが見つかりません。";
    return res.redirect("/tokens");
  }

  const kintoneApiToken = getUserKintoneTokenForApp(userId, managedAppId);
  const { llm, error: llmError } = getLlmForUser(userId);
  if (!kintoneApiToken || llmError) {
    req.session.flashError = llmError || "先にAPIトークン管理でkintoneトークンを設定してください。";
    return res.redirect("/tokens");
  }

  const queryInstruction = String(req.body.query || "").trim();
  const getFields = getManagedAppFields(managedAppId, "get");
  const startedAt = Date.now();
  let query = "";

  try {
    query = await generateKintoneQueryFromInstruction({ llm, instruction: queryInstruction, getFields });

    const { records } = await searchRecords({
      domain: managedApp.kintone_domain,
      appId: managedApp.kintone_app_id,
      apiToken: kintoneApiToken,
      query,
      fields: getFields.length ? ["$id", ...getFields.map((f) => f.field_code)] : undefined
    });

    recordAiOperation({
      userId,
      managedAppId,
      appName: managedApp.app_name,
      source: "analysis",
      provider: llm.provider,
      model: llm.model,
      toolName: "kintone-get-records",
      access: "read",
      input: { instruction: queryInstruction, query },
      status: "ok",
      summary: `${records.length}件取得して分析ジョブへ`,
      durationMs: Date.now() - startedAt
    });

    const jobId = createJob(userId, records);
    runJobInBackground({ jobId, llm, records });

    req.session.flashMessage = `分析ジョブを開始しました。Job ID: ${jobId} / 使用query: ${query || "(なし)"}`;
  } catch (error) {
    if (error instanceof KintoneApiError) {
      recordAiOperation({
        userId,
        managedAppId,
        appName: managedApp.app_name,
        source: "analysis",
        provider: llm.provider,
        model: llm.model,
        toolName: "kintone-get-records",
        access: "read",
        input: { instruction: queryInstruction, query },
        status: error.isPermissionError ? "denied_kintone" : "error",
        summary: describeError(error),
        kintoneErrorCode: error.code || String(error.status),
        durationMs: Date.now() - startedAt
      });
    }
    req.session.flashError = `分析開始に失敗: ${describeError(error)}`;
  }

  return res.redirect("/records/analyze");
});

app.get("/analysis/jobs/:jobId", requireViewer, (req, res) => {
  const jobId = Number(req.params.jobId);
  const userId = isGuest(req) ? null : req.session.userId;
  const job = db
    .prepare("SELECT * FROM analysis_jobs WHERE id = ? AND (? IS NULL OR user_id = ?)")
    .get(jobId, userId, userId);

  if (!job) {
    return res.status(404).json({ error: "not_found" });
  }

  return res.json({
    id: job.id,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    result: job.result,
    error: job.error
  });
});

app.get("/operator", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const apps = getManagedApps();
  const selectedApp = selectApp(apps, req.query.appId);
  const tools = selectedApp ? listToolsForApp(selectedApp) : [];
  const { llm, error: llmError } = getLlmForUser(userId);

  return res.render("operator", {
    title: "AIオペレーター",
    apps,
    selectedApp,
    tools,
    allTools: TOOL_DEFINITIONS,
    accessLabels: ACCESS_LABELS,
    mcpToolsJson: JSON.stringify({ tools: toMcpToolList(tools) }, null, 2),
    hasToken: selectedApp ? !!getUserKintoneTokenForApp(userId, selectedApp.id) : false,
    llmLabel: llm ? `${llm.label} / ${llm.model}` : null,
    llmError
  });
});

app.post("/operator/chat", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const managedApp = getManagedAppById(Number(req.body.managedAppId));
  const message = String(req.body.message || "").trim();
  if (!managedApp || !message) {
    return res.status(400).json({ error: "アプリとメッセージを指定してください。" });
  }

  const apiToken = getUserKintoneTokenForApp(userId, managedApp.id);
  if (!apiToken) {
    return res.status(400).json({ error: "このアプリのkintone APIトークンが未設定です。" });
  }

  const { llm, error: llmError } = getLlmForUser(userId);
  if (llmError) {
    return res.status(400).json({ error: llmError });
  }

  const conversationId = /^[a-zA-Z0-9-]{8,64}$/.test(String(req.body.conversationId || ""))
    ? String(req.body.conversationId)
    : crypto.randomUUID();

  try {
    const result = await runOperator({
      llm,
      userId,
      app: managedApp,
      apiToken,
      conversationId,
      history: req.body.history,
      message
    });
    return res.json({ ...result, conversationId, provider: llm.label });
  } catch (error) {
    return res.status(502).json({ error: `AIの呼び出しに失敗しました: ${describeError(error)}` });
  }
});

// MCP tools/list と同じ形式で、AIに公開しているツールを返す
app.get("/api/tools", requireAuth, (req, res) => {
  const managedApp = getManagedAppById(Number(req.query.appId));
  if (!managedApp) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json({ tools: toMcpToolList(listToolsForApp(managedApp)) });
});

app.get("/audit", requireAuth, (req, res) => {
  const logs = listAiOperations({ userId: req.session.userId, limit: 200 });
  const counts = countAiOperationsByStatus(req.session.userId);
  return res.render("audit", { title: "AI操作ログ", logs, counts, accessLabels: ACCESS_LABELS });
});

// ログイン前の画面でも切り替えられるよう、認証は不要
app.post("/settings/design", (req, res) => {
  const design = String(req.body.design || "");
  if (DESIGNS.some((d) => d.code === design)) {
    res.cookie(DESIGN_COOKIE, design, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  }
  return res.redirect(safeReturnTo(req.body.returnTo, "/"));
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`kintone擬似AI app listening on http://localhost:${port}`);
    if (isInDocker()) {
      console.log("同じWi-Fiの他端末から開くURLは、ホスト側で `npm run lan-url` を実行すると表示されます。");
    } else {
      lanAddresses().forEach((address) => console.log(`  同じWi-Fiの他端末から: http://${address}:${port}`));
    }
  });
}

module.exports = app;
