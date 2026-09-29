// Google Gemini API（公式SDK @google/genai）プロバイダー
const { GoogleGenAI, ApiError } = require("@google/genai");
const { geminiModel, geminiTimeoutMs, geminiRetryAttempts, geminiFallbackModel } = require("../config");

// 混雑・一時障害を表すステータス。再試行しても続く場合は別モデルへの切り替え対象にする
const OVERLOAD_STATUSES = new Set([500, 502, 503, 504]);

class GeminiOverloadedError extends Error {}

function toFriendlyError(error) {
  if (error instanceof ApiError) {
    if (error.status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.message)) {
      return new Error("Gemini APIキーが無効です。「トークン・AI設定」を確認してください。");
    }
    if (error.status === 401 || error.status === 403) {
      return new Error("Gemini APIキーに権限がありません。「トークン・AI設定」を確認してください。");
    }
    if (OVERLOAD_STATUSES.has(error.status)) {
      return new GeminiOverloadedError(`Geminiが混雑しています（${error.status}）。自動で再試行しましたが回復しませんでした。数分待ってから再実行してください。`);
    }
    if (error.status === 429) {
      return new Error("Gemini APIのレート制限（または無料枠の上限）に達しました。少し待ってから再実行してください。");
    }
    return new Error(`Gemini API failed: ${error.status} ${error.message}`);
  }
  return error;
}

// 安全性フィルタなどで候補が返らなかった場合に理由を伝える
function assertCandidate(response) {
  const candidate = response.candidates?.[0];
  if (candidate?.content) return candidate;
  const reason = response.promptFeedback?.blockReason || candidate?.finishReason || "不明";
  throw new Error(`Geminiが応答を返しませんでした（理由: ${reason}）。依頼内容を見直してください。`);
}

function createGeminiProvider({ apiKey }) {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: geminiTimeoutMs,
      // SDKのリトライは retryOptions を渡したときだけ有効になる。
      // 既定の対象ステータス（408/429/500/502/503/504）を、2秒→4秒→8秒…と間隔を広げて再試行する
      retryOptions: { attempts: geminiRetryAttempts, initialDelay: 2, maxDelay: 16 }
    }
  });
  const fallbackModel = geminiFallbackModel && geminiFallbackModel !== geminiModel ? geminiFallbackModel : "";

  async function generate({ model, system, contents, tools }) {
    const config = { systemInstruction: system };
    if (tools && tools.length) {
      config.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.inputSchema
        }))
      }];
    }
    try {
      return await ai.models.generateContent({ model, contents, config });
    } catch (error) {
      throw toFriendlyError(error);
    }
  }

  return {
    provider: "gemini",
    label: "Gemini API",
    model: geminiModel,

    fallbackModel,

    async chat({ system, user }) {
      let response;
      try {
        response = await generate({ model: geminiModel, system, contents: user });
      } catch (error) {
        if (!(error instanceof GeminiOverloadedError) || !fallbackModel) throw error;
        response = await generate({ model: fallbackModel, system, contents: user });
      }
      assertCandidate(response);
      const text = (response.text || "").trim();
      if (!text) {
        throw new Error("Gemini API response has no text content.");
      }
      return text;
    },

    async runAgent({ system, history, tools, executeTool, maxSteps }) {
      const contents = history.map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }]
      }));

      let model = geminiModel;

      for (let step = 0; step < maxSteps; step += 1) {
        let response;
        try {
          response = await generate({ model, system, contents, tools });
        } catch (error) {
          // モデルの応答（thought signature）を履歴に積む前の、最初の呼び出しでだけ切り替える
          if (!(error instanceof GeminiOverloadedError) || !fallbackModel || step > 0) throw error;
          model = fallbackModel;
          response = await generate({ model, system, contents, tools });
        }
        const candidate = assertCandidate(response);
        // thought signature を保つため、モデルの応答はそのまま履歴に戻す
        contents.push(candidate.content);

        const calls = response.functionCalls || [];
        if (!calls.length) {
          return { text: (response.text || "").trim(), model };
        }

        const parts = [];
        for (const call of calls) {
          const result = await executeTool(call.name, call.args || {});
          parts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: result.isError ? { error: result.content } : { output: result.content }
            }
          });
        }
        contents.push({ role: "user", parts });
      }

      return { text: "ツール呼び出しの上限回数に達したため、処理を中断しました。依頼を分けて再度お試しください。", model };
    }
  };
}

module.exports = { createGeminiProvider };
