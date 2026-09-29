/**
 * AIに公開するkintone操作ツール群。
 *
 * 定義は MCP (Model Context Protocol) の tools/list と同じ形
 * { name, description, inputSchema } で持ち、命名もサイボウズ公式の
 * kintone MCPサーバーに倣っている。将来このアプリ自体をMCPサーバーとして
 * 公開する場合も、この定義と executeTool() をそのまま再利用できる。
 *
 * ガバナンスは二段構え:
 *   1. アプリ側ポリシー … どのツールをAIに見せるか（読み取り/登録/更新）と、
 *                         どのフィールドを読み書きさせるか（GET/POST対象）
 *   2. kintone側の権限 … APIトークンに付与された権限。拒否はそのままAIとログに返す
 */
const { searchRecords, addRecord, updateRecord, KintoneApiError } = require("../kintone");
const { getManagedAppById, getManagedAppFields, syncAppSchema, describeSyncSummary } = require("../apps");
const { buildRecordFromPlainObject, simplifyRecord } = require("../recordValues");
const { recordAiOperation } = require("../aiLog");

const ACCESS_LABELS = { read: "読み取り", create: "登録", update: "更新" };

class PolicyDeniedError extends Error {}

const recordValueSchema = {
  type: "object",
  description: "フィールドコードをキー、値をバリューとするオブジェクト。例: {\"タイトル\": \"...\", \"優先度\": \"高\"}。チェックボックス等の複数値は配列で指定。",
  additionalProperties: true
};

const TOOL_DEFINITIONS = [
  {
    name: "kintone-get-form-fields",
    access: "read",
    description: "対象kintoneアプリの最新のフィールド構成（フィールドコード・名称・種別・選択肢・必須・AIが読み書きできるか）を取得します。レコードを読み書きする前に必ず呼び出してください。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(ctx) {
      const summary = await syncAppSchema({ app: ctx.app, apiToken: ctx.apiToken });
      const fields = getManagedAppFields(ctx.app.id)
        .filter((f) => f.can_get || f.can_post)
        .map((f) => ({
          code: f.field_code,
          label: f.field_name,
          type: f.field_type,
          required: !!f.required,
          options: f.options.length ? f.options : undefined,
          readable: !!f.can_get,
          writable: !!f.can_post
        }));
      return {
        summary: `スキーマ同期: ${describeSyncSummary(summary)}`,
        content: { app: ctx.app.app_name, fields }
      };
    }
  },
  {
    name: "kintone-get-records",
    access: "read",
    description: "kintoneクエリ記法でレコードを検索します。返されるのはAIが読み取りを許可されたフィールドのみです。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "kintoneのクエリ文字列。フィールドコードを使う。例: 優先度 in (\"高\", \"緊急\") and 作業期限 <= \"2026-10-31\" order by 作業期限 asc。空文字なら全件。limit句は不要。"
        },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "取得件数（既定20、最大100）" }
      },
      required: ["query"],
      additionalProperties: false
    },
    async handler(ctx, input) {
      const readable = getManagedAppFields(ctx.app.id, "get");
      if (!readable.length) {
        throw new PolicyDeniedError("読み取りを許可されたフィールドがありません。");
      }
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
      const baseQuery = String(input.query || "").replace(/\s+limit\s+\d+(\s+offset\s+\d+)?\s*$/i, "").trim();
      const result = await searchRecords({
        domain: ctx.app.kintone_domain,
        appId: ctx.app.kintone_app_id,
        apiToken: ctx.apiToken,
        query: `${baseQuery} limit ${limit}`.trim(),
        fields: ["$id", ...readable.map((f) => f.field_code)],
        totalCount: true
      });
      return {
        summary: `${result.records.length}件取得（該当 ${result.totalCount ?? "?"}件） query: ${result.query}`,
        content: {
          totalCount: result.totalCount,
          returned: result.records.length,
          records: result.records.map(simplifyRecord)
        }
      };
    }
  },
  {
    name: "kintone-add-record",
    access: "create",
    description: "kintoneにレコードを1件登録します。書き込みを許可されたフィールドのみ指定できます。選択肢フィールドは選択肢の値と完全一致させてください。",
    inputSchema: {
      type: "object",
      properties: { record: recordValueSchema },
      required: ["record"],
      additionalProperties: false
    },
    async handler(ctx, input) {
      const { record, denied } = buildRecordFromPlainObject(getManagedAppFields(ctx.app.id, "post"), input.record);
      if (denied.length) {
        throw new PolicyDeniedError(`書き込みが許可されていないフィールドです: ${denied.join(", ")}`);
      }
      if (!Object.keys(record).length) {
        throw new Error("登録するフィールドが指定されていません。");
      }
      const result = await addRecord({
        domain: ctx.app.kintone_domain,
        appId: ctx.app.kintone_app_id,
        apiToken: ctx.apiToken,
        record
      });
      return {
        summary: `レコード id=${result.id} を登録`,
        content: { id: result.id, revision: result.revision }
      };
    }
  },
  {
    name: "kintone-update-record",
    access: "update",
    description: "既存のkintoneレコードを1件更新します。レコードIDは kintone-get-records の $id で確認してください。書き込みを許可されたフィールドのみ更新できます。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "更新するレコードID（$id）" },
        record: recordValueSchema
      },
      required: ["id", "record"],
      additionalProperties: false
    },
    async handler(ctx, input) {
      const { record, denied } = buildRecordFromPlainObject(getManagedAppFields(ctx.app.id, "post"), input.record);
      if (denied.length) {
        throw new PolicyDeniedError(`書き込みが許可されていないフィールドです: ${denied.join(", ")}`);
      }
      const result = await updateRecord({
        domain: ctx.app.kintone_domain,
        appId: ctx.app.kintone_app_id,
        apiToken: ctx.apiToken,
        id: String(input.id),
        record
      });
      return {
        summary: `レコード id=${input.id} を更新（revision ${result.revision}）`,
        content: { id: String(input.id), revision: result.revision }
      };
    }
  }
];

