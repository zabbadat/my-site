// Fallback + non-interference tests for wake-lock.js. Run: node test/wake-lock-fallback.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const { createWakeLock, videoFallback, NOTE, VIDEO_SRC } = require("../wake-lock.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeDoc() { const l = []; return { visibilityState: "visible", addEventListener: (t, f) => t === "visibilitychange" && l.push(f), fire() { l.forEach((f) => f()); } }; }
function fakeNav(reject) {
  const n = { requests: 0, released: 0, sentinels: [] };
  n.wakeLock = { request: async () => {
    n.requests++; if (reject) throw new Error("NotAllowed");
    const s = { released: false, addEventListener() {}, release: async () => { if (!s.released) { s.released = true; n.released++; } } };
    n.sentinels.push(s); return s; } };
  return n;
}
function fakeFb(fail) { const f = { made: 0, plays: 0, stops: 0, playing: false, syncPlay: false }; f.factory = () => { f.made++; return { play() { f.plays++; if (fail) return Promise.reject(new Error("autoplay")); f.playing = true; return Promise.resolve(); }, stop() { f.stops++; f.playing = false; } }; }; return f; }

(async () => {
  // API path: requested on start, released on stop, fallback never touched.
  let nav = fakeNav(), fb = fakeFb(), notes = [];
  let w = createWakeLock({ navigator: nav, document: fakeDoc(), createFallback: fb.factory, onNote: (m) => notes.push(m) });
  check("API: requested on walk start", (await w.start()) === true && nav.requests === 1 && w.isHeld() && !w.usingFallback());
  check("API: fallback not used when API works", fb.made === 0 && fb.plays === 0);
  await w.stop();
  check("API: released on walk stop", nav.released === 1 && !w.isHeld() && notes.length === 0);

  // Unsupported: fallback starts synchronously inside start() (same user gesture).
  fb = fakeFb(); notes = []; let doc = fakeDoc();
  w = createWakeLock({ navigator: {}, document: doc, createFallback: fb.factory, onNote: (m) => notes.push(m) });
  const p = w.start();
  check("unsupported: fallback play() called synchronously in Start tap", fb.plays === 1);
  check("unsupported: start resolves true via fallback", (await p) === true && w.isHeld() && w.usingFallback());
  check("unsupported: no note when fallback works", notes.length === 0);
  await w.stop();
  check("unsupported: fallback stopped on walk stop", fb.stops >= 1 && !fb.playing && !w.isHeld() && !w.usingFallback());
  doc.fire(); await tick();
  check("unsupported: no re-acquire/replay after stop", fb.plays === 1 && !fb.playing);

  // Rejected: fallback used.
  nav = fakeNav(true); fb = fakeFb(); notes = []; doc = fakeDoc();
  w = createWakeLock({ navigator: nav, document: doc, createFallback: fb.factory, onNote: (m) => notes.push(m) });
  check("rejected: falls back to video", (await w.start()) === true && nav.requests === 1 && w.usingFallback() && fb.playing && notes.length === 0);
  doc.fire(); await tick();
  check("rejected: visible again replays video, no extra API request", nav.requests === 1 && fb.plays === 2);
  await w.stop(); doc.fire(); await tick();
  check("rejected: fallback stopped, no re-acquire after stop", !fb.playing && nav.requests === 1 && fb.plays === 2);

  // Both fail: note once.
  fb = fakeFb(true); notes = [];
  w = createWakeLock({ navigator: fakeNav(true), document: fakeDoc(), createFallback: fb.factory, onNote: (m) => notes.push(m) });
  check("both fail: start false", (await w.start()) === false && !w.isHeld());
  await w.stop(); await w.start();
  check("both fail: note shows once", notes.length === 1 && notes[0] === NOTE);
  fb = fakeFb(true); notes = [];
  w = createWakeLock({ navigator: {}, document: fakeDoc(), createFallback: fb.factory, onNote: (m) => notes.push(m) });
  await w.start(); await tick();
  check("unsupported + video blocked: note shows", notes.length === 1);

  // Stop while API request pending that then rejects: fallback must NOT start.
  fb = fakeFb(); let rej; nav = { wakeLock: { request: () => new Promise((_, r) => { rej = r; }) } };
  w = createWakeLock({ navigator: nav, document: fakeDoc(), createFallback: fb.factory });
  const q = w.start(); await w.stop(); rej(new Error("x")); await q;
  check("stop before rejection: no fallback started", fb.plays === 0 && !w.isHeld());

  // Default video fallback element: hidden, muted, inline, looping, and removed on stop.
  const body = { kids: [], appendChild(e) { this.kids.push(e); e.parentNode = this; }, removeChild(e) { this.kids = this.kids.filter((k) => k !== e); e.parentNode = null; } };
  const attrs = {}; let el;
  const vdoc = { body, createElement(t) { el = { tag: t, style: {}, paused: true, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; if (k === "src") el.src = ""; }, play() { el.paused = false; return Promise.resolve(); }, pause() { el.paused = true; }, load() {} }; return el; } };
  const vf = videoFallback(vdoc); await vf.play();
  check("video: muted, loop, playsinline, src", el.tag === "video" && el.muted && el.loop && el.playsInline && "playsinline" in attrs && "muted" in attrs && el.src === VIDEO_SRC && !el.paused);
  check("video: 1px, opacity 0, hidden", /width:1px/.test(el.style.cssText) && /height:1px/.test(el.style.cssText) && /opacity:0/.test(el.style.cssText) && attrs["aria-hidden"] === "true");
  vf.stop();
  check("video: paused and removed on stop", el.paused && body.kids.length === 0 && !el.src);
  const mp4 = path.join(__dirname, "..", VIDEO_SRC.slice(1));
  check("video asset committed and tiny", fs.existsSync(mp4) && fs.statSync(mp4).size < 10000);

  // Non-interference with walk lock + washers lock in index.html.
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "..", "wake-lock.js"), "utf8");
  check("wake-lock.js never touches walkLockOn/setWalkLock/pocketOn/setPocket", !/walkLockOn|setWalkLock|pocketOn|setPocket|releaseAwake|keepAwake/.test(src));
  const fn = (name) => { const i = html.indexOf("function " + name + "("); const j = html.indexOf("\n}", i); return html.slice(i, j + 2); };
  check("washers game uses shared gameWake, never walkWake; setPocket untouched", /gameWake\.start\(\)/.test(html) && !/walkWake|Wake/.test(fn("setPocket")) && !/keepAwake|releaseAwake/.test(html));
  check("beginWalk/endWalk don't touch washers gameWake/pocketOn", !/gameWake|pocketOn|setPocket/.test(fn("beginWalk") + html.slice(html.indexOf("async function endWalk("), html.indexOf("async function endWalk(") + 600)));

  // Runtime: washers' shared instance and walkWake hold separate sentinels on a shared navigator.
  nav = fakeNav();
  let walkLockOn = false; const setWalkLock = (on) => { walkLockOn = !!on; };
  const game = createWakeLock({ navigator: nav, document: fakeDoc(), createFallback: fakeFb().factory });
  w = createWakeLock({ navigator: nav, document: fakeDoc(), createFallback: fakeFb().factory });
  await game.start(); const washersS = nav.sentinels[0];
  await w.start(); setWalkLock(true); const walkS = nav.sentinels[1];
  check("separate sentinels for washers and walk", washersS && walkS && washersS !== walkS);
  await w.stop(); setWalkLock(false);
  check("walk stop leaves washers lock held", walkS.released && !washersS.released && game.isHeld());
  await w.start(); setWalkLock(true);
  await game.stop(); await tick();
  check("washers stop leaves walk lock held and walkLockOn unchanged", washersS.released && w.isHeld() && !nav.sentinels[2].released && walkLockOn === true);
  await w.stop();
  check("walkWake.start/stop never changed walkLockOn itself", walkLockOn === true);

  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  if (pass !== R.length) process.exit(1);
})();
