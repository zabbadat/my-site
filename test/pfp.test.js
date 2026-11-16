// PFP phase one: photo URL / initial fallback, face-cover placement math, and the overlay can never change the push
// session (set starts, user recognized, no instant "set complete") with the switch on or off. Run: node test/pfp.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PF = require("../pfp.js"), S = require("./lib/push-synth.js"), run = require("./lib/push-flow-harness.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

// 1. photo URL + initial
check("Google photoURL passes through", PF.photoUrl({ photoURL: "https://lh3.googleusercontent.com/a/abc=s96-c" }) === "https://lh3.googleusercontent.com/a/abc=s96-c");
check("X _normal upgraded to _400x400", PF.photoUrl({ photoURL: "https://pbs.twimg.com/profile_images/1/me_normal.jpg" }) === "https://pbs.twimg.com/profile_images/1/me_400x400.jpg");
check("X _normal without extension upgraded", PF.photoUrl({ photoURL: "https://pbs.twimg.com/profile_images/1/me_normal" }) === "https://pbs.twimg.com/profile_images/1/me_400x400");
check("falls back to providerData photo", PF.photoUrl({ photoURL: null, providerData: [{ photoURL: "https://x.test/p.png" }] }) === "https://x.test/p.png");
check("no photo / non-https / null user -> empty (initial circle)", PF.photoUrl({}) === "" && PF.photoUrl({ photoURL: "http://a/b.jpg" }) === "" && PF.photoUrl({ photoURL: "javascript:alert(1)" }) === "" && PF.photoUrl(null) === "");
check("initial from name, then X handle, then email, else Z", PF.initialOf({ displayName: "zabba dat" }) === "Z" && PF.initialOf({ displayName: "  maria" }) === "M" && PF.initialOf({ reloadUserInfo: { screenName: "jojo" } }) === "J" && PF.initialOf({ email: "kim@x.com" }) === "K" && PF.initialOf({}) === "Z");

// 2. placement math
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const face = K({ nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195], left_shoulder: [240, 300], right_shoulder: [400, 300] });
const c = PF.faceCircle(face);
check(`circle centred on the ear midpoint, not pulled toward the nose (x ${c && c.x.toFixed(0)}, y ${c && c.y.toFixed(0)})`, c && Math.abs(c.x - 320) < 1e-9 && Math.abs(c.y - 195) < 1e-9);
check(`radius covers ear-to-ear and eye spread generously (r ${c && c.r.toFixed(0)} >= 60)`, c && c.r >= 60 && c.r >= (PF.P.eyeK * 40) / 2);
check("every face keypoint lies inside the circle", c && face.slice(0, 5).every((k) => Math.hypot(k.x - c.x, k.y - c.y) < c.r));
{ const sh = PF.headCircle(K({ left_shoulder: [240, 300], right_shoulder: [400, 300] }), 640, 480);
  check(`head down / hooded: logo estimated from shoulders (x ${sh && sh.x}, y ${sh && sh.y.toFixed(0)}, r ${sh && sh.r.toFixed(0)})`, sh && sh.src === "shoulders" && sh.x === 320 && Math.abs(sh.y - (300 - 160 * 0.55)) < 1e-9 && Math.abs(sh.r - 160 * 0.483) < 1e-9);
  const hood = PF.headCircle(K({ nose: [320, 200], left_shoulder: [240, 300], right_shoulder: [400, 300] }), 640, 480);
  check("hood fabric 'nose' is ignored: shoulders decide", hood && hood.src === "shoulders");
  const hf = PF.headCircle(face, 640, 480);
  const faceR = (PF.P.eyeK * 40) / 2 * PF.P.padK, top = 195 - faceR, idealY = top + Math.max(faceR, 160 * PF.P.shR, (300 - top) / 2);
  const oldY = (185 * 2 + 200) / 3, oldOff = Math.hypot(320 - 320, oldY - idealY), newOff = Math.hypot(hf.x - 320, hf.y - idealY);
  check(`face + shoulders: cover recentred over face and shoulders (x ${hf.x.toFixed(1)}, y ${hf.y.toFixed(1)}, r ${hf.r.toFixed(1)}; before ${oldOff.toFixed(1)} px off, after ${newOff.toFixed(1)} px)`, hf.src === "face" && Math.abs(hf.x - 320) < 1e-9 && newOff < 1 && newOff < oldOff && hf.y + hf.r >= 300 - 1e-6 && (hf.y - hf.r) <= top + 1e-6);
  // Nose-shifted 3/4 face: old centre mixed the nose in (pulled right); new uses ear midpoint + shoulders.
  const turned = K({ nose: [355, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195], left_shoulder: [240, 300], right_shoulder: [400, 300] });
  const ht = PF.headCircle(turned, 640, 480), oldTurnedX = (320 + 355) / 2, newTurnedOff = Math.abs(ht.x - 320), oldTurnedOff = Math.abs(oldTurnedX - 320);
  check(`turned face: horizontal offset ${oldTurnedOff.toFixed(1)} px -> ${newTurnedOff.toFixed(1)} px`, newTurnedOff < 1 && newTurnedOff < oldTurnedOff);
  const big = PF.headCircle(K({ left_shoulder: [0, 470], right_shoulder: [640, 470] }), 640, 480); check(`caps: r <= 0.40 x shorter side (${big.r} <= 192)`, Math.abs(big.r - 192) < 1e-9);
  const tiny = PF.headCircle(K({ left_shoulder: [300, 300], right_shoulder: [310, 300] }), 640, 480); check("caps: min radius 10 px", tiny && tiny.r === 10);
  check("no shoulders and no face: nothing drawn", PF.headCircle(K({ left_wrist: [100, 400] }), 640, 480) === null);
  const mc = PF.miniCrop({ x: 320, y: 200, r: 60 }, 640, 480, 88); check(`mini crop: square around the head inside the frame, logo centred (${mc.logo.x.toFixed(0)},${mc.logo.y.toFixed(0)})`, mc.side === 192 && mc.sx === 224 && mc.sx + mc.side <= 640 && mc.sy >= 0 && Math.abs(mc.logo.x - 44) < 1e-9 && mc.logo.r < 44);
  const edge = PF.miniCrop({ x: 10, y: 10, r: 60 }, 640, 480, 88); check("mini crop clamps at the frame edge", edge.sx === 640 - 192 && edge.sy === 0); }
