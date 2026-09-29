// Claude API（Anthropic公式SDK）プロバイダー
const Anthropic = require("@anthropic-ai/sdk");
const { anthropicModel, anthropicEffort, anthropicFallbacks, anthropicTimeoutMs } = require("../config");

function buildRequest({ system, messages, tools }) {
  const params = {
    model: anthropicModel,
    max_tokens: 16000,
    system,
    messages
  };
  if (tools && tools.length) {
    params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }
  if (anthropicEffort) {
    params.output_config = { effort: anthropicEffort };
  }
  if (anthropicFallbacks !== "off") {
    // 安全性分類器による拒否時に、サーバー側で推奨モデルへ自動フォールバックする
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

function textOf(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function createAnthropicProvider({ apiKey }) {
  const client = new Anthropic({ apiKey, timeout: anthropicTimeoutMs });

  async function create(params) {
    let response;
    try {
      response = await client.beta.messages.create(buildRequest(params));
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error("Claude APIキーが無効です。「APIトークン・AI設定」を確認してください。");
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new Error("Claude APIのレート制限に達しました。少し待ってから再実行してください。");
      }
      throw error;
    }
    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category;
      throw new Error(`Claudeが応答を辞退しました${category ? `（${category}）` : ""}。依頼内容を見直してください。`);
    }
    return response;
  }

  return {
    provider: "anthropic",
    label: "Claude API",
    model: anthropicModel,

    async chat({ system, user }) {
      const response = await create({ system, messages: [{ role: "user", content: user }] });
      const text = textOf(response);
      if (!text) {
        throw new Error("Claude API response has no text content.");
      }
      return text;
    },

    async runAgent({ system, history, tools, executeTool, maxSteps }) {
      const messages = [...history];

      for (let step = 0; step < maxSteps; step += 1) {
        const response = await create({ system, messages, tools });
        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "pause_turn") continue;

        const toolUses = response.content.filter((b) => b.type === "tool_use");
        if (!toolUses.length || response.stop_reason !== "tool_use") {
          return { text: textOf(response) };
        }

        const results = [];
        for (const toolUse of toolUses) {
          const result = await executeTool(toolUse.name, toolUse.input || {});
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result.content),
            is_error: !!result.isError
          });
        }
        messages.push({ role: "user", content: results });
      }

      return { text: "ツール呼び出しの上限回数に達したため、処理を中断しました。依頼を分けて再度お試しください。" };
    }
  };
}

module.exports = { createAnthropicProvider };
