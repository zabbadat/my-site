/* ZAB: the display name of the in-game currency (internal ids stay zabaTokens / tokenTx / ZabaTokens).
 * User-facing amounts read "5 ZAB" followed by a washer-ring icon: a small inline SVG circle with a hole, drawn in
 * currentColor, aria-hidden (the visible word "ZAB" is the accessible label). Plain-text places (confirm dialogs, spoken
 * text, aria-labels) use the word only; speech says "Zab". Browser: window.ZabCurrency. Node: require("./zab-currency.js").
 */
(function (root) {
  const NAME = "ZAB", SPOKEN = "Zab";
  const RING = '<svg class="zab-ring" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ZAB_WORD = /\bZAB\b/g;
  /* any text -> safe HTML where every "ZAB" word gets the ring right after it */
  const html = (s) => esc(s).replace(ZAB_WORD, '<span class="zab">ZAB' + RING + "</span>");
  const num = (n) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("en-US") : esc(n));
  /* 5 -> "5 ZAB (ring)" as HTML / plain text */
  const amountHtml = (n) => '<span class="zab">' + num(n) + " ZAB" + RING + "</span>";
  const amountText = (n) => num(n) + " " + NAME;
  /* speech: the word ZAB is said "Zab" (never spelled out) */
  const spoken = (s) => String(s == null ? "" : s).replace(ZAB_WORD, SPOKEN);
  function set(el, text) { if (el) el.innerHTML = html(text); return el; }
  /* element already holds plain text with "ZAB" in it: add the ring icons (idempotent) */
  function ring(el) { if (el && /\bZAB\b/.test(el.textContent || "") && !el.querySelector(".zab-ring")) el.innerHTML = html(el.textContent); return el; }
  const api = { NAME, SPOKEN, RING, esc, html, num, amountHtml, amountText, spoken, set, ring };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabCurrency = api;
})(typeof window !== "undefined" ? window : null);
