// Solo push-ups: top locks from the first real dip (lockOnDip), 2 s setup prompt, 5 s countdown, Go.
// Regression: solo push-ups "reps never register" after the single Start button.
// Single Start opens the camera and locks the top on the first steady second (~0.9 s), usually while the user is
// still placing the phone / getting into plank; the counter never re-calibrated, so no rep could ever count.
// Runs the REAL flow (startPush -> openCam -> poseTick -> waitCalibrated -> 3-2-1 -> beginPushClock) sliced from
// index.html with real push-counter / push-session / push-challenge / get-set and synthetic pose frames.
const path = require("path"), run = require("./lib/push-flow-harness.js"), P = require("../push-counter.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const HTML = path.join(__dirname, "..", "index.html");
const TOP = 0.3125, BOT = 0.42;
const repAt = (t0) => (t) => { const p = (t - t0) % 2000; const f = p < 800 ? p / 800 : p < 1100 ? 1 : p < 1900 ? 1 - (p - 1100) / 800 : 0; return { w: TOP + f * (BOT - TOP), e: 170 - f * 90 }; };
const S = {
  ideal: (t) => (t < 8000 ? { w: TOP, e: 170 } : repAt(8000)(t)),
  close: (t) => t < 1500 ? { w: 0.55, e: 120 } : t < 3500 ? { w: 0.55 + (TOP - 0.55) * (t - 1500) / 2000, e: 150 } : t < 6000 ? { w: TOP, e: 170 } : repAt(6000)(t),
  far: (t) => t < 1500 ? { w: 0.2, e: 170 } : t < 3500 ? { w: 0.2 + (TOP - 0.2) * (t - 1500) / 2000, e: 170 } : t < 6000 ? { w: TOP, e: 170 } : repAt(6000)(t),
  early: (t) => (t < 1500 ? { w: TOP, e: 170 } : repAt(1500)(t)),
  // first rep with a 1.5 s pause at the bottom, then normal reps
  bottomPause: (t) => { if (t < 4000) return { w: TOP, e: 170 }; if (t < 4800) { const f = (t - 4000) / 800; return { w: TOP + f * (BOT - TOP), e: 170 - 90 * f }; }
    if (t < 6300) return { w: BOT, e: 80 }; if (t < 7100) { const f = 1 - (t - 6300) / 800; return { w: TOP + f * (BOT - TOP), e: 170 - 90 * f }; } if (t < 9000) return { w: TOP, e: 170 }; return repAt(9000)(t); },
};
check("DEFAULTS unchanged", JSON.stringify(P.DEFAULTS) === JSON.stringify({ minScore: 0.3, holdMs: 300, poorMs: 1000, tauMs: 70, glitchRatio: 0.45, glitchMaxMs: 250, calibMs: 1000, steadyTol: 0.05, minDepth: 0.12, downRom: 0.7, upRom: 0.3, minBottomMs: 120, minRepMs: 400, maxRepMs: 6000, adapt: 0.15, elbowFrac: 0.4 }));
(async () => {
  for (const mode of ["sets", "long", "challenge"]) { const r = await run(HTML, { mode, script: S.ideal, ms: 30000 }); check(mode + ": first real dip after Go sets the top and counts; every rep counted (11 in 30 s)", r.reps === 11 && r.running && r.startedAt === 7000); }
  let r = await run(HTML, { mode: "sets", script: S.close, ms: 30000 }); check("top locked while phone was close to the chest -> re-calibrates and counts (was 0)", r.reps >= 11);
  r = await run(HTML, { mode: "sets", script: S.far, ms: 30000 }); check("top locked while kneeling/far -> re-calibrates and counts (was 0)", r.reps >= 11);
  r = await run(HTML, { mode: "long", script: S.far, ms: 30000 }); check("One long set: same recovery", r.reps >= 11);
  r = await run(HTML, { mode: "challenge", script: S.close, ms: 30000 }); check("Three-minute challenge: same recovery", r.reps >= 11);
  r = await run(HTML, { mode: "sets", script: S.early, ms: 30000 }); check("dips during the prompt/countdown never count; counting starts at Go", r.trace.every((x) => x.run || x.reps === 0) && r.reps === 12);
  r = await run(HTML, { mode: "sets", script: S.bottomPause, ms: 30000 }); check("1.5 s pause at the bottom of the first rep: recovers, later reps count", r.reps >= 9);
  // pure counter: no re-calibration once ready; correct top is never moved in the first phase
  const c = P.createCounter(); const f = (w) => [{ name: "left_shoulder", x: 320 - w * 320, y: 240, score: .9 }, { name: "right_shoulder", x: 320 + w * 320, y: 240, score: .9 }];
  for (let t = 0; t < 6000; t += 33) c.update(f(TOP), t, 640);
  check("steady at the real top: no spurious re-calibration", !c.state().recalibrated && Math.abs(c.state().top - TOP) < 0.005 && c.state().phase === "first");
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
