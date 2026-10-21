/* Email/password auth helpers. Pure functions exported for tests. Browser: window.ZabbaEmailAuth. */
(function (root) {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function validate(mode, f) {
    const email = String(f.email || "").trim(), pw = String(f.password || "");
    if (mode === "signup" && !String(f.name || "").trim()) return "Please enter your name.";
    if (!EMAIL_RE.test(email)) return "Please enter a valid email address.";
    if (mode === "reset") return "";
    if (pw.length < 6) return "Password must be at least 6 characters.";
    if (mode === "signup" && pw !== String(f.confirm || "")) return "Passwords don't match.";
    return "";
  }
  const MSG = {
    "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
    "auth/weak-password": "That password is too weak. Use at least 6 characters.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/operation-not-allowed": "Email sign-up isn't enabled yet. Please use Google or X for now.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-login-credentials": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };
  function friendlyError(e) { const c = (e && e.code) || ""; return MSG[c] || "Something went wrong. Please try again."; }
  const api = { validate, friendlyError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaEmailAuth = api;
})(typeof window !== "undefined" ? window : null);