function isAllowedByPolicy(app, access) {
  if (access === "read") return !!app.ai_can_read;
  if (access === "create") return !!app.ai_can_create;
  if (access === "update") return !!app.ai_can_update;
  return false;
}

// アプリ側ポリシーで許可されたツールだけをAIに見せる
function listToolsForApp(app) {
  return TOOL_DEFINITIONS.filter((t) => isAllowedByPolicy(app, t.access));
}

// MCP tools/list 形式
function toMcpToolList(tools) {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

function describeKintoneError(error) {
  const detail = error.errors ? ` ${JSON.stringify(error.errors)}` : "";
  return `[${error.code || error.status}] ${error.kintoneMessage || error.message}${detail}`;
}

/**
 * ツールを実行し、結果を操作ログに記録する。
 * ctx: { userId, app, apiToken, conversationId, source, provider, model }
 * 返り値: { content, isError, step }（content はAIに返す内容、step は画面表示用）
 */
async function executeTool(ctx, name, input) {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
  const access = tool?.access || "unknown";
  const startedAt = Date.now();
  let status = "ok";
  let summary = "";
  let kintoneErrorCode = null;
  let content;

  // 実行直前に最新のポリシーを読み直す（会話中に設定が変わっても即反映）
  const app = getManagedAppById(ctx.app.id) || ctx.app;

  try {
    if (!tool) {
      throw new PolicyDeniedError(`未知のツールです: ${name}`);
    }
    if (!isAllowedByPolicy(app, tool.access)) {
      throw new PolicyDeniedError(`このアプリではAIによる「${ACCESS_LABELS[tool.access]}」が許可されていません。`);
    }
    const result = await tool.handler({ ...ctx, app }, input || {});
    summary = result.summary;
    content = result.content;
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      status = "denied_policy";
      summary = `アプリ側ポリシーで拒否: ${error.message}`;
    } else if (error instanceof KintoneApiError && error.isPermissionError) {
      status = "denied_kintone";
      kintoneErrorCode = error.code || String(error.status);
      summary = `kintoneの権限で拒否: ${describeKintoneError(error)}`;
    } else if (error instanceof KintoneApiError) {
      status = "error";
      kintoneErrorCode = error.code || String(error.status);
      summary = `kintoneエラー: ${describeKintoneError(error)}`;
    } else {
      status = "error";
      summary = error.message;
    }
    content = { error: summary };
  }

  const durationMs = Date.now() - startedAt;
  recordAiOperation({
    userId: ctx.userId,
    managedAppId: app.id,
    appName: app.app_name,
    conversationId: ctx.conversationId,
    source: ctx.source,
    provider: ctx.provider,
    model: ctx.model,
    toolName: name,
    access,
    input,
    status,
    summary,
    kintoneErrorCode,
    durationMs
  });

  return {
    content,
    isError: status !== "ok",
    step: { tool: name, access, input, status, summary, durationMs }
  };
}

module.exports = {
  TOOL_DEFINITIONS,
  ACCESS_LABELS,
  listToolsForApp,
  toMcpToolList,
  executeTool
};
