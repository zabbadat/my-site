// Side-view PFP (Nov 17): in a side push-up and a side plank, the logo covers head down to the chest and never blocks
// the arms under the body; the face stays fully hidden. Run: node test/pfp-side-cover.test.js
const PF = require("../pfp.js");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const inside = (c, p, pad = 0) => c && Math.hypot(p.x - c.x, p.y - c.y) + pad <= c.r + 1e-6;
const faceNames = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"];

// Side plank / side push-up: body along +x, head on the left, arms under the shoulder (larger y = toward the floor).
function sidePose(kind) {
  // kind: "plank" or "push" — same profile, slight pose difference
  const lift = kind === "push" ? 16 : 0; // push-up top is a bit higher
  return {
    nose: [150, 230 - lift], left_eye: [160, 220 - lift], right_eye: [145, 222 - lift],
    left_ear: [185, 225 - lift], right_ear: [140, 228 - lift],
    left_shoulder: [200, 250 - lift], right_shoulder: [205, 252 - lift],
    left_hip: [380, 270 - lift], right_hip: [383, 271 - lift],
    left_elbow: [200, 330 - lift / 2], right_elbow: [206, 328 - lift / 2],
    left_wrist: [200, 385 - lift / 2], right_wrist: [204, 382 - lift / 2],
    left_ankle: [590, 300], right_ankle: [592, 298]
  };
}
const chestOf = (o) => {
  const sh = { x: o.left_shoulder[0], y: o.left_shoulder[1] }, hp = { x: o.left_hip[0], y: o.left_hip[1] };
  return { x: sh.x + (hp.x - sh.x) * PF.P.chestFrac, y: sh.y + (hp.y - sh.y) * PF.P.chestFrac };
};

function checkView(label, fn, pose) {
  const kps = K(pose), c = fn(kps, 640, 480), face = PF.faceCircle(kps), chest = chestOf(pose);
  const faceOk = face && face.pts.every((p) => inside(c, p, (face.w || 40) * PF.P.coverPad * 0.5)) &&
    inside(c, { x: face.x, y: face.y - (face.w || 40) * PF.P.topUp }, (face.w || 40) * PF.P.coverPad * 0.5);
  const chestOk = inside(c, chest, 0);
  const arms = ["left_elbow", "right_elbow", "left_wrist", "right_wrist"].map((n) => ({ name: n, x: pose[n][0], y: pose[n][1] }));
  const armHits = arms.filter((p) => Math.hypot(p.x - c.x, p.y - c.y) + 4 < c.r);
  check(`${label}: placed (${c && c.src}, r ${c && c.r.toFixed(0)}, x ${c && c.x.toFixed(0)}, y ${c && c.y.toFixed(0)})`, !!c && c.r >= 10);
  check(`${label}: face fully hidden`, !!faceOk, { c, face });
  check(`${label}: chest is under the logo`, !!chestOk, { chest, c });
  check(`${label}: elbows and wrists stay outside the logo (${armHits.map((a) => a.name).join(",") || "none"} inside)`, armHits.length === 0, armHits);
}

checkView("side push-up (headCircle)", PF.headCircle, sidePose("push"));
checkView("side plank (plankHead)", PF.plankHead, sidePose("plank"));

// Front view must stay on the face+shoulder cover, not the side path.
{
  const front = K({
    nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195],
    left_shoulder: [240, 300], right_shoulder: [400, 300], left_hip: [260, 480], right_hip: [380, 480],
    left_elbow: [200, 420], right_elbow: [440, 420]
  });
  const c = PF.headCircle(front, 640, 480);
  check("front view still uses the face/shoulder cover (not side)", c && c.src === "face");
}

const ok = R.filter(Boolean).length;
console.log(`\n${ok}/${R.length} passed`);
if (ok !== R.length) process.exit(1);