check("hood: lone nose (fabric) never makes a face circle", PF.faceCircle(K({ nose: [320, 200], left_shoulder: [240, 300], right_shoulder: [400, 300] })) === null);
check("head down: shoulders only -> no circle (nothing blocked)", PF.faceCircle(K({ left_shoulder: [240, 300], right_shoulder: [400, 300] })) === null);
check("low-confidence face points ignored", PF.faceCircle(K({ nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185] }, 0.1)) === null);
check("bare MoveNet-order array works", !!PF.faceCircle([[320, 200], [300, 185], [340, 185], [280, 195], [360, 195]].map(([x, y]) => ({ x, y, score: 0.9 }))));
check("empty / junk keypoints -> null, no throw", PF.faceCircle([]) === null && PF.faceCircle(null) === null && PF.faceCircle([{ x: NaN, y: 1 }]) === null);
{ const tr = PF.createTracker(); const a = tr.step(face, 0), b = tr.step([], 500), d = tr.step([], 1100);
  check("tracker holds the last spot ~1 s, enlarged, then clears", a && b && b.held && b.r > a.r && Math.abs(b.x - a.x) < 1e-9 && d === null);
  tr.reset(); tr.step(face, 0); const moved = K({ nose: [420, 200], left_eye: [400, 185], right_eye: [440, 185], left_ear: [380, 195], right_ear: [460, 195] });
  const m = tr.step(moved, 33); check(`tracker follows a 100 px jump at once without overshoot (moved ${m && (m.x - 320).toFixed(0)} px in one frame)`, m && m.x > 380 && m.x <= 421); }
