// Spoken "TUT set, TUT set executed." once when a One long set first reaches the TUT target
// (TUT_DONE: 1:20 / 80 s + 10 push-ups). Announcement only: the clock keeps running.
// Run: node test/tut-executed-cue.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const G = require("../get-set.js"), S = require("../push-session.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const gsSrc = fs.readFileSync(path.join(__dirname, "../get-set.js"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };

const LINE = "TUT set, TUT set executed.";
check("TUT_EXECUTED_LINE is the owner line and is exported", G.TUT_EXECUTED_LINE === LINE && typeof G.speakTutExecuted === "function");
check("cue is tied to the existing TUT target constant (TUT_DONE.minMs is 80 s / 1:20, not 2 minutes)", S.TUT_DONE.minMs === 80000 && S.TUT_DONE.minReps === 10);
check("say() leaves TUT as written (no PRONOUNCE entry; matches existing cues, which never rewrite TUT)", G.say(LINE) === LINE && !G.PRONOUNCE.some((p) => p[0].test("TUT") || p[0].test(LINE)));

// ---- page wiring
const rc = html.slice(html.indexOf("function renderPush() {"), html.indexOf("function renderPushMode()"));
check("renderPush fires speakTutExecuted only inside the tutCompleted qualification block (One long set)", /tutCompleted\("long", now, pushState\.reps\)\) \{[\s\S]*?speakTutExecuted\(\);/.test(rc) && (html.match(/speakTutExecuted\(/g) || []).length === 1);
check("qualification still uses tutCompleted (so changing TUT_DONE.minMs moves the cue) and does not finish, end, or stop the set", /window\.ZabbadatSession\.tutCompleted\("long", now, pushState\.reps\)/.test(rc) && /the set now counts as a completed TUT set\. It keeps going/.test(rc) && !/finishPushSet|voidTutSet|finishChallenge|pushState\.finished = true|pushState\.running = false/.test(rc.slice(rc.indexOf("tutCompleted"), rc.indexOf("if ($(\"pushTut\"))"))));
check("TUT Battles 3:00 / 10 s cap path does not call the executed cue (only One long set at TUT_DONE)", !/speakTutExecuted/.test(html.slice(html.indexOf("const tbTimeVoice"), html.indexOf("const tbNow") > 0 ? html.indexOf("const tbNow") : html.length)) && !/speakTutExecuted/.test(fs.readFileSync(path.join(__dirname, "../tut-battle.js"), "utf8")));
check("interruptSpeak call-site count is unchanged (the new cue is queued, not interruptSpeak)", (html.match(/interruptSpeak\(/g) || []).length === 7);
check("the page still never mentions the speech engine directly", html.split("speechSynthesis").length === 1);

// ---- headless speechSynthesis: speak() is called with the line when the clock first crosses TUT_DONE
const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
function env() {
  let nowMs = 0;
  const timers = [], said = [], log = [], els = {};
  const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: false, style: {}, className: "" });
  const ctx = {
    $, console, Math, Promise, JSON, String, Number, Object, Array, Date: Object.assign(function DateShim() { return new Date(nowMs); }, { now: () => nowMs }),
    setTimeout: (f, d) => { timers.push({ at: nowMs + (d || 0), f }); return timers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    speechSynthesis: {
      speaking: false, pending: false,
      cancel: () => log.push("cancel"),
      speak: (u) => { said.push(u.text); if (typeof u.onend === "function") timers.push({ at: nowMs + 800, f: () => { try { u.onend(); } catch (e) {} } }); }
    },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(gsSrc, ctx);
  const advance = async (ms) => {
    const end = nowMs + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at);
      const t = timers.find((x) => !x.done && x.at <= end);
      if (!t) break;
      nowMs = t.at; t.done = true; t.f();
    }
    nowMs = end; await flush();
  };
  return { ctx, $, said, log, els, advance, setNow: (t) => { nowMs = t; }, now: () => nowMs, run: (c) => vm.runInContext(c, ctx) };
}

function mountRender(e, o) {
  o = o || {};
  const startedAt = 1;
  e.setNow(startedAt + (o.ms == null ? 0 : o.ms));
  e.run(`
    var TWO_MIN_MS = 120000;
    var pushMode = ${JSON.stringify(o.mode || "long")};
    var pushTutQualified = false;
    var pushState = { reps: ${o.reps == null ? 10 : o.reps}, tut: 0, elapsed: 0, startedAt: ${startedAt}, running: ${o.running === false ? "false" : "true"}, finished: ${o.finished ? "true" : "false"} };
    var tutTimeVoice = { tick: function () {}, end: function () {}, reset: function () {} };
    var pushChallenge = { };
    function syncPushStartBtn() {}
    function savedPushTotal() { return 0; }
    function savedPushTut() { return 0; }
    function savedPushSets() { return 0; }
    function formatTut(ms) { return Math.floor(ms / 1000) + "s"; }
    function formatTime(ms) { return String(ms); }
    function renderPushMode() {}
    function renderTutHistory() {}
    function finishChallenge() { log = log || []; }
    function localPush() { return []; }
    window.ZabbadatSession = { tutCompleted: ${o.tutCompleted || "null"} };
    if (!window.ZabbadatSession.tutCompleted) {
      window.ZabbadatSession.tutCompleted = function (mode, ms, reps) {
        return mode === "long" && Number(ms) >= ${S.TUT_DONE.minMs} && Number(reps) >= ${S.TUT_DONE.minReps};
      };
    }
    function paintArcadeStrip() {}
  `);
  // renderPush from the page, plus a hook so tests can read state
  const fn = html.slice(html.indexOf("function renderPush() {"), html.indexOf("function renderPushMode()"));
  e.run(fn);
  e.run("function snapshot() { return { running: pushState.running, finished: pushState.finished, reps: pushState.reps, qualified: pushTutQualified, status: ($(\"pushStatus\") && $(\"pushStatus\").textContent) || \"\" }; }");
  const render = async () => { e.run("renderPush()"); await flush(); };
  const snap = () => e.run("snapshot()");
  return { render, snap };
}

