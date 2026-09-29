// 新デザイン（Bridge）のサイドバー開閉
// PC: アイコンだけのレールに折りたたみ（状態を保存） / スマホ: ドロワーとして開閉
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById("sidebar-toggle");
  if (!toggle) return;

  const mobile = window.matchMedia("(max-width: 900px)");

  function syncExpanded() {
    const expanded = mobile.matches
      ? root.classList.contains("sidebar-open")
      : !root.classList.contains("sidebar-collapsed");
    toggle.setAttribute("aria-expanded", String(expanded));
  }

  function closeDrawer() {
    root.classList.remove("sidebar-open");
    syncExpanded();
  }

  toggle.addEventListener("click", () => {
    if (mobile.matches) {
      root.classList.toggle("sidebar-open");
    } else {
      const collapsed = root.classList.toggle("sidebar-collapsed");
      try {
        localStorage.setItem("sidebar", collapsed ? "collapsed" : "expanded");
      } catch {
        // 保存できない環境でも開閉は動く
      }
    }
    syncExpanded();
  });

  document.querySelectorAll("[data-sidebar-close]").forEach((el) => el.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.classList.contains("sidebar-open")) closeDrawer();
  });
  mobile.addEventListener("change", () => {
    root.classList.remove("sidebar-open");
    syncExpanded();
  });

  syncExpanded();
})();
