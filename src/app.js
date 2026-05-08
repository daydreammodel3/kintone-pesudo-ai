require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcryptjs");

const db = require("./db");
const { port, sessionSecret } = require("./config");
const { requireAuth } = require("./auth");
const { encrypt, decrypt } = require("./crypto");
const { addRecord, getRecords, normalizeDomain } = require("./kintone");
const { createJob, runJobInBackground, generateKintoneQueryFromInstruction } = require("./analysis");
const { POST_GET_FIELD_TYPES, FIELD_TYPE_CODES } = require("./fieldTypes");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isVercel = !!process.env.VERCEL;

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
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

app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;
  res.locals.error = req.session.flashError || null;
  res.locals.message = req.session.flashMessage || null;
  delete req.session.flashError;
  delete req.session.flashMessage;
  next();
});

function getUserTokens(userId) {
  const row = db.prepare("SELECT * FROM user_tokens WHERE user_id = ?").get(userId);
  if (!row) return null;

  return {
    domain: row.kintone_domain,
    appId: row.kintone_app_id,
    kintoneApiToken: decrypt(row.kintone_api_token_enc),
    copilotApiToken: decrypt(row.copilot_api_token_enc)
  };
}

function getManagedApps() {
  return db
    .prepare("SELECT id, app_name, kintone_domain, kintone_app_id FROM managed_kintone_apps ORDER BY app_name ASC")
    .all();
}

function getManagedAppById(appId) {
  return db
    .prepare("SELECT id, app_name, kintone_domain, kintone_app_id FROM managed_kintone_apps WHERE id = ?")
    .get(appId);
}

function getManagedAppFields(appId, mode) {
  if (mode === "post") {
    return db
      .prepare("SELECT id, field_name, field_type, field_code, can_post, can_get FROM managed_kintone_app_fields WHERE managed_app_id = ? AND can_post = 1 ORDER BY id ASC")
      .all(appId);
  }
  if (mode === "get") {
    return db
      .prepare("SELECT id, field_name, field_type, field_code, can_post, can_get FROM managed_kintone_app_fields WHERE managed_app_id = ? AND can_get = 1 ORDER BY id ASC")
      .all(appId);
  }
  return db
    .prepare("SELECT id, field_name, field_type, field_code, can_post, can_get FROM managed_kintone_app_fields WHERE managed_app_id = ? ORDER BY id ASC")
    .all(appId);
}

function getUserCopilotToken(userId) {
  const row = db.prepare("SELECT copilot_api_token_enc FROM user_copilot_tokens WHERE user_id = ?").get(userId);
  if (row) return decrypt(row.copilot_api_token_enc);

  const legacy = getUserTokens(userId);
  return legacy?.copilotApiToken || "";
}

function getUserKintoneTokenForApp(userId, managedAppId) {
  const row = db
    .prepare("SELECT kintone_api_token_enc FROM user_kintone_app_tokens WHERE user_id = ? AND managed_app_id = ?")
    .get(userId, managedAppId);
  if (row) return decrypt(row.kintone_api_token_enc);

  // Legacy fallback for older schema where domain/app were stored in user_tokens.
  const legacy = getUserTokens(userId);
  const app = getManagedAppById(managedAppId);
  if (!legacy || !app) return "";
  if (legacy.domain === app.kintone_domain && String(legacy.appId) === String(app.kintone_app_id)) {
    return legacy.kintoneApiToken;
  }
  return "";
}

function parseFieldInputValue(raw, fieldType) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to plain-text parsing
    }
  }

  if (fieldType === "CHECK_BOX" || fieldType === "MULTI_SELECT") {
    return text.split(",").map((v) => v.trim()).filter(Boolean);
  }

  if (fieldType === "USER_SELECT" || fieldType === "ORGANIZATION_SELECT" || fieldType === "GROUP_SELECT") {
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((code) => ({ code }));
  }

  if (fieldType === "FILE") {
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((fileKey) => ({ fileKey }));
  }

  if (fieldType === "CREATOR" || fieldType === "MODIFIER") {
    return { code: text };
  }

  return text;
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

