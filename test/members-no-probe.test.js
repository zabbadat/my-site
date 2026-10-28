// Home page must not call the parked create-checkout-session function on load (it 404s). Run: node test/members-no-probe.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "members.js"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function run(flag) {
  const calls = []; const el = () => ({ hidden: false, disabled: false, textContent: "", classList: { toggle() {} } });
  const els = {};
  const document = { body: el(), getElementById: (id) => (els[id] = els[id] || el()), dispatchEvent() {}, addEventListener() {}, readyState: "complete" };
  const win = { document, location: { search: "" }, fetch: (u) => { calls.push(u); return Promise.resolve({ ok: false, status: 404, json: async () => ({}) }); }, setTimeout, console };
  if (flag) win.ZABBA_MEMBERSHIP_LIVE = true;
  win.window = win; win.URLSearchParams = URLSearchParams; win.CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };
  vm.runInNewContext(src, Object.assign(win, { document, fetch: win.fetch, CustomEvent: win.CustomEvent }), {});
  return new Promise((r) => setTimeout(() => r({ calls, els }), 30));
}
(async () => {
  const off = await run(false);
  check("flag off: no request to create-checkout-session on load", off.calls.length === 0);
  check("flag off: status stays 'Membership is coming soon.'", /coming soon/.test(off.els.memberStatus ? off.els.memberStatus.textContent : ""));
  const on = await run(true);
  check("flag on: the probe runs", on.calls.some((u) => /create-checkout-session/.test(u)));
  check("source guards the probe behind ZABBA_MEMBERSHIP_LIVE", /ZABBA_MEMBERSHIP_LIVE !== true/.test(src));
  const ok = R.every(Boolean); console.log(ok ? "ALL PASS" : "SOME FAILED"); process.exit(ok ? 0 : 1);
})();
