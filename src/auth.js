// ゲスト: プレゼン用の閲覧専用アカウント。ログイン画面からパスワードなしで入れる。
// 既定ではどの画面も使えず、requireViewer を付けた画面だけを全ユーザー分のデータで閲覧できる。
const GUEST_LABEL = "ゲスト（閲覧のみ）";
const GUEST_PATHS = ["/dashboard", "/records/analyze"];
const GUEST_DENIED_MESSAGE = "ゲストアカウントは閲覧専用のため、この画面・操作は使えません。";

function isGuest(req) {
  return req.session.role === "guest";
}

function denyGuest(req, res) {
  if (req.method === "GET" && req.accepts(["html", "json"]) === "html") {
    req.session.flashError = GUEST_DENIED_MESSAGE;
    return res.redirect("/dashboard");
  }
  return res.status(403).json({ error: GUEST_DENIED_MESSAGE });
}

// メンバー（登録ユーザー）専用
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  if (isGuest(req)) return denyGuest(req, res);
  return res.redirect("/login");
}

// メンバーとゲストが閲覧できる
function requireViewer(req, res, next) {
  if (req.session.userId || isGuest(req)) return next();
  return res.redirect("/login");
}

module.exports = { GUEST_LABEL, GUEST_PATHS, isGuest, requireAuth, requireViewer };