(async () => {
  // Isolated helper: idle path speaks the line through speechSynthesis.speak
  { const e = env();
    e.run("window.ZabbadatGetSet.speakTutExecuted()");
    await flush();
    check("speakTutExecuted: speechSynthesis.speak is called with the exact line", e.said.filter((t) => t && t.trim()).join("|") === LINE);
    check("speakTutExecuted: does not cancel other speech when idle", e.log.includes("cancel") === false);
  }

  // Render loop: fire once when the hold first crosses TUT_DONE (80 s) with 10 reps; set keeps running
  { const e = env(); const p = mountRender(e, { ms: 0, reps: 10 });
    e.setNow(1 + 79999); await p.render();
    const before = p.snap();
    check("before the TUT target: no executed cue, set still running, not qualified", e.said.filter((t) => t === LINE).length === 0 && before.running === true && before.finished === false && before.qualified === false);
    e.setNow(1 + S.TUT_DONE.minMs); await p.render();
    const at = p.snap();
    check("at TUT_DONE.minMs (80 s / 1:20) with 10 push-ups: speechSynthesis.speak is called with the line exactly once", e.said.filter((t) => t === LINE).length === 1);
    check("announcement only: after the cue the set is still running and is not finished", at.running === true && at.finished === false && at.qualified === true);
    e.setNow(1 + S.TUT_DONE.minMs + 5000); await p.render();
    e.setNow(1 + S.TUT_DONE.minMs + 15000); await p.render();
    check("the cue fires only once per set even as the clock keeps running past the target", e.said.filter((t) => t === LINE).length === 1 && p.snap().running === true && p.snap().finished === false);
  }

  // Under 10 reps at 80 s: not a completed TUT set, no cue; later, the 10th rep at the same time fires it
  { const e = env(); const p = mountRender(e, { ms: S.TUT_DONE.minMs, reps: 9 });
    await p.render();
    check("80 s with 9 push-ups is not a completed TUT set: no cue, clock still running", e.said.filter((t) => t === LINE).length === 0 && p.snap().running === true && p.snap().qualified === false);
    e.run("pushState.reps = 10"); await p.render();
    check("once 10 push-ups are reached at or after TUT_DONE.minMs, the cue fires once", e.said.filter((t) => t === LINE).length === 1 && p.snap().running === true);
  }

  // Early break / finished set: no cue
  { const e = env(); const p = mountRender(e, { ms: S.TUT_DONE.minMs, reps: 12, finished: true, running: false });
    await p.render();
    check("a set that already ended before the tick does not speak the executed cue", e.said.filter((t) => t === LINE).length === 0);
  }

  // Challenge (2:00) and regular Sets: no cue (tutCompleted is long-only)
  { const e = env(); const p = mountRender(e, { mode: "challenge", ms: S.TUT_DONE.minMs, reps: 20 });
    await p.render();
    check("2:00 challenge does not get the executed cue at 80 s", e.said.filter((t) => t === LINE).length === 0 && p.snap().qualified === false);
  }
  { const e = env(); const p = mountRender(e, { mode: "sets", ms: S.TUT_DONE.minMs, reps: 20 });
    await p.render();
    check("regular Sets mode does not get the executed cue", e.said.filter((t) => t === LINE).length === 0);
  }

  // Changing the target moves the cue: a mock tutCompleted that uses 120 s fires then, not at 80 s
  { const e = env();
    const p = mountRender(e, { ms: 0, reps: 10, tutCompleted: "function (mode, ms, reps) { return mode === 'long' && Number(ms) >= 120000 && Number(reps) >= 10; }" });
    e.setNow(1 + 80000); await p.render();
    check("if the TUT target constant were moved to 120 s, the cue does not fire at 80 s", e.said.filter((t) => t === LINE).length === 0);
    e.setNow(1 + 120000); await p.render();
    check("...it fires once when the hold first crosses the new target, and the set keeps running", e.said.filter((t) => t === LINE).length === 1 && p.snap().running === true && p.snap().finished === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
