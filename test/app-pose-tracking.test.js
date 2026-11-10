// App-only push-up pose tracking (createCounter({ app: true }), push-coach.js, poseTick wiring). Front-facing phone,
// shoulders AND arms: shoulder travel + elbow angle when both elbows are clearly visible, each rep credited on the way
// up; no 6 s speed refusal; a reason on every refused rep; the plank push press (top hold) never fails a set.
// Browsers: the counter without opts.app is frame-for-frame identical to 760c669. Run: node test/app-pose-tracking.test.js
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), CH = require("../push-challenge.js"), COACH = require("../push-coach.js");
const flow = require("./lib/push-flow-harness.js"), HTML = path.join(__dirname, "..", "index.html");
let pass = 0, fail = 0; const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };

// Synthetic frames with elbows. bend(t, frac) = outward elbow offset in shoulder widths (0 = arm straight).
function withElbows(c, bend) {
  return (frac, t) => {
    const kps = S.frameFor(frac, c, t), g = (n) => kps.find((k) => k.name === n);
    const sw = c.sw * c.W * (1 + c.sizeGrow * frac), b = bend(t, frac) * sw;
    for (const side of ["left", "right"]) {
      const sh = g(side + "_shoulder"), wr = g(side + "_wrist"); if (!sh || !wr) continue;
      kps.push({ name: side + "_elbow", x: (sh.x + wr.x) / 2 + (side === "left" ? -b : b), y: (sh.y + wr.y) / 2, score: 0.9 });
    }
    return kps;
  };
}
const normalBend = (t, f) => 0.02 + 0.6 * f;
function runC(segs, opts, mk) {
  const c = Object.assign({}, S.BASE), ctr = PC.createCounter(opts), frame = mk ? mk(c) : withElbows(c, normalBend), out = { counts: [], refused: [], statuses: [] };
  for (let t = 0; t <= S.total(segs); t += 1000 / c.fps) {
    const r = ctr.update(frame(S.fracAt(segs, t), t), t, c.W);
    if (r.counted) out.counts.push(t); if (r.refused) out.refused.push(r.refused);
    if (out.statuses[out.statuses.length - 1] !== r.status) out.statuses.push(r.status);
  }
  out.reps = ctr.state().reps; out.st = ctr.state(); return out;
}

// 1. counting on the way up, elbows visible
{ const segs = [[2000, 0, 0], ...S.reps(8, 2000)], x = runC(segs, { app: true }), up = S.trueReturns(segs, 0.3);
  check("app: 8 reps with both elbows visible -> 8 counted", x.reps === 8, x.reps);
  check("app: elbow-angle signal learned from the first rep", x.st.topA != null && x.st.bottomA != null && x.st.topA - x.st.bottomA > 0.05, [x.st.topA, x.st.bottomA].map((v) => v && v.toFixed(2)).join("/"));
  const lag = x.counts.map((t, i) => t - up[i]);
  check("app: each rep credited on the way up (after the bottom, within 400 ms of passing 70% back up)", x.counts.length === up.length && lag.every((d) => d > -200 && d < 400), lag.map(Math.round).join(","));
  const xb = runC(segs, {});
  check("browser counter (no opts.app) still counts the same reps", xb.reps === 8, xb.reps); }
// 2. didn't lock out
{ const lockFail = (t, f) => (t > 8200 && t < 10900 ? 0.02 + 0.6 * Math.max(f, 0.55) : normalBend(t, f)); // rep 4 comes up with bent arms
  const segs = [[2000, 0, 0], ...S.reps(6, 2000)], x = runC(segs, { app: true }, (c) => withElbows(c, lockFail));
  check("app: rep that comes up without locking the arms out is refused 'didn't lock out'", x.refused.includes(PC.REFUSE.lock), x.refused.join(" | "));
  check("app: 'Lock out your arms' shown while waiting at the top", x.statuses.includes("Lock out your arms"));
  check("app: the reps around it still count (5 of 6)", x.reps === 5, x.reps); }
// 3. not low enough (elbows barely bend)
{ const shallow = (t, f) => (t > 6000 && t < 8200 ? 0.02 + 0.08 * f : normalBend(t, f)), segs = [[2000, 0, 0], ...S.reps(5, 2000)];
  const x = runC(segs, { app: true }, (c) => withElbows(c, shallow));
  check("app: rep with barely bent elbows is refused 'not low enough'", x.refused.includes(PC.REFUSE.low) && x.reps === 4, x.refused.join(" | ") + " reps " + x.reps); }
