// GitHub Models（OpenAI互換 /chat/completions）プロバイダー
const { copilotApiBase, copilotModel, copilotTimeoutMs } = require("../config");

// GitHub Models は 2026-07-30 に提供終了。旧Azureエンドポイントは名前解決できず、
// 新エンドポイントも "OK" を返すだけのスタブになっている。
const RETIRED_HINT = "GitHub Modelsは2026年7月30日に提供終了しています。「トークン・AI設定」で使用するAIをGemini APIに切り替えてください。";

function describeFetchError(error) {
  if (error.name === "AbortError") {
    return `AI APIの応答が${copilotTimeoutMs}msでタイムアウトしました。`;
  }
  // Node の fetch はネットワーク障害をすべて "fetch failed" にまとめるため、原因(cause)を添える
  const cause = error.cause;
  const detail = cause ? `${cause.code || cause.name}${cause.hostname ? ` ${cause.hostname}` : ""}` : error.message;
  return `AI API（${copilotApiBase}）に接続できません: ${detail}。${RETIRED_HINT}`;
}

async function chatCompletion({ token, messages, tools, temperature }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), copilotTimeoutMs);

  try {
    const payload = {
      model: copilotModel,
      messages,
      temperature: temperature ?? 0.2
    };
    if (tools && tools.length) {
      payload.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema }
      }));
    }

    let response;
    try {
      response = await fetch(`${copilotApiBase}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new Error(describeFetchError(error));
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Copilot API failed: ${response.status} ${JSON.stringify(body)}`);
    }

    const message = body?.choices?.[0]?.message;
    if (!message) {
      throw new Error(`AI API（${copilotApiBase}）から有効な応答がありません。${RETIRED_HINT}`);
    }
    return message;
  } finally {
    clearTimeout(timeout);
  }
}

function createGithubProvider({ token }) {
  return {
    provider: "github",
    label: "GitHub Models",
    model: copilotModel,

    async chat({ system, user, temperature }) {
      const message = await chatCompletion({
        token,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      if (!message.content) {
        throw new Error("Copilot API response has no message content.");
      }
      return message.content;
    },

    async runAgent({ system, history, tools, executeTool, maxSteps }) {
      const messages = [{ role: "system", content: system }, ...history];

      for (let step = 0; step < maxSteps; step += 1) {
        const message = await chatCompletion({ token, messages, tools, temperature: 0 });
        messages.push(message);

        const toolCalls = message.tool_calls || [];
        if (!toolCalls.length) {
          return { text: message.content || "" };
        }

        for (const call of toolCalls) {
          let input;
          try {
            input = JSON.parse(call.function.arguments || "{}");
          } catch {
            messages.push({ role: "tool", tool_call_id: call.id, content: "引数のJSONが不正です。" });
            continue;
          }
          const result = await executeTool(call.function.name, input);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.content) });
        }
      }

      return { text: "ツール呼び出しの上限回数に達したため、処理を中断しました。依頼を分けて再度お試しください。" };
    }
  };
}

module.exports = { createGithubProvider };