app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  return res.render("login", { title: "ログイン" });
});

app.get("/register", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
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

app.post("/auth/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/dashboard", requireAuth, (req, res) => {
  const jobs = db
    .prepare("SELECT id, status, created_at, updated_at FROM analysis_jobs WHERE user_id = ? ORDER BY id DESC LIMIT 10")
    .all(req.session.userId);

  const appCount = db.prepare("SELECT COUNT(*) AS count FROM managed_kintone_apps").get().count;

  return res.render("dashboard", { title: "ダッシュボード", jobs, appCount });
});

app.get("/tokens", requireAuth, (req, res) => {
  const apps = getManagedApps();
  const appTokens = apps.map((app) => ({
    ...app,
    userKintoneToken: getUserKintoneTokenForApp(req.session.userId, app.id)
  }));
  const copilotApiToken = getUserCopilotToken(req.session.userId);

  return res.render("tokens", {
    title: "APIトークン管理",
    appTokens,
    copilotApiToken
  });
});

app.post("/tokens/copilot", requireAuth, (req, res) => {
  const existing = getUserCopilotToken(req.session.userId);
  const copilotApiToken = String(req.body.copilotApiToken || "").trim() || existing;
  if (!copilotApiToken) {
    req.session.flashError = "GitHub Copilot APIトークンを入力してください。";
    return res.redirect("/tokens");
  }

  db.prepare(`
    INSERT INTO user_copilot_tokens (user_id, copilot_api_token_enc)
    VALUES (?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET
      copilot_api_token_enc = excluded.copilot_api_token_enc,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.session.userId, encrypt(copilotApiToken));

  req.session.flashMessage = "Copilotトークンを保存しました（暗号化保存）。";
  return res.redirect("/tokens");
});

app.post("/tokens/kintone", requireAuth, (req, res) => {
  const managedAppId = Number(req.body.managedAppId);
  const app = getManagedAppById(managedAppId);
  if (!app) {
    req.session.flashError = "対象アプリが見つかりません。";
    return res.redirect("/tokens");
  }

  const existing = getUserKintoneTokenForApp(req.session.userId, managedAppId);
  const kintoneApiToken = String(req.body.kintoneApiToken || "").trim() || existing;
  if (!kintoneApiToken) {
    req.session.flashError = "kintone APIトークンを入力してください。";
    return res.redirect("/tokens");
  }

  db.prepare(`
    INSERT INTO user_kintone_app_tokens (user_id, managed_app_id, kintone_api_token_enc)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, managed_app_id)
    DO UPDATE SET
      kintone_api_token_enc = excluded.kintone_api_token_enc,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.session.userId, managedAppId, encrypt(kintoneApiToken));

  req.session.flashMessage = `kintone APIトークンを保存しました: ${app.app_name}`;
  return res.redirect("/tokens");
});

app.get("/apps/manage", requireAuth, (req, res) => {
  const apps = getManagedApps();
  const selectedAppId = Number(req.query.appId || apps[0]?.id || 0);
  const selectedApp = selectedAppId ? getManagedAppById(selectedAppId) : null;
  const fields = selectedApp ? getManagedAppFields(selectedApp.id) : [];

  return res.render("apps_manage", {
    title: "kintoneアプリ管理",
    apps,
    selectedApp,
    fields,
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
    db.prepare(`
      INSERT INTO managed_kintone_apps (kintone_domain, kintone_app_id, app_name)
      VALUES (?, ?, ?)
    `).run(domain, appId, appName);
    req.session.flashMessage = "共通アプリを追加しました。";
  } catch {
    req.session.flashError = "同じドメイン/アプリIDの組み合わせは既に登録されています。";
  }
  return res.redirect("/apps/manage");
});

app.post("/apps/manage/:appId/delete", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  db.prepare("DELETE FROM managed_kintone_apps WHERE id = ?").run(appId);
  req.session.flashMessage = "共通アプリを削除しました。";
  return res.redirect("/apps/manage");
});

