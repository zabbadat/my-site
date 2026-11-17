// iOS app, PFP on (Nov 17 2026): when Apple Vision misses the body and MoveNet rescues the frame, MoveNet must run on the
// SAME snapshot the shield will show (pfp.js pending()), not the live <video>. The rescue awaits Vision first and
// ensurePose() can take seconds the first time (TF.js + model download), so the live video is a later frame: the logo
// would be placed where the head moved to, on an older picture where the head was somewhere else.
// Run: node test/ios-vision-rescue-snapshot.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const line = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n", i)); };
const block = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n}\n", i) + 2); };
const src = ["let visionFailed = false;", line("const VISION_RESCUE"), line("let visionSeenT"), block("function shouldersIn(pose)"), block("async function visionRescue(")].join("\n");
const sh = [{ name: "left_shoulder", x: 250, y: 200, score: 0.8 }, { name: "right_shoulder", x: 390, y: 200, score: 0.8 }];
function mk(win) {
  const ctx = { console: { info() {} }, inputs: [] };
  if (win) ctx.window = win;
  ctx.ensurePose = async () => ({ estimatePoses: async (img) => { ctx.inputs.push(img); return [{ keypoints: sh }]; } });
  vm.createContext(ctx); vm.runInContext(src + "\nthis.api = { visionRescue };", ctx); return ctx;
}
(async () => {
  const vid = { id: "camVid", tag: "live-video" }, snap = { tag: "shield-snapshot" };
  // 1. shield on: the pending snapshot goes to MoveNet
  { const c = mk({ ZabPfp: { pending: (id) => (id === "camVid" ? snap : null) } });
    for (let t = 0; t <= 2000; t += 33) await c.api.visionRescue(undefined, vid, t);
    check("PFP shield on: every MoveNet rescue frame is the shield snapshot", c.inputs.length > 0 && c.inputs.every((x) => x === snap), c.inputs.length + " calls"); }
  // 2. shield off (no pending frame): live video, as before
  { const c = mk({ ZabPfp: { pending: () => null } });
    for (let t = 0; t <= 2000; t += 33) await c.api.visionRescue(undefined, vid, t);
    check("PFP off: MoveNet rescue reads the live video (unchanged)", c.inputs.length > 0 && c.inputs.every((x) => x === vid)); }
  // 3. no window / no pfp.js (unit contexts, older pages): live video, never throws
  { const c = mk(null); for (let t = 0; t <= 2000; t += 33) await c.api.visionRescue(undefined, vid, t);
    check("no pfp.js: MoveNet rescue reads the live video, no throw", c.inputs.length > 0 && c.inputs.every((x) => x === vid)); }
  // 4. pfp.js pending(): the snapshot input() took, null when there is no shield
  global.window = undefined;
  const PF = require("../pfp.js");
  check("pfp.js exports pending()", typeof PF.pending === "function");
  check("pfp.js pending() is null for a camera with no shield", PF.pending("camVid") === null);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