// 4. no speed refusal
for (const per of [8000, 12000, 20000]) {
  const segs = [[2000, 0, 0], ...S.reps(1, 2000), ...S.reps(3, per)], a = runC(segs, { app: true }), b = runC(segs, {});
  check(`app: ${per / 1000} s reps after a normal first rep all count, no 'Too slow' (browser keeps its rule: ${b.reps} counted)`, a.reps === 4 && !a.statuses.some((s) => /too slow/i.test(s)) && b.reps < 4, a.reps); }
{ const segs = [[2000, 0, 0], ...S.reps(4, 12000)], a = runC(segs, { app: true });
  check("app: 12 s reps from the very first rep all count", a.reps === 4, a.reps); }
{ const segs = [[2000, 0, 0], ...S.reps(4, 12000)], a = runC(segs, { app: true }, (c) => (f, t) => S.frameFor(f, c, t));
  check("app: slow reps also count with elbows hidden (shoulders + wrists only)", a.reps === 4, a.reps); }
// 5. refusal reasons always present when a rep is refused
{ const fast = [[2000, 0, 0], ...S.reps(2, 2000), [100, 0, 1], [40, 1, 1], [100, 1, 0], [1500, 0, 0], ...S.reps(2, 2000)], x = runC(fast, { app: true });
  check("app: bounced rep refused 'too fast'", x.refused.includes(PC.REFUSE.fast), x.refused.join(" | "));
  const xb = runC(fast, {}); check("browser: same rep keeps the original wording, no refused field", !xb.refused.length && xb.statuses.some((s) => s === "Not counted: go all the way down")); }
// 6. plank push press (top hold) never ends or fails a set, with the new counting
function simHold(segs, opts) {
  const c = Object.assign({}, S.BASE), ctr = PC.createCounter(opts), w = SS.createFailureWatch(), hr = SS.createHoldReward(), fr = withElbows(c, normalBend); w.reset(0);
  let out = null, awards = 0, maxHold = 0;
  for (let t = 0; t <= S.total(segs); t += 1000 / c.fps) { const kps = fr(S.fracAt(segs, t), t); ctr.update(kps, t, c.W); const st = ctr.state();
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop: CH.atTopFrom(st) }); if (f && !out) out = f;
    const h = hr.update(CH.atTopFrom(st), t, false); maxHold = Math.max(maxHold, h.holdMs); if (h.awarded) awards++; }
  return { out, reps: ctr.state().reps, awards, maxHold };
}
{ const x = simHold([[2000, 0, 0], ...S.reps(5, 1800), [5 * 60000, 0, 0], ...S.reps(5, 1800)], { app: true });
  check("app: 5-minute plank push press mid-set never ends or fails the set; reps count after it", x.out === null && x.reps >= 9, `fail=${x.out} reps=${x.reps}`);
  check("app: 30-second plank push press bonus once per set, hold timer runs the whole hold", x.awards === 1 && x.maxHold >= 5 * 60000 - 2000, `${x.awards} / ${Math.round(x.maxHold / 1000)} s`); }
{ const c = CH.createChallenge({ durationMs: 180000, topCapMs: 10000 }); c.start(0); let ended = null; for (let t = 0; t <= 170000; t += 100) { const s = c.update(t, { atTop: true }); if (s.ended && ended == null) ended = t; }
  check("challenge: holding the top never ends it before 3:00 (cap logic unchanged)", ended === null); }
// 7. browser counter frame-for-frame identical to 760c669
{ let OLD = null; const tmp = path.join(os.tmpdir(), "pc-760c669-" + process.pid + ".js");
  try { fs.writeFileSync(tmp, cp.execSync("git show 760c669:push-counter.js", { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "ignore"] })); OLD = require(tmp); } catch (e) {}
  if (!OLD) check("equivalence: 760c669 push-counter.js available", false);
  else {
    const profiles = [[[2000, 0, 0], ...S.reps(8, 2000)], [[2000, 0, 0], ...S.reps(3, 9000)], [[1000, 0, 0], ...S.reps(3, 1800), [60000, 0, 0], ...S.reps(3, 1800)], [[2000, 0, 0], ...S.reps(2, 2000), [100, 0, 1], [40, 1, 1], [100, 1, 0], ...S.reps(2, 2000)], [[2000, 0, 0], ...S.half(2000, 0.5), ...S.reps(3, 2500)]];
    let same = true, frames = 0;
    for (const segs of profiles) for (const mk of [(c) => withElbows(c, normalBend), (c) => (f, t) => S.frameFor(f, c, t)]) {
      S.reseed(5); const c = Object.assign({}, S.BASE, { noise: 0.003, drop: 0.05 }), fr = mk(c), a = PC.createCounter(), b = OLD.createCounter();
      for (let t = 0; t <= S.total(segs); t += 1000 / 30) { const k = fr(S.fracAt(segs, t), t); const ra = JSON.stringify(a.update(k, t, c.W)), rb = JSON.stringify(b.update(k, t, c.W)); frames++; if (ra !== rb) same = false; }
    }
    check("browser: createCounter() output identical to 760c669 on every frame (incl. frames with elbows)", same, frames + " frames");
  }
  try { fs.unlinkSync(tmp); } catch (e) {} }
