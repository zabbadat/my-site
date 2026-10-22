// Shared sign-in gate on every Start button. Run: node test/signin-gate.test.js
const fs = require("fs"), path = require("path");
const G = require("../signin-gate.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function fakeDoc() {
  const keys = [];
  const mk = (tag) => { const e = { tag, children: [], attrs: {}, parentNode: null, setAttribute(k, v) { e.attrs[k] = v; },
    appendChild(c) { c.parentNode = e; e.children.push(c); }, removeChild(c) { e.children = e.children.filter((x) => x !== c); c.parentNode = null; }, focus() { doc.activeElement = e; } }; return e; };
  const doc = { body: mk("body"), activeElement: null, createElement: mk,
    addEventListener: (t, f) => t === "keydown" && keys.push(f), removeEventListener: (t, f) => { const i = keys.indexOf(f); if (i >= 0) keys.splice(i, 1); },
    key: (k) => keys.slice().forEach((f) => f({ key: k })) };
  doc.find = (id) => { const walk = (e) => { if (e.id === id) return e; for (const c of e.children) { const r = walk(c); if (r) return r; } return null; }; return walk(doc.body); };
  return doc;
}
const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
function mkGate(signed) { const doc = fakeDoc(), st = store(), signIns = []; let user = signed;
  const g = G.createSignInGate({ document: doc, storage: st, isSignedIn: () => user, onSignIn: (f) => signIns.push(f) });
  return { g, doc, st, signIns, setUser: (v) => { user = v; } }; }

