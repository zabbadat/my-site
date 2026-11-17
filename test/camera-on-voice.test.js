// Camera-on line (owner, Nov 17): every camera start says "Camera on." (+ "Your face is covered." only when the PFP cover is on)
// plus what to do; coached starts lead the criteria line with it (never cancels / talks over), restarts say nothing extra,
// uncoached cameras (Live Match board camera, Live cast) get it queued politely. Run: node test/camera-on-voice.test.js
const fs = require("fs"), path = require("path");
const GS = require("../get-set.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), sq = fs.readFileSync(path.join(__dirname, "..", "squat-page.js"), "utf8");
check("base line without the face cover", GS.cameraOnLine(false) === "Camera on.");
check("base line with the face cover", GS.cameraOnLine(true) === "Camera on. Your face is covered.");
check("withCameraOn leads the guidance line", GS.withCameraOn("Shoulders and hands in frame.", true) === "Camera on. Your face is covered. Shoulders and hands in frame.");
global.window = { ZabPfp: { isOn: () => true } };
check("face part follows ZabPfp.isOn()", GS.cameraOnLine() === "Camera on. Your face is covered.");
window.ZabPfp.isOn = () => false; check("face part dropped when the cover is off", GS.cameraOnLine() === "Camera on.");
delete global.window;
check("index.html: criteria (spoken once the camera is up; skipped on restart) leads with the camera-on line", /const spoken = !place && G && G\.withCameraOn \? G\.withCameraOn\(txt\) : txt;/.test(html) && /G\.sayAndWait\(spoken,/.test(html));
check("index.html: on-screen criteria text unchanged (only the spoken line gains the camera-on words)", /el\.textContent = txt;/.test(html));
check("squat-page.js: Gyatt squats criteria leads with the camera-on line", /GS\.sayAndWait\(GS\.withCameraOn \? GS\.withCameraOn\(C\.criteria\) : C\.criteria,/.test(sq));
// watcher
function doc() { const ls = []; return { ls, addEventListener: (t, f, c) => ls.push({ t, f, c }), removeEventListener() {} }; }
const cam = (id) => ({ target: { id, srcObject: { getVideoTracks: () => [{}] } } });
{ const d = doc(), said = []; let now = 0, busy = false; const q = [];
  const w = GS.watchCameraVoice(d, { now: () => now, schedule: (f, ms) => q.push([f, ms]), speak: (t) => said.push(t), busy: () => busy });
  check("watcher listens for camera video 'playing' (capture)", d.ls.length === 1 && d.ls[0].t === "playing" && d.ls[0].c === true);
  w.handle(cam("zmCamVid")); check("Live Match board camera: camera-on line + board guidance", said[0] === "Camera on. Point the camera at the board.");
  now = 5000; w.handle(cam("zmCamVid")); check("same camera again within a minute (facing switch / resume): silent", said.length === 1);
  w.handle(cam("camVid")); w.handle(cam("sqVid")); w.handle(cam("plankVid")); w.handle(cam("tbVid"));
  check("coached cameras are not double-spoken by the watcher", said.length === 1);
  w.handle({ target: { id: "zlSelf", srcObject: null } }); check("not a camera stream: silent", said.length === 1);
  busy = true; w.handle(cam("zlSelf")); check("other speech playing: waits, never cancels", said.length === 1 && q.length === 1);
  busy = false; now += 300; q.shift()[0](); check("then speaks once quiet", said[1] === "Camera on. Point the camera at the board.");
  busy = true; now = 200000; w.handle(cam("zmCamVid")); while (q.length) { now += 150; q.shift()[0](); } check("still busy after the wait window: dropped (never piles up)", said.length === 2); }
const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); if (bad) process.exit(1);