app.post("/apps/manage/:appId/fields", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  const app = getManagedAppById(appId);
  if (!app) {
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

app.post("/apps/manage/:appId/fields/:fieldId/delete", requireAuth, (req, res) => {
  const appId = Number(req.params.appId);
  const fieldId = Number(req.params.fieldId);
  db.prepare("DELETE FROM managed_kintone_app_fields WHERE id = ? AND managed_app_id = ?").run(fieldId, appId);
  req.session.flashMessage = "フィールド定義を削除しました。";
  return res.redirect(`/apps/manage?appId=${appId}`);
});

app.get("/records/new", requireAuth, (req, res) => {
  const apps = getManagedApps();
  const selectedAppId = Number(req.query.appId || apps[0]?.id || 0);
  const selectedApp = selectedAppId ? getManagedAppById(selectedAppId) : null;
  const postFields = selectedApp ? getManagedAppFields(selectedApp.id, "post") : [];
  return res.render("record_create", { title: "1件登録", apps, selectedApp, postFields });
});

app.post("/records", requireAuth, async (req, res) => {
  const managedAppId = Number(req.body.managedAppId);
  const app = getManagedAppById(managedAppId);
  if (!app) {
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
      domain: app.kintone_domain,
      appId: app.kintone_app_id,
      apiToken: kintoneApiToken,
      record
    });

    req.session.flashMessage = `登録成功: record id=${result.id}, revision=${result.revision}`;
  } catch (error) {
    req.session.flashError = `登録失敗: ${error.message}`;
  }

  return res.redirect(`/records/new?appId=${managedAppId}`);
});

app.get("/records/analyze", requireAuth, (req, res) => {
  const jobs = db
    .prepare("SELECT id, status, created_at, updated_at, error FROM analysis_jobs WHERE user_id = ? ORDER BY id DESC LIMIT 20")
    .all(req.session.userId);

  const apps = getManagedApps();
  const selectedAppId = Number(req.query.appId || apps[0]?.id || 0);
  const selectedApp = selectedAppId ? getManagedAppById(selectedAppId) : null;
  const getFields = selectedApp ? getManagedAppFields(selectedApp.id, "get") : [];

  return res.render("analyze", { title: "レコード分析", jobs, apps, selectedApp, getFields });
});

app.post("/analysis/start", requireAuth, async (req, res) => {
  const managedAppId = Number(req.body.managedAppId);
  const app = getManagedAppById(managedAppId);
  if (!app) {
    req.session.flashError = "対象のkintoneアプリが見つかりません。";
    return res.redirect("/tokens");
  }

  const kintoneApiToken = getUserKintoneTokenForApp(req.session.userId, managedAppId);
  const copilotApiToken = getUserCopilotToken(req.session.userId);
  if (!kintoneApiToken || !copilotApiToken) {
    req.session.flashError = "先にAPIトークン管理でkintone/Copilotトークンを設定してください。";
    return res.redirect("/tokens");
  }

  const queryInstruction = String(req.body.query || "").trim();
  const getFields = getManagedAppFields(managedAppId, "get");

  try {
    const query = await generateKintoneQueryFromInstruction({
      copilotToken: copilotApiToken,
      instruction: queryInstruction,
      getFields
    });

    const records = await getRecords({
      domain: app.kintone_domain,
      appId: app.kintone_app_id,
      apiToken: kintoneApiToken,
      query
    });

    const jobId = createJob(req.session.userId, records);
    runJobInBackground({
      jobId,
      copilotToken: copilotApiToken,
      records
    });

    req.session.flashMessage = `分析ジョブを開始しました。Job ID: ${jobId} / 使用query: ${query || "(なし)"}`;
  } catch (error) {
    req.session.flashError = `分析開始に失敗: ${error.message}`;
  }

  return res.redirect("/records/analyze");
});

app.get("/analysis/jobs/:jobId", requireAuth, (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = db
    .prepare("SELECT * FROM analysis_jobs WHERE id = ? AND user_id = ?")
    .get(jobId, req.session.userId);

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`kintone擬似AI app listening on http://localhost:${port}`);
  });
}

module.exports = app;