// Inventory: feature -> [source snippet that must gate it, practice?]
const INV = [
  ["Start live walk (dailyWalkBtn)", 'requireSignIn("walk", () => $("dailyWalkBtn").onclick(), { practice: true })', true, 2],
  ["washers Start game (startBtn)", 'requireSignIn("washers", () => $("startBtn").onclick(), { practice: true })', true, 1],
  ["push-up Start set / One Long Set (pushStartBtn)", 'requireSignIn("pushups", () => $("pushStartBtn").onclick(), { practice: true })', true, 1],
  ["push-up camera Phone on floor (startCam)", 'requireSignIn("pushcam", () => startCam(), { practice: true })', true, 1],
  ["plank camera (startPlankCam)", 'requireSignIn("plank", () => startPlankCam(), { practice: true })', true, 1],
  ["plank battle create/join/ready", 'requireSignIn("plank battle")', false, 3],
  ["TUT battle create/join/ready/camera", 'requireSignIn("tut battle")', false, 4],
];
for (const [name, snip, practice, n] of INV) {
  const c = html.split(snip).length - 1;
  check(`static: ${name} routed through requireSignIn (${c}/${n})`, c === n);
  for (const signed of [false, true]) {
    const t = mkGate(signed); let calls = 0; const start = () => { calls++; };
    const go = () => { if (t.g.requireSignIn(snip.match(/"([^"]+)"/)[1], practice ? start : undefined, practice ? { practice: true } : undefined)) start(); };
    go();
    if (signed) { check(`${name}: signed in -> no prompt, start called`, !t.g.isOpen() && calls === 1); continue; }
    const dlg = t.doc.find("signGate");
    check(`${name}: signed out -> prompt shown, start not called`, t.g.isOpen() && calls === 0 && !!dlg && t.doc.find("signGateTitle").textContent === "Please sign in");
    check(`${name}: dialog accessible (role=dialog, aria-modal, labelled)`, dlg.children[0].attrs.role === "dialog" && dlg.children[0].attrs["aria-modal"] === "true" && dlg.children[0].attrs["aria-labelledby"] === "signGateTitle");
    const pr = t.doc.find("signGatePractice");
    if (practice) { pr.onclick(); check(`${name}: Practice -> start called synchronously, dialog closed`, calls === 1 && !t.g.isOpen());
      go(); check(`${name}: Practice remembered in sessionStorage, no re-prompt`, calls === 2 && !t.g.isOpen() && t.st.m[G.KEY + snip.match(/"([^"]+)"/)[1]] === "1"); }
    else check(`${name}: battle -> no Practice option`, !pr && !!t.doc.find("signGateCancel"));
    // Sign in route
    const t2 = mkGate(false); t2.g.requireSignIn("x", start, { practice }); t2.doc.find("signGateSignIn").onclick();
    check(`${name}: Sign in button routes to sign-in, start not called`, t2.signIns[0] === "x" && !t2.g.isOpen() && calls === (practice ? 2 : 0));
  }
}
{ const t = mkGate(false); let c = 0; t.g.requireSignIn("walk", () => c++, { practice: true });
  t.doc.key("Escape"); check("Esc closes dialog, no start", !t.g.isOpen() && c === 0);
  t.g.requireSignIn("walk", () => c++, { practice: true }); const b = t.doc.find("signGate"); b.onclick({ target: b.children[0] });
  check("click inside box does not close", t.g.isOpen()); b.onclick({ target: b }); check("backdrop closes", !t.g.isOpen() && c === 0);
  t.g.requireSignIn("walk", () => c++, { practice: true }); t.doc.find("signGateCancel").onclick(); check("Cancel closes, no start", !t.g.isOpen() && c === 0); }
{ const t = mkGate(false); t.g.requireSignIn("walk", () => {}, { practice: true }); t.doc.find("signGatePractice").onclick();
  check("practice memory is per feature (washers still prompts)", t.g.requireSignIn("washers", () => {}, { practice: true }) === false); }
{ const t = mkGate(false); t.g.requireSignIn("walk", () => {}, { practice: true }); t.setUser(true);
  check("signing in later: start proceeds", t.g.requireSignIn("walk", () => {}, { practice: true }) === true); }
// Holds while running must not hit the gate: gate sits after the running/walking early returns.
{ const s = html.slice(html.indexOf('$("startBtn").onclick = () => {'), html.indexOf("const holdGuard"));
  check("washers: gate is after gameHoldDone swallow + running/finished returns (holds don't trigger it)", s.indexOf("gameHoldDone") < s.indexOf("requireSignIn") && s.indexOf("state.running && !state.finished") < s.indexOf("requireSignIn") && s.indexOf("if (state.finished || state.running) return;") < s.indexOf("requireSignIn"));
  const bh = html.slice(html.indexOf('bindHold($("startBtn")'), html.indexOf('$("pauseBtn").onclick'));
  check("washers hold handler has no gate", !/requireSignIn/.test(bh)); }
{ const i = html.lastIndexOf('$("dailyWalkBtn").onclick = async () => {'); const s = html.slice(i, html.indexOf("bindHold(", i));
  check("walk: gate after walkHoldDone swallow + walking return (Hold to stop not gated)", s.indexOf("walkHoldDone") < s.indexOf("requireSignIn") && s.indexOf("Hold to stop the walk") < s.indexOf("requireSignIn"));
  const bh = html.slice(html.indexOf('bindHold($("dailyWalkBtn")'), html.indexOf("\n", html.indexOf('bindHold($("dailyWalkBtn")')));
  check("walk hold handler has no gate", !/requireSignIn/.test(bh)); }
// Behavioral washers handler: signed out -> not started; signed in -> started; running tap (lock hint) never gates.
{ const clk = html.slice(html.indexOf('$("startBtn").onclick = () => {'), html.indexOf("const holdGuard"));
  const mk = (ok) => { const log = []; const f = new Function("log", "ok", `let gated=0; const requireSignIn=()=>{gated++;return ok;}; let gameHoldDone=false,pocketOn=false; const state={running:false,finished:false,elapsed:0};
    const stepDetector={reset(){}},stepVerifier={reset(){},resume(){}}; const performance={now:()=>1}; const setInterval=()=>0; const render=()=>{}; const setStatus=(m)=>log.push(m);
    const startPhoneSteps=()=>log.push('steps'); const gameWake={start(){log.push('wake');return Promise.resolve();}}; const setPocket=(v)=>{pocketOn=v;log.push('pocket:'+v);};
    const $=()=>btn; const btn={}; ${clk.replace('$("startBtn").onclick', "btn.onclick")}; return {btn,state,g:()=>gated};`); return { ...f(log, ok), log }; };
  const a = mk(false); a.btn.onclick(); check("washers handler signed out: not started, no wake/steps", !a.state.running && !a.log.includes("wake") && !a.log.includes("steps"));
  const b = mk(true); b.btn.onclick(); check("washers handler signed in: started, wake + steps + pocket lock", b.state.running && b.log.includes("wake") && b.log.includes("steps") && b.log.includes("pocket:true"));
  const n = b.g(); b.btn.onclick(); check("washers handler: tap while running (locked) does not call gate", b.g() === n); }
check("signin-gate.js loaded before module script", html.indexOf('<script src="/signin-gate.js"></script>') > 0 && html.indexOf('<script src="/signin-gate.js"></script>') < html.indexOf('<script type="module">'));
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
