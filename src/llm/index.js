const { getUserLlmSettings } = require("../userSettings");
const { createGithubProvider } = require("./github");
const { createAnthropicProvider } = require("./anthropic");
const { createGeminiProvider } = require("./gemini");

/**
 * ユーザー設定に応じたLLMプロバイダーを返す。
 * どのプロバイダーも同じインターフェースを持つ:
 *   chat({ system, user, temperature }) -> string
 *   runAgent({ system, history, tools, executeTool, maxSteps }) -> { text }
 * 未設定の場合は { error } を返す。
 */
function getLlmForUser(userId) {
  const settings = getUserLlmSettings(userId);

  if (settings.provider === "gemini") {
    if (!settings.geminiApiKey) {
      return { error: "Gemini APIキーが未設定です。「トークン・AI設定」で保存してください。" };
    }
    return { llm: createGeminiProvider({ apiKey: settings.geminiApiKey }) };
  }

  if (settings.provider === "anthropic") {
    if (!settings.anthropicApiKey) {
      return { error: "Claude APIキーが未設定です。「APIトークン・AI設定」で保存してください。" };
    }
    return { llm: createAnthropicProvider({ apiKey: settings.anthropicApiKey }) };
  }

  if (!settings.copilotApiToken) {
    return { error: "GitHub Copilot APIトークンが未設定です。「APIトークン・AI設定」で保存してください。" };
  }
  return { llm: createGithubProvider({ token: settings.copilotApiToken }) };
}

module.exports = { getLlmForUser };
