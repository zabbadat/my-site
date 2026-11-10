// App-only MediaPipe Pose Landmarker adapter (pose-mediapipe.js): 33 landmarks -> MoveNet keypoints for push-counter.js,
// counting on the way up, coaching lines, and app-only gating in index.html. Run: node test/pose-mediapipe.test.js
const fs = require("fs"), path = require("path");
const MP = require("../pose-mediapipe.js"), { createCounter } = require("../push-counter.js"), S = require("./lib/push-synth.js");
let pass = 0, fail = 0; const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + n + (extra ? "  " + extra : "")); };
const W = 640, H = 480;
// MoveNet keypoints (already mirrored, pixels) -> raw MediaPipe landmarks (unmirrored, normalized)
function toLandmarks(kps) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 2, z: 0, visibility: 0.01 }));
  const idx = Object.fromEntries(MP.MAP);
  for (const k of kps) lms[idx[k.name]] = { x: 1 - k.x / W, y: k.y / H, z: 0, visibility: k.score };
  return lms;
}

check("maps all 17 MoveNet keypoints, MoveNet order", MP.MAP.length === 17 && MP.MAP[5][0] === "left_shoulder" && MP.MAP[5][1] === 11 && MP.MAP[10][0] === "right_wrist" && MP.MAP[10][1] === 16);
{ const lms = Array.from({ length: 33 }, (_, i) => ({ x: 0.25, y: 0.5, visibility: 0.9 }));
  const k = MP.toMoveNet(lms, W, H, true), k2 = MP.toMoveNet(lms, W, H, false);
  check("pixels + flipHorizontal like TF.js", k[0].x === 480 && k[0].y === 240 && k2[0].x === 160 && k.length === 17);
  check("score = visibility", k[0].score === 0.9); }
{ const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 1.3, visibility: 0.95 }));
  check("landmark guessed outside the frame gets a low score (not a sighting)", MP.toMoveNet(lms, W, H, true)[0].score <= 0.1); }
check("no landmarks -> no keypoints", MP.toMoveNet(undefined, W, H, true).length === 0);

// Same rep scenarios through the MediaPipe mapping: counts on the way up, same as MoveNet.
const viaMP = (o) => { const c = createCounter(o); return { update: (kps, t, w) => c.update(MP.toMoveNet(toLandmarks(kps), W, H, true), t, w), state: c.state }; };
const cal = S.hold(1200), tail = S.hold(500);
{ S.reseed(5); const r = S.run(viaMP, [...S.hold(100), ...S.reps(3, 1500), ...tail]); check("via MediaPipe: first rep counts, credited on the way up", r.reps === 3 && r.countTimes[0] < 100 + 1500, `reps ${r.reps}`); }
{ S.reseed(5); const r = S.run(viaMP, [...cal, ...S.reps(10, 1500), ...tail], { noise: 0.004 }); check("via MediaPipe: 10 reps with jitter", r.reps === 10, `reps ${r.reps}`); }
{ S.reseed(5); const r = S.run(viaMP, [...cal, ...S.reps(6, 1500), ...tail], { travel: 0.15 }); check("via MediaPipe: shallow dips never count", r.reps === 0, `reps ${r.reps}`); }
{ S.reseed(5); const r = S.run(viaMP, [...cal, ...S.reps(5, 3500), ...tail]); check("via MediaPipe: slow 3.5 s reps count", r.reps === 5, `reps ${r.reps}`); }

// Coaching (like Golden Push-Ups / Pushup RPG): dark, nobody, hands, too far / close.
const good = S.frameFor(0, S.BASE, 0);
check("coach: good frame is silent", MP.coachText(good, W, H, 120) === "");
check("coach: too dark", /Too dark/.test(MP.coachText(good, W, H, 20)));
check("coach: nobody in view", /Move into view/.test(MP.coachText([], W, H, 120)));
check("coach: hands out of frame", /hands in frame/.test(MP.coachText(good.filter((k) => !/wrist/.test(k.name)), W, H, 120)));
check("coach: too far", /Too far/.test(MP.coachText(S.frameFor(0, Object.assign({}, S.BASE, { sw: 0.08 }), 0), W, H, 120)));
{ const c = MP.createCoach({ holdMs: 700 });
  const a = c.update([], 0, W, H, null, 120), b = c.update([], 500, W, H, null, 120), d = c.update([], 800, W, H, null, 120), e = c.update(good, 900, W, H, null, 120);
  check("coach: a line shows only after it holds 700 ms, clears at once", a === "" && b === "" && /Move into view/.test(d) && e === ""); }
check("placement hint mentions distance and arms", /2 feet/.test(MP.PLACEMENT) && /arms/.test(MP.PLACEMENT));

// Gating in index.html: browsers keep CAM_SCRIPTS + MoveNet; only the app loads pose-mediapipe.js.
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
check("pose-mediapipe.js is loaded only via APP_CAM_SCRIPTS (app), never as a page script", /const APP_CAM_SCRIPTS = \["\/push-counter\.js", "\/pose-mediapipe\.js"\]/.test(html) && !/<script[^>]*pose-mediapipe/.test(html) && !/CAM_SCRIPTS = \[[^\]]*pose-mediapipe/.test(html.replace(/APP_CAM_SCRIPTS = \[[^\]]*\]/, "")));
check("loadCamLibs: browsers use CAM_SCRIPTS", /\(isNativeApp\(\) \? APP_CAM_SCRIPTS : CAM_SCRIPTS\)/.test(html));
check("ensurePose: MediaPipe only when isNativeApp(); plank asks for MoveNet", /if \(engine !== "movenet" && isNativeApp\(\)\) return ensurePosePush\(\);/.test(html) && /const det = await ensurePose\("movenet"\);/.test(html));
check("MediaPipe failure falls back to MoveNet", /mediaPipeFailed = true[\s\S]{0,200}pushPoseDetector = await ensurePose\("movenet"\)/.test(html));
check("assets are local (bundled with the app): /vendor/mediapipe", /createDetector\(\{ base: "\/vendor\/mediapipe" \}\)/.test(html));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