// Follow speed (Nov 15): One Euro + latency lead. Fast moves follow in ~1 frame, a still head stays steady, no runaway lead.
{ const F = (x, n) => K({ nose: [x + n(), 210 + n()], left_eye: [x - 20 + n(), 200 + n()], right_eye: [x + 20 + n(), 200 + n()], left_ear: [x - 40 + n(), 208 + n()], right_ear: [x + 40 + n(), 208 + n()] });
  let sd = 7; const rnd = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 4, z = () => 0;
  const tr = PF.createTracker(); let t = 0; for (; t < 1000; t += 66) tr.step(F(320, z), t, 640, 480);
  let n = 0, c; do { c = tr.step(F(420, z), t, 640, 480); t += 66; n++; } while (n < 10 && (c.x - 320) < 90);
  check(`tracker: a quick 100 px move reaches 90% in ${n} frame(s) at 15 fps (old EMA took 3)`, n <= 2);
  const st = PF.createTracker(); let prev = null, sum = 0, k = 0; for (t = 0; t < 4000; t += 66) { const s = st.step(F(320, rnd), t, 640, 480); if (t > 1000 && prev) { sum += Math.hypot(s.x - prev.x, s.y - prev.y); k++; } prev = s; }
  check(`tracker: still head with ±2 px keypoint noise moves ${(sum / k).toFixed(2)} px/frame (< 1.5)`, sum / k < 1.5);
  const ld = PF.createTracker(); for (t = 0; t < 1000; t += 33) ld.step(F(320 + t * 0.4, z), t, 640, 480, t + 1000); const lc = ld.step(F(720, z), 1000, 640, 480, 1100);
  check(`tracker: lead is capped at ${PF.P.leadCap} r (ahead ${(lc.x - 720).toFixed(1)} px, r ${lc.r.toFixed(0)})`, lc.x - 720 <= PF.P.leadCap * lc.r + 1e-6 && lc.x > 720);
  const sp = PF.createTracker(); for (t = 0; t < 1000; t += 33) sp.step(F(320 + t * 0.4, z), t, 640, 480, t + 50); for (; t < 1400; t += 33) c = sp.step(F(720, z), t, 640, 480, t + 50);
  check(`tracker: after the head stops the lead is gone (off by ${(c.x - 720).toFixed(2)} px)`, Math.abs(c.x - 720) < 1);
  const noDraw = PF.createTracker(); noDraw.step(F(320, z), 0, 640, 480); const nd = noDraw.step(F(320, z), 33, 640, 480); check("tracker: no draw time -> no lead (old callers unchanged)", Math.abs(nd.x - 320) < 1e-9); }
// Side-on (plank / plank push press from the side): shoulders overlap, so the head goes on the body line, not a tiny circle.
{ const so = PF.headCircle(K({ left_shoulder: [200, 250], right_shoulder: [205, 252], left_hip: [380, 270], right_hip: [383, 271] }), 640, 480);
  check(`side-on, no face: head past the shoulder on the hip->shoulder line (x ${so && so.x.toFixed(0)}, r ${so && so.r.toFixed(0)}, ${so && so.src})`, so && so.src === "side" && so.x < 200 && so.r > 30);
  const fr = PF.headCircle(K({ left_shoulder: [240, 300], right_shoulder: [400, 300], left_hip: [260, 480], right_hip: [380, 480] }), 640, 480);
  check("front-on shoulders still use the shoulder estimate", fr && fr.src === "shoulders" && Math.abs(fr.x - 320) < 1e-9); }
{ const fill = PF.mapToBox({ x: 320, y: 240, r: 40 }, 640, 480, 320, 240, "fill"), cont = PF.mapToBox({ x: 0, y: 0, r: 10 }, 640, 480, 400, 400, "contain");
  check("mapToBox: fill scales, contain letterboxes", fill.x === 160 && fill.y === 120 && fill.r === 20 && cont.x === 0 && Math.abs(cont.y - 50) < 1e-9 && cont.r === 6.25); }

