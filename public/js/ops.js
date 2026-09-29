// デザイン v3（DevOps）のキーボード操作
//   ⌘K / Ctrl+K … コマンドパレット
//   g → キー     … 画面移動（サイドバーに表示しているキー）
//   /            … ページ内の最初の入力欄へ
//   ?            … コマンドパレット（ショートカット一覧）
(function () {
  const palette = document.getElementById("palette");
  const input = document.getElementById("palette-input");
  const list = document.getElementById("palette-list");
  if (!palette || !input || !list) return;

  const items = [...list.querySelectorAll("li[role=option]")];
  const routes = {};
  items.forEach((li) => {
    const key = li.querySelector("kbd")?.textContent.replace("g", "").trim();
    if (li.dataset.href && key) routes[key] = li.dataset.href;
  });

  let activeIndex = 0;

  function visibleItems() {
    return items.filter((li) => !li.hidden);
  }

  function highlight(index) {
    const visible = visibleItems();
    if (!visible.length) return;
    activeIndex = (index + visible.length) % visible.length;
    visible.forEach((li, i) => li.setAttribute("aria-selected", String(i === activeIndex)));
    visible[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function filter() {
    const q = input.value.trim().toLowerCase();
    items.forEach((li) => {
      li.hidden = !!q && !`${li.textContent} ${li.dataset.keywords || ""}`.toLowerCase().includes(q);
    });
    highlight(0);
  }

  function openPalette() {
    if (palette.open) return;
    input.value = "";
    filter();
    palette.showModal();
    input.focus();
  }

  function run(li) {
    if (!li) return;
    if (li.dataset.href) {
      window.location.href = li.dataset.href;
    } else if (li.dataset.design) {
      const form = document.querySelector(".design-switch");
      form.querySelector("select").value = li.dataset.design;
      form.submit();
    } else if (li.dataset.action === "logout") {
      document.querySelector(".sb-foot form")?.submit();
    }
  }

  input.addEventListener("input", filter);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); highlight(activeIndex + 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); highlight(activeIndex - 1); }
    if (event.key === "Enter") { event.preventDefault(); run(visibleItems()[activeIndex]); }
  });
  items.forEach((li) => {
    li.addEventListener("click", () => run(li));
    li.addEventListener("mousemove", () => highlight(visibleItems().indexOf(li)));
  });
  // 背景（ダイアログの外側）クリックで閉じる
  palette.addEventListener("click", (event) => {
    if (event.target === palette) palette.close();
  });
  document.getElementById("palette-open")?.addEventListener("click", openPalette);

  function isTyping(target) {
    return target instanceof HTMLElement
      && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  }

  let pendingG = null;
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.open) palette.close(); else openPalette();
      return;
    }
    if (palette.open || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

    if (pendingG) {
      clearTimeout(pendingG);
      pendingG = null;
      const href = routes[event.key.toLowerCase()];
      if (href) { event.preventDefault(); window.location.href = href; }
      return;
    }
    if (event.key === "g") {
      pendingG = setTimeout(() => { pendingG = null; }, 1200);
      return;
    }
    if (event.key === "/") {
      const field = document.querySelector("main textarea:not([disabled]), main input[type=text]:not([disabled]), main input:not([type]):not([disabled])");
      if (field) { event.preventDefault(); field.focus(); }
      return;
    }
    if (event.key === "?") {
      event.preventDefault();
      openPalette();
    }
  });
})();
