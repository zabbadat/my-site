/* ZabbaDat membership (Stripe). Website + Capacitor app (the app loads this site).
 * Pure helpers are exported for tests. Browser: window.ZabbaMembers.
 * Gating: any element with data-premium is hidden (data-premium="hide", default)
 * or shown locked (data-premium="lock") unless body.is-member.
 * Status: window.zabbadatMember (bool), body.is-member, event "zabbadat:membership" {detail}.
 */
(function (root) {
  "use strict";
  var ACTIVE = ["active", "trialing"];
  function isActiveStatus(s) { return typeof s === "string" && ACTIVE.indexOf(s) !== -1; }
  function memberFromDoc(d, nowMs) {
    if (!d) return { active: false, status: "none" };
    var status = typeof d.status === "string" ? d.status : "none";
    var end = d.currentPeriodEnd;
    if (end && typeof end.toMillis === "function") end = end.toMillis();
    else if (end && typeof end.seconds === "number") end = end.seconds * 1000;
    var active = isActiveStatus(status) && d.active === true;
    if (active && typeof end === "number" && nowMs && end + 86400000 < nowMs) active = false; // stale doc, 1 day grace
    return { active: active, status: status, currentPeriodEnd: typeof end === "number" ? end : null, hasCustomer: !!d.stripeCustomerId };
  }
  function statusText(m, signedIn, configured) {
    if (configured === false) return "Membership is coming soon.";
    if (!signedIn) return "Sign in to join or manage your membership.";
    if (m.active) return "Member: active" + (m.currentPeriodEnd ? " · renews " + new Date(m.currentPeriodEnd).toLocaleDateString() : "") + ".";
    if (m.status && m.status !== "none") return "Membership status: " + m.status + ".";
    return "Not a member yet.";
  }
  var api = { isActiveStatus: isActiveStatus, memberFromDoc: memberFromDoc, statusText: statusText, ACTIVE: ACTIVE };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  var $ = function (id) { return document.getElementById(id); };
  var state = { user: null, member: { active: false, status: "none" }, configured: null };
  function apply() {
    var m = state.member, on = !!m.active;
    root.zabbadatMember = on;
    document.body.classList.toggle("is-member", on);
    var join = $("memberJoinBtn"), manage = $("memberManageBtn"), st = $("memberStatus");
    if (join) { join.hidden = on || state.configured === false; join.disabled = !state.user; }
    if (manage) manage.hidden = !(state.user && (on || m.hasCustomer)) || state.configured === false;
    if (st) st.textContent = statusText(m, !!state.user, state.configured);
    document.dispatchEvent(new CustomEvent("zabbadat:membership", { detail: { active: on, status: m.status, uid: state.user && state.user.uid } }));
  }
  async function call(path) {
    if (!state.user) throw new Error("Sign in first.");
    var token = await state.user.getIdToken();
    var r = await fetch("/.netlify/functions/" + path, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 503) { state.configured = false; apply(); throw new Error("Membership is not set up yet."); }
    if (!r.ok || !j.url) throw new Error(j.error || ("Request failed (" + r.status + ")"));
    return j.url;
  }
  async function go(path, btn) {
    var st = $("memberStatus");
    if (btn) btn.disabled = true;
    try { root.location.href = await call(path); }
    catch (e) { if (st) st.textContent = e.message; if (btn) btn.disabled = false; }
  }
  async function probe() {
    try { var r = await fetch("/.netlify/functions/create-checkout-session", { method: "GET" }); var j = await r.json(); state.configured = !!j.configured; }
    catch (e) { state.configured = null; }
    apply();
  }
  var unsub = null;
  /* fs = { watch(uid, cb(docData|null)) -> unsubscribe } supplied by the Firebase module in index.html */
  function onUser(user, fs) {
    state.user = user || null;
    if (unsub) { unsub(); unsub = null; }
    state.member = { active: false, status: "none" };
    if (user && fs) unsub = fs.watch(user.uid, function (d) { state.member = memberFromDoc(d, Date.now()); apply(); });
    apply();
  }
  function init() {
    var j = $("memberJoinBtn"), m = $("memberManageBtn");
    if (j) j.onclick = function () { go("create-checkout-session", j); };
    if (m) m.onclick = function () { go("create-portal-session", m); };
    var q = new URLSearchParams(root.location.search).get("member"), st = $("memberStatus");
    if (q && st) setTimeout(function () { st.textContent = q === "success" ? "Thanks! Your membership will show as active in a moment." : "Checkout canceled. No charge was made."; }, 50);
    apply(); probe();
  }
  root.ZabbaMembers = api; api.onUser = onUser; api.state = state;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(typeof window !== "undefined" ? window : this);