// 8. coaching lines (app only module)
{ const L = COACH.LINES, K = (o) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: 0.9 }));
  const body = K({ left_shoulder: [256, 170], right_shoulder: [384, 170], left_wrist: [240, 330], right_wrist: [400, 330] });
  let luma = 0.5; const c = COACH.createCoach({ luma: () => luma });
  check("coach: good framing and light -> no line", c.update(body, 0, 640, 480) === "");
  luma = 0.05; check("coach: dark frame -> 'Too dark'", c.update(body, 1000, 640, 480) === L.dark);
  luma = 0.18; check("coach: 'Too dark' clears only above the clear level (no flicker)", c.update(body, 2000, 640, 480) === L.dark);
  luma = 0.4; check("coach: brighter -> clears", c.update(body, 3000, 640, 480) === "");
  check("coach: too close", c.update(K({ left_shoulder: [100, 170], right_shoulder: [500, 170], left_wrist: [90, 400] }), 3100, 640, 480) === L.close);
  check("coach: too far", c.update(K({ left_shoulder: [300, 170], right_shoulder: [340, 170], left_wrist: [298, 210] }), 3200, 640, 480) === L.far);
  const sh = K({ left_shoulder: [256, 400], right_shoulder: [384, 400] });
  check("coach: arms out of frame only after 1 s without elbows or wrists", c.update(sh, 3500, 640, 480) === "" && c.update(sh, 4300, 640, 480) === L.arms);
  check("coach: shoulders not visible -> no coach line (counter's own message shows)", c.update([], 5000, 640, 480) === ""); }
// 9. page wiring: app only, browser unchanged
const html = fs.readFileSync(HTML, "utf8");
check("page: app counter gets { app: true }; browsers call createCounter() exactly as before", html.includes("if (!pushCounter && window.ZabbadatPush && isNativeApp()) pushCounter = window.ZabbadatPush.createCounter({ app: true });\n        if (!pushCounter && window.ZabbadatPush) pushCounter = window.ZabbadatPush.createCounter();"));
check("page: push-coach.js loads only in the app; browser CAM_SCRIPTS list unchanged", /isNativeApp\(\) \? CAM_SCRIPTS\.concat\(\["\/push-coach\.js"\]\) : CAM_SCRIPTS/.test(html) && !/CAM_SCRIPTS = \[[^\]]*push-coach/.test(html));
check("page: TUT battle counter stays the shared (browser) rules, so app and browser players are judged the same", /tbCounter = window\.ZabbadatPush\.createCounter\(\); \/\/ separate instance/.test(html) && !/tbCounter = [^\n]*app: true/.test(html));
check("page: the one new speech call site (sayPushHint) is app-only and only speaks during a running set or for a refused rep", /function sayPushHint\(line, now, force\) \{\n  if \(!line \|\| !isNativeApp\(\)\) return;/.test(html) && /coachLine && pushState\.running && !pushState\.finished && typeof sayPushHint/.test(html) && /r\.refused && pushState\.running && !pushState\.finished\)/.test(html));
check("page: no canvas / drawing code added to the page (luminance lives in push-coach.js)", !/getContext\(|drawImage/.test(html));
(async () => {
  const rep = (t0, per) => (t) => { if (t < t0) return { d: 0 }; const p = (t - t0) % per, q = per / 2.5; return { d: p < q ? p / q : p < q * 1.3 ? 1 : p < q * 2.3 ? 1 - (p - q * 1.3) / q : 0 }; };
  for (const per of [2000, 10000]) {
    const a = await flow(HTML, { mode: "sets", script: rep(10000, per), ms: 10000 + per * 6 + 500, native: true, opts: { app: true }, coach: "{ luma: () => 0.5 }" });
    const b = await flow(HTML, { mode: "sets", script: rep(10000, per), ms: 10000 + per * 6 + 500 });
    check(`flow (real startPush/poseTick): ${per / 1000} s reps -> app ${a.reps} of 6, browser ${b.reps}`, a.reps === 6 && (per === 2000 ? b.reps === 6 : b.reps <= 2));
  }
  const spoken = [], dark = await flow(HTML, { mode: "sets", script: rep(10000, 2000), ms: 14000, native: true, opts: { app: true }, coach: "{ luma: () => 0.03 }", spoken });
  check("flow (app): dark room -> 'Too dark' on screen and spoken", dark.trace.length >= 0 && spoken.some((s) => s.w === "Too dark"), spoken.map((s) => s.w).slice(0, 8).join(" | "));
  const sb = [], br = await flow(HTML, { mode: "sets", script: rep(10000, 2000), ms: 14000, spoken: sb });
  check("flow (browser): no coaching lines spoken", !sb.some((s) => /Too dark|Too close|Too far|Arms out|Not counted/.test(s.w)));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
