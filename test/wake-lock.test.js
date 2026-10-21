// Tests for wake-lock.js. Run: node test/wake-lock.test.js
const { createWakeLock, NOTE } = require("../wake-lock.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function fakeDoc() { const l = []; return { visibilityState: "visible", addEventListener: (t, f) => t === "visibilitychange" && l.push(f), fire() { l.forEach((f) => f()); } }; }
function fakeNav(reject) {
  const n = { requests: 0, released: 0, last: null };
  n.wakeLock = { request: async (type) => {
    n.requests++; if (reject || type !== "screen") throw new Error("NotAllowed");
    const ls = []; const s = { released: false, addEventListener: (t, f) => t === "release" && ls.push(f),
      release: async () => { if (!s.released) { s.released = true; n.released++; ls.forEach((f) => f()); } } };
    n.last = s; return s; } };
  return n;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  let nav = fakeNav(), doc = fakeDoc(), notes = [];
  let w = createWakeLock({ navigator: nav, document: doc, onNote: (m) => notes.push(m) });
  check("acquire on start", (await w.start()) === true && w.isHeld() && nav.requests === 1);
  await w.stop();
  check("release on stop", nav.released === 1 && !w.isHeld() && !w.isActive());

  nav = fakeNav(); doc = fakeDoc();
  w = createWakeLock({ navigator: nav, document: doc });
  await w.start(); await nav.last.release(); // system drops lock (screen hidden)
  check("sentinel release clears held", !w.isHeld());
  doc.visibilityState = "hidden"; doc.fire(); await tick();
  check("no request while hidden", nav.requests === 1);
  doc.visibilityState = "visible"; doc.fire(); await tick();
  check("re-acquire on visible while active", nav.requests === 2 && w.isHeld());
  doc.fire(); await tick();
  check("no duplicate when already held", nav.requests === 2);
  await w.stop(); doc.fire(); await tick();
  check("no re-acquire after stop", nav.requests === 2 && !w.isHeld());

  notes = []; doc = fakeDoc();
  w = createWakeLock({ navigator: {}, document: doc, onNote: (m) => notes.push(m) });
  let ok = true; try { check("unsupported start returns false", (await w.start()) === false); await w.stop(); await w.start(); } catch (e) { ok = false; }
  check("unsupported graceful, note once", ok && notes.length === 1 && notes[0] === NOTE);

  notes = []; nav = fakeNav(true); doc = fakeDoc();
  w = createWakeLock({ navigator: nav, document: doc, onNote: (m) => notes.push(m) });
  ok = true; try { check("rejected start returns false", (await w.start()) === false); doc.fire(); await tick(); } catch (e) { ok = false; }
  check("rejected graceful, note once", ok && notes.length === 1 && !w.isHeld());

  nav = fakeNav(); doc = fakeDoc();
  w = createWakeLock({ navigator: nav, document: doc });
  const p = w.start(); await w.stop(); await p;
  check("stop during pending request releases it", !w.isHeld() && nav.released === 1);

  // Mirrors index.html: Start -> beginWalk() -> walkWake.start(); setWalkLock(true); only endWalk() calls stop().
  nav = fakeNav(); doc = fakeDoc();
  w = createWakeLock({ navigator: nav, document: doc });
  let walkLockOn = false;
  await w.start(); walkLockOn = true;
  check("held while walkLockOn is true", walkLockOn && w.isHeld() && nav.released === 0);
  doc.fire(); await tick();
  check("still held, no extra request while walk-locked", walkLockOn && w.isHeld() && nav.requests === 1);
  walkLockOn = false; await w.stop();
  check("released only when walk ends", !w.isHeld() && nav.released === 1);

  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  if (pass !== R.length) process.exit(1);
})();
