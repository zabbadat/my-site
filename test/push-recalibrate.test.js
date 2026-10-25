// Solo push-ups, leaned-up front-facing camera: zero calibration, 2 s setup prompt, 5 s countdown, Go.
// Regression: reps never register after the single Start button when the user is still placing the phone / getting
// into plank while the camera opens. Runs the REAL flow (startPush -> openCam -> poseTick -> 3-2-1 -> beginPushClock)
// sliced from index.html with real push-counter / push-session / push-challenge / get-set and synthetic pose frames.
const path = require("path"), run = require("./lib/push-flow-harness.js"), P = require("../push-counter.js"), S = require("./lib/push-synth.js");
const R = []; const check = (n, ok, x) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  (" + x + ")" : ""}`); R.push(!!ok); };
const HTML = path.join(__dirname, "..", "index.html");
const SW = 0.2;
// one rep per 2 s starting at t0: 800 ms down, 300 ms bottom, 800 ms up, 100 ms top
const repAt = (t0) => (t) => { const p = (t - t0) % 2000; return t < t0 ? 0 : p < 800 ? p / 800 : p < 1100 ? 1 : p < 1900 ? 1 - (p - 1100) / 800 : 0; };
// Start takes 9 s with no speech (place line, 2 s criteria, 7 s countdown)
const SH = 2000;
const S0 = {
  ideal: (t) => ({ d: t < 8000 ? 0 : repAt(8000)(t) }),
  // user starts close to the phone and backs away while the prompts play: the shoulders shrink and the height changes
  close: (t) => { const k = t < 1500 ? 0 : t < 3500 ? (t - 1500) / 2000 : 1; return { d: t < 6000 ? 0 : repAt(6000)(t), sw: 0.34 + (SW - 0.34) * k, y: 120 + 50 * k }; },
  // user starts far from the phone and steps in
  far: (t) => { const k = t < 1500 ? 0 : t < 3500 ? (t - 1500) / 2000 : 1; return { d: t < 6000 ? 0 : repAt(6000)(t), sw: 0.12 + (SW - 0.12) * k, y: 200 - 30 * k }; },
  early: (t) => ({ d: t < 1500 ? 0 : repAt(1500)(t) }),
  // first rep with a 1.5 s pause at the bottom, then normal reps
  bottomPause: (t) => { if (t < 4000) return { d: 0 }; if (t < 4800) return { d: (t - 4000) / 800 }; if (t < 6300) return { d: 1 }; if (t < 7100) return { d: 1 - (t - 6300) / 800 }; if (t < 9000) return { d: 0 }; return { d: repAt(9000)(t) }; }
};
const shifted = (f) => (t) => f(t - SH);
check("DEFAULTS pinned (One Euro filter, wrist reach gate, depth in shoulder widths; no elbow angle, no size view)", JSON.stringify(P.DEFAULTS) === JSON.stringify({ minScore: 0.3, holdMs: 300, poorMs: 1000, minCutoff: 3, beta: 6, dCutoff: 1, tauMs: 70, glitchRatio: 0.45, glitchMaxMs: 250, calibMs: 1000, steadyTol: 0.05, minDepth: 0.2, downRom: 0.7, upRom: 0.3, minBottomMs: 120, minRepMs: 400, maxRepMs: 6000, adapt: 0.15, reachFrac: 0.4, reachReturn: 0.35, topFollowMs: 400, topWinMs: 7000 }));
(async () => {
  for (const mode of ["sets", "long", "challenge"]) { const r = await run(HTML, { mode, script: shifted(S0.ideal), ms: 32000 }); check(mode + ": first real dip after Go counts; every rep counted (11 in 30 s)", r.reps === 11 && r.running && r.startedAt === 9000, "reps " + r.reps); }
  let r = await run(HTML, { mode: "sets", script: shifted(S0.close), ms: 32000 }); check("user too close to the phone at first, then backs away: start level follows, reps count", r.reps >= 10, "reps " + r.reps);
  r = await run(HTML, { mode: "sets", script: shifted(S0.far), ms: 32000 }); check("user far from the phone at first, then steps in: reps count", r.reps >= 10, "reps " + r.reps);
  r = await run(HTML, { mode: "long", script: shifted(S0.far), ms: 32000 }); check("One long set: same recovery", r.reps >= 10, "reps " + r.reps);
  r = await run(HTML, { mode: "challenge", script: shifted(S0.close), ms: 32000 }); check("Three-minute challenge: same recovery", r.reps >= 10, "reps " + r.reps);
  r = await run(HTML, { mode: "sets", script: shifted(S0.early), ms: 32000 }); check("dips during the prompt/countdown never count; counting starts at Go", r.trace.every((x) => x.run || x.reps === 0) && r.reps >= 11, "reps " + r.reps);
  r = await run(HTML, { mode: "sets", script: shifted(S0.bottomPause), ms: 32000 }); check("1.5 s pause at the bottom of the first rep: later reps count", r.reps >= 9, "reps " + r.reps);
  // pure counter: steady frames never lock anything, never count
  const c = P.createCounter(); S.reseed(2);
  for (let t = 0; t < 6000; t += 33) c.update(S.frameFor(0, S.BASE, t), t, 640);
  check("steady at the top for 6 s: nothing locked, nothing counted, no calibration step", c.state().phase === "calibrate" && c.state().top == null && c.state().reps === 0);
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
