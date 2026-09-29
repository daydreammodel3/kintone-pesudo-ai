(function () {
  const root = document.getElementById("operator");
  if (!root) return;

  const appId = root.dataset.appId;
  const storageKey = `operator:${appId}`;
  const log = document.getElementById("chat-log");
  const empty = document.getElementById("chat-empty");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendButton = document.getElementById("chat-send");
  const resetButton = document.getElementById("chat-reset");

  const ACCESS_LABELS = { read: "読み取り", create: "登録", update: "更新" };
  const STATUS_LABELS = {
    ok: "成功",
    error: "エラー",
    denied_policy: "ポリシーで拒否",
    denied_kintone: "kintone権限で拒否"
  };

  let state = loadState();

  function loadState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.turns)) return saved;
    } catch {
      // 保存領域が使えない環境でも動くようにする
    }
    return { conversationId: newConversationId(), turns: [] };
  }

  function saveState() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  function newConversationId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  // AIの回答によく出る範囲（段落・箇条書き・表・見出し）だけを扱う簡易Markdown
  function renderMarkdown(text) {
    const lines = String(text || "").split("\n");
    const html = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i]);
          i += 1;
        }
        const cells = rows
          .filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
          .map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())));
        if (cells.length) {
          const [head, ...body] = cells;
          html.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        }
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
          i += 1;
        }
        html.push(`<ul>${items.join("")}</ul>`);
        continue;
      }
      if (/^#{1,4}\s+/.test(line)) {
        html.push(`<p><strong>${inline(line.replace(/^#{1,4}\s+/, ""))}</strong></p>`);
      } else if (line.trim()) {
        html.push(`<p>${inline(line)}</p>`);
      }
      i += 1;
    }
    return html.join("");
  }

  function renderSteps(steps) {
    if (!steps || !steps.length) return "";
    const items = steps.map((s, idx) => `
      <li class="trace-step">
        <details>
          <summary>
            <span class="trace-no">${idx + 1}</span>
            <code>${escapeHtml(s.tool)}</code>
            <span class="chip chip-access">${ACCESS_LABELS[s.access] || escapeHtml(s.access)}</span>
            <span class="badge badge-${escapeHtml(s.status)}">${STATUS_LABELS[s.status] || escapeHtml(s.status)}</span>
            <span class="trace-summary">${escapeHtml(s.summary || "")}</span>
            <span class="trace-ms">${s.durationMs}ms</span>
          </summary>
          <pre class="result code">${escapeHtml(JSON.stringify(s.input, null, 2))}</pre>
        </details>
      </li>`).join("");
    return `<div class="trace"><p class="trace-title">AI → ツール層 → kintone の実行トレース</p><ol>${items}</ol></div>`;
  }

  function appendBubble(turn) {
    if (empty) empty.hidden = true;
    const el = document.createElement("div");
    el.className = `bubble bubble-${turn.role}`;
    if (turn.role === "user") {
      el.innerHTML = `<p>${escapeHtml(turn.content)}</p>`;
    } else if (turn.role === "error") {
      el.innerHTML = `<p>${escapeHtml(turn.content)}</p>`;
    } else {
      el.innerHTML = `${renderSteps(turn.steps)}<div class="bubble-body">${renderMarkdown(turn.content)}</div>${turn.meta ? `<p class="bubble-meta">${escapeHtml(turn.meta)}</p>` : ""}`;
    }
    log.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
    return el;
  }

  function renderAll() {
    log.querySelectorAll(".bubble").forEach((el) => el.remove());
    if (empty) empty.hidden = state.turns.length > 0;
    state.turns.forEach(appendBubble);
  }

  async function send(message) {
    const history = state.turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => ({ role: t.role, content: t.content }));

    const userTurn = { role: "user", content: message };
    state.turns.push(userTurn);
    appendBubble(userTurn);
    saveState();

    const pending = document.createElement("div");
    pending.className = "bubble bubble-assistant bubble-pending";
    pending.innerHTML = "<p>AIがツールを使ってkintoneを操作しています…</p>";
    log.appendChild(pending);
    pending.scrollIntoView({ behavior: "smooth", block: "end" });

    sendButton.disabled = true;
    input.disabled = true;
    const startedAt = Date.now();

    try {
      const response = await fetch("/operator/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managedAppId: appId, conversationId: state.conversationId, history, message })
      });
      const body = await response.json().catch(() => ({}));
      pending.remove();

      if (!response.ok) {
        const errorTurn = { role: "error", content: body.error || `エラーが発生しました（${response.status}）` };
        appendBubble(errorTurn);
        return;
      }

      state.conversationId = body.conversationId || state.conversationId;
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const assistantTurn = {
        role: "assistant",
        content: body.reply,
        steps: body.steps,
        meta: `${body.provider} / ${body.model} ・ ツール呼び出し ${body.steps.length}回 ・ ${seconds}秒`
      };
      state.turns.push(assistantTurn);
      appendBubble(assistantTurn);
      saveState();
    } catch (error) {
      pending.remove();
      appendBubble({ role: "error", content: `通信に失敗しました: ${error.message}` });
    } finally {
      sendButton.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    send(message);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.textContent.trim();
      input.focus();
    });
  });

  resetButton.addEventListener("click", () => {
    state = { conversationId: newConversationId(), turns: [] };
    saveState();
    renderAll();
  });

  renderAll();
})();
