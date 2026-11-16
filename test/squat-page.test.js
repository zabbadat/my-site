// Gyatt Squats page wiring: scripts loaded, host bridge, face logo on every pose frame + cleared on stop, cadence
// starts after Go and re-syncs at counted reps, End set, camera closes on every end, Eastern-day totals.
const fs = require("fs"), path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = read("index.html"), pg = read("squat-page.js"), gs = require("../get-set.js"), SS = require("../squat-session.js"), ETD = require("../et-day.js");
const R = []; const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); R.push(!!ok); };

check("index loads gyatt-cadence.js, squat-counter.js, squat-session.js, then squat-page.js (defer, after the module's helpers)", /<script src="\/gyatt-cadence\.js"><\/script>\s*<script src="\/squat-counter\.js"><\/script>\s*<script src="\/squat-session\.js"><\/script>\s*<script src="\/squat-page\.js" defer><\/script>/.test(html));
check("host bridge defined before the Firebase awaits (camera works offline); save added once Firebase loads", html.indexOf("window.ZabSquatHost = {") > 0 && html.indexOf("window.ZabSquatHost = {") < html.indexOf('await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js")') && html.indexOf("window.ZabSquatHost.save = async") > html.indexOf("const db = getFirestore(app);"));
check("host: Vision on iOS (ensurePushPose), same camera constraints, sign-in gate with practice, stops push-up and plank cameras", /ensurePose: \(\) => ensurePushPose\(\)/.test(html) && /CAM_CONSTRAINTS,/.test(html) && /if \(camOn\) stopCam\(\); if \(pushStarting\) cancelPushStart\(\); if \(plankLoop\) stopPlankCam\(\);/.test(html));
check("save writes squats/{id} with exactly the rule fields (source camera, reps capped 1000)", /addDoc\(collection\(db, "squats"\)/.test(html) && /source: "camera", sessionStartedAt: Math\.round\(Number\(record\.sessionStartedAt\)\), createdAt: serverTimestamp\(\)/.test(html) && /Math\.min\(1000, Math\.floor\(Number\(record\.reps\)/.test(html));
check("ZAB: claimed through the server as source 'squats' after a saved set of 10+", /award: \(id\) => awardZab\("squats", id\)/.test(html) && /if \(r\.reps >= 10\) H\.award\(id\)/.test(pg));
check("face logo: ZabPfp.frame(vid, kps, t) on every pose frame from camera open (tick starts before the countdown)", /window\.ZabPfp\.frame\(vid, kps, t\)/.test(pg) && pg.indexOf("tick(++st.loopId)") < pg.indexOf("makeNextSetCountdown()") && !/ZabPfp\.(setOn|setUser|plankFrame)/.test(pg));
check("face logo cleared when the camera closes", /window\.ZabPfp\.clear\("sqVid"\)/.test(pg));
check("camera closes on every end: endSet -> closeCam (tracks stopped, wrap hidden, full screen off, wake lock off)", /function endSet\(r\) \{[\s\S]*?closeCam\(\);/.test(pg) && /getTracks\(\)\.forEach\(function \(t\) \{ t\.stop\(\); \}\)/.test(pg) && /\$\("sqWrap"\)\.hidden = true/.test(pg) && /H\.camFs\("sqWrap", false\)/.test(pg));
check("auto end from the set logic ends the set (r.ended -> endSet)", /if \(r\.ended\) \{ endSet\(r\); return; \}/.test(pg));
check("End set button: during start cancels, during the set stops with reason 'stopped'", /\$\("sqEndBtn"\)\.addEventListener\("click", endNow\)/.test(pg) && /st\.set\.stop\(now\(\), "stopped"\)/.test(pg));
check("standing baseline calibrated during the 1-2-3-Go countdown", /st\.calibrating = true;[\s\S]*?makeNextSetCountdown\(\)/.test(pg) && /if \(st\.calibrating && st\.counter\) st\.counter\.calibrate\(kps, t\)/.test(pg));
check("cadence starts 1 s after Go; set clock at Go; stops with the set", /CADENCE_LEAD_MS = 1000/.test(pg) && /st\.set\.start\(now\(\)\);[\s\S]*?setTimeout\(function \(\) \{ st\.cadenceTimer = null; if \(st\.running && live\(\)\) cadence\.start\(\); \}, CADENCE_LEAD_MS\)/.test(pg) && /function stopCadence\(\)[^\n]*cadence\.stop\("set"\)/.test(pg));
check("cadence pose-sync: re-sync at a counted rep only when > 1 s off the cadence's rep boundary; pose hook fed each frame", /cadence\.offBoundaryMs\(\) > RESYNC_MS\) cadence\.resync\(r\.reps \+ 1\)/.test(pg) && /cadence\.pose\(\{ phase: r\.phase \}\)/.test(pg) && /RESYNC_MS = 1000/.test(pg));
check("reps come from pose only (the cadence never sets reps)", !/onRep[\s\S]{0,80}paintReps/.test(pg) && /paintReps\(r\.reps\)/.test(pg));
check("short COACH.squats lines: front-facing, whole body in frame, stand tall", /camera facing you/.test(gs.COACH.squats.place) && /whole body is in frame/.test(gs.COACH.squats.criteria) && /Stand tall/.test(gs.COACH.squats.criteria) && gs.COACH.squats.criteria.length < 80);
check("1-2-3-Go is the shared get-set countdown", /GS\.makeNextSetCountdown\(\)/.test(pg));
check("only Start set starts; no Pause / Finish / Reset in the glue", !/Pause|Finish set|Reset total/.test(pg));
// Eastern-day totals
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
const s = mem(), before = Date.parse("2026-11-17T04:59:00Z"), after = Date.parse("2026-11-17T05:00:30Z"); // 11:59 PM / 12:00 AM Eastern
SS.recordSet(s, 12, before); SS.recordSet(s, 8, before); SS.recordSet(s, 0, before);
check("day totals: 2 sets / 20 squats on Nov 16 Eastern (a 0-rep set is not a set)", JSON.stringify(SS.getDay(s, before)) === JSON.stringify({ reps: 20, sets: 2 }) && SS.dayKey(before) === "zabbadat-squats-day-2026-11-16");
check("Eastern midnight: Nov 17 starts at 0 without any reset button", JSON.stringify(SS.getDay(s, after)) === JSON.stringify({ reps: 0, sets: 0 }) && SS.dayKey(after) === "zabbadat-squats-day-2026-11-17");
check("msToMidnight: 1 minute before Eastern midnight = 60 s; page repaints then", Math.abs(SS.msToMidnight(before) - 60000) < 2 && /midnightRepaint\(\)/.test(pg) && /SS\.msToMidnight\(\)/.test(pg));
check("DST-safe: after spring forward (Mar 14 2027) the day flips at 04:00 UTC (EDT midnight)", SS.dayKey(Date.parse("2027-03-15T03:59:00Z")) === "zabbadat-squats-day-2027-03-14" && SS.dayKey(Date.parse("2027-03-15T04:00:30Z")) === "zabbadat-squats-day-2027-03-15");
const nf = R.filter((x) => !x).length; console.log(`\n${R.length - nf}/${R.length} passed`); process.exit(nf ? 1 : 0);