// 3. browser frame(): fake DOM; switch off/on; never throws; never mutates keypoints
function fakeDom(store) {
  const calls = []; const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => ((t[k] = v), true) });
  const mk = (tag) => ({ tag, style: {}, children: [], className: "", classList: { add() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; }, insertBefore(c) { this.children.push(c); c.parentNode = this; }, removeChild() {}, getContext: () => ctx2d, querySelector: () => null });
  const parent = mk("div"); const vid = { id: "camVid", parentNode: parent, nextSibling: null, clientWidth: 320, clientHeight: 240, offsetLeft: 0, offsetTop: 40, videoWidth: 640, videoHeight: 480 };
  const document = { readyState: "complete", getElementById: () => null, createElement: mk, addEventListener() {} };
  const w = { document, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, getComputedStyle: () => ({ objectFit: "fill" }), devicePixelRatio: 2, Image: function () {}, setTimeout, clearTimeout, Date, Math };
  return { w, vid, calls, parent };
}
function loadPfp(w) { const ctx = Object.assign({}, w); ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx); return ctx; }
{ const store = {}, D = fakeDom(store), ctx = loadPfp(D.w), P = ctx.ZabPfp; const frozen = JSON.parse(JSON.stringify(face)); face.forEach(Object.freeze); Object.freeze(face);
  P.setUser({ uid: "u1", displayName: "Zab", photoURL: "https://lh3.googleusercontent.com/a/x" });
  P.frame(D.vid, face, 0); check("switch off: no overlay canvas created", D.parent.children.length === 0 && P.isOn() === false);
  P.setOn(true); const ret = P.frame(D.vid, face, 33);
  check("switch on: one canvas overlaid after the video; frame() returns nothing", D.parent.children.length === 1 && D.parent.children[0].className === "pfp-cover" && ret === undefined);
  const cv = D.parent.children[0];
  check("canvas is placed over the video box and drew a clipped circle", cv.style.top === "40px" && /translate\(/.test(cv.style.transform) && D.calls.includes("clip") && D.calls.includes("arc"));
  check("keypoints never mutated (frozen input, same values)", JSON.stringify(face) === JSON.stringify(frozen));
  let threw = false; try { P.frame(D.vid, null, 50); P.frame(null, face, 60); P.frame({}, face, 70); P.frame(D.vid, [{ x: "a" }], 80); P.frame(D.vid, face, NaN); } catch (e) { threw = true; } check("junk inputs never throw", !threw);
  const D2 = fakeDom(store); D2.vid.parentNode = { insertBefore() { throw new Error("boom"); } }; threw = false; try { P.frame(D2.vid, face, 90); } catch (e) { threw = true; } check("a DOM failure inside the overlay is swallowed", !threw);
  { const sp = D.w.document.createElement("span"); sp.className = "pfp-av"; sp.classList = { add() { sp.live = 1; }, remove() { sp.live = 0; } }; sp.removeChild = (c) => { sp.children = sp.children.filter((x) => x !== c); c.parentNode = null; };
    const badge = { querySelector: (q) => (q === ".pfp-av" ? sp : null) }; D.w.document.getElementById = (id) => (id === "ztBadge" ? badge : null);
    D.vid.videoWidth = 640; D.vid.videoHeight = 480; P.frame(D.vid, face, 1000); P.frame(D.vid, face, 1010);
    const n1 = sp.children.length; check("mini-feed: one round canvas in the top-bar avatar while frames arrive", n1 === 1 && sp.children[0].className === "pfp-mini" && sp.live === 1);
    D.calls.length = 0; P.frame(D.vid, face, 1020); const throttled = !D.calls.includes("translate"); P.frame(D.vid, face, 1100); check("mini-feed throttled to ~15 fps (skips a frame 10 ms later, draws at +100 ms)", throttled && D.calls.includes("translate"));
    P.setOn(false); check("switch off: mini-feed removed, static avatar back", sp.children.length === 0 && sp.live === 0); P.setOn(true); }
  P.setUser(null); check("signed out: switch reads off even if stored on", P.isOn() === false && store.zabPfpOn === "1"); }

// 4. page wiring
const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
check("PFP row sits in the top nav directly after the links, toggle first then the exact label", /<\/a>\n    <\/div>\n    <label class="pfp-row" id="pfpRow" for="pfpToggle"[^>]*hidden><input type="checkbox" id="pfpToggle" role="switch"[^>]*><span class="pfp-sw"[^>]*><\/span><span class="pfp-lbl">Enable profile - PFP<\/span><span class="pfp-hint"[^>]*>[^<]+<\/span><span class="sr-only-pfp">[^<]+<\/span><\/label>\n  $/.test(nav));
check("pfp.js loaded before the page scripts", html.indexOf('<script src="/pfp.js"></script>') > 0 && html.indexOf('<script src="/pfp.js"></script>') < html.indexOf("function poseTick("));
const tick = html.slice(html.indexOf("async function poseTick("), html.indexOf("async function openCam()"));
check("push-ups/TUT: overlay fed after Vision rescue, before the counter, with the same keypoints", /visionRescue\(pose, vid, tFrame\);[^\n]*\n\s+if \(window\.ZabPfp\) window\.ZabPfp\.frame\(vid, pose \? pose\.keypoints : \[\], tFrame\);/.test(tick) && tick.indexOf("ZabPfp.frame") < tick.indexOf("pushCounter.update("));
const tb = html.slice(html.indexOf("async function tbPose()"), html.indexOf("// 3:00 reached"));
check("TUT Battle: overlay fed from the same kps", /ZabPfp\.frame\(v, kps, tFrame\)/.test(tb) && tb.indexOf("ZabPfp.frame") < tb.indexOf("tbCounter.update("));
check("showUser feeds ZabPfp; #avatar keeps no-referrer + onerror removal", /window\.ZabPfp\.setUser\(user\)/.test(html) && /img\.referrerPolicy = "no-referrer"/.test(html) && /img\.onerror = \(\) => \{ img\.onerror = null; img\.remove\(\); \}/.test(html));
check("no Firestore writes in pfp.js", !/firestore|setDoc|updateDoc|fetch\(/.test(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8")));

// 5. real push flow (sliced from index.html) with pfp.js in the same vm: identical results switch off vs on
(async () => {
  const script = (t) => ({ d: t < 4000 ? 0 : (Math.sin(((t - 4000) / 1800) * Math.PI * 2 - Math.PI / 2) + 1) / 2 });
  const seen = {};
  const go = (on) => run(path.join(ROOT, "index.html"), { mode: "sets", script, ms: 30000, setup: (ctx) => {
    const store = { zabPfpOn: on ? "1" : "0" }, D = fakeDom(store); Object.assign(ctx, { document: D.w.document, localStorage: D.w.localStorage, getComputedStyle: D.w.getComputedStyle, devicePixelRatio: 2, Image: function () {} });
    vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx);
    ctx.ZabPfp.setUser({ uid: "u1", displayName: "Zab" });
    const realFrame = ctx.ZabPfp.frame; ctx.pfpCalls = 0; let fv = null; ctx.ZabPfp.frame = (v, k, t) => { ctx.pfpCalls++; fv = fv || Object.assign({}, D.vid, { videoWidth: v.videoWidth || 640 }); return realFrame(fv, k, t); }; // one stable element, like the page
    seen[on ? "on" : "off"] = { ctx, D }; } });
  const off = await go(false), on = await go(true);
  const sum = (x) => `start ${x.startedAt} reps ${x.reps} running ${x.running} trace ${x.trace.map((s) => s.st).join(">")}`;
  console.log("  off:", sum(off)); console.log("  on: ", sum(on));
  check("switch OFF: set starts, user recognized, reps count, not instantly ended", off.startedAt > 0 && off.reps >= 5 && off.running === true);
  check("switch ON: set starts, user recognized, reps count, not instantly ended", on.startedAt > 0 && on.reps >= 5 && on.running === true);
  check("switch ON vs OFF: identical session (start time, reps, counter states)", on.startedAt === off.startedAt && on.reps === off.reps && on.counterReps === off.counterReps && JSON.stringify(on.trace) === JSON.stringify(off.trace));
  check(`overlay really ran on every pose frame (${seen.on.ctx.pfpCalls} frames) and drew only when ON`, seen.on.ctx.pfpCalls > 100 && seen.on.D.parent.children.length === 1 && seen.on.D.calls.includes("clip") && seen.off.D.parent.children.length === 0);
  // A broken overlay (throws) still cannot touch the session: the page guards with window.ZabPfp && frame() never throws, so test a hostile frame.
  const hostile = await run(path.join(ROOT, "index.html"), { mode: "sets", script, ms: 30000, setup: (ctx) => { ctx.ZabPfp = { frame() { return undefined; } }; } });
  check("stub overlay present: same session too", hostile.reps === off.reps && hostile.startedAt === off.startedAt);
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.log("FAIL harness", e); process.exit(1); });
