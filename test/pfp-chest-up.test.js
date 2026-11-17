// Locked logo is chest-up on every front view (Nov 17, owner: SUPER BIG — head, neck, shoulders, upper chest;
// roughly the top third of an upright mid-shot; arms and extremities visible below). Side push-up / plank stay
// on the existing head-to-chest path and must not cover the arms under the body. Shared pfp.js (headCircle /
// plankHead) is what every local camera uses: #camVid, #plankVid, #tbVid, #sqVid, #zlSelf, #zmCamVid, rec.js.
const PF = require("../pfp.js");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const byOf = (o) => { const b = {}; for (const k of K(o)) b[k.name] = k; return b; };
const inside = (c, p, pad = 0) => Math.hypot(p[0] - c.x, p[1] - c.y) + pad <= c.r + 1e-6;

const front = {
  nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195],
  left_shoulder: [240, 300], right_shoulder: [400, 300], left_hip: [260, 480], right_hip: [380, 480],
  left_elbow: [200, 420], right_elbow: [440, 420], left_wrist: [180, 500], right_wrist: [460, 500]
};
const c = PF.headCircle(K(front), 640, 480), by = byOf(front);
const chest = PF.chestOf(by.left_shoulder, by.right_shoulder, by);
const face = PF.faceCircle(K(front)), w = face.w, top = [face.x, face.y - w * PF.P.topUp];
check("front mid-shot uses the face+shoulders chest-up cover (not the side path)", c && c.src === "face");
check(`front: x on the shoulder midpoint (${c.x}), y between head top and chest (${c.y.toFixed(1)} is between ${top[1].toFixed(1)} and ${chest.y.toFixed(1)})`,
  Math.abs(c.x - 320) < 1e-9 && c.y > top[1] && c.y < chest.y);
check("front: head top, face, both shoulders and the chest sit inside the logo",
  inside(c, top) && inside(c, [face.x, face.y], w * PF.P.coverPad) && inside(c, front.left_shoulder) && inside(c, front.right_shoulder) && inside(c, [chest.x, chest.y]));
check(`front: arms stay visible below the logo (elbows / wrists outside; bottom at y ${(c.y + c.r).toFixed(0)})`,
  !inside(c, front.left_elbow, 4) && !inside(c, front.right_elbow, 4) && !inside(c, front.left_wrist) && !inside(c, front.right_wrist) && c.y + c.r < front.left_elbow[1]);
check(`front: logo is super-big — diameter ${(2 * c.r / 480).toFixed(2)} of picture height, ${(2 * c.r / 160).toFixed(2)} x shoulder width (want about half the frame / 1.4-1.8 x shoulders)`,
  2 * c.r / 480 >= 0.45 && 2 * c.r / 480 <= 0.65 && 2 * c.r / 160 >= 1.4 && 2 * c.r / 160 <= 1.8);

const noHip = { nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195], left_shoulder: [240, 300], right_shoulder: [400, 300] };
const c2 = PF.headCircle(K(noHip), 640, 480), chest2 = PF.chestOf(byOf(noHip).left_shoulder, byOf(noHip).right_shoulder, byOf(noHip));
check("no hips: chest is estimated a little below the shoulders; still covers head-to-chest",
  chest2.y === 300 + 160 * PF.P.chestDown && c2.y + c2.r >= chest2.y && c2.y - c2.r <= top[1]);

const onlyFace = PF.headCircle(K({ nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195] }), 640, 480);
check("face only (no shoulders): still a chest-up cover, centred below the ears, reaching the estimated chest",
  onlyFace && onlyFace.src === "face" && onlyFace.y > face.y && onlyFace.y + onlyFace.r >= face.y + w * PF.P.chestFromFace - 1 && onlyFace.y - onlyFace.r <= top[1] + 1);

const side = {
  nose: [150, 230], left_eye: [160, 220], right_eye: [145, 222], left_ear: [185, 225], right_ear: [140, 228],
  left_shoulder: [200, 250], right_shoulder: [205, 252], left_hip: [380, 270], right_hip: [383, 271],
  left_elbow: [200, 330], right_elbow: [206, 328], left_wrist: [200, 385], right_wrist: [204, 382]
};
const sc = PF.headCircle(K(side), 640, 480), pl = PF.plankHead(K(side), 640, 480);
check(`side push-up / plank: side/plank path (headCircle ${sc && sc.src}, plankHead ${pl && pl.src}), not the front chest-up circle`,
  sc && sc.src === "side" && pl && (pl.src === "side" || pl.src === "plank"));
check("side: elbows and wrists under the body stay outside the logo",
  !inside(sc, side.left_elbow, 2) && !inside(sc, side.right_elbow, 2) && !inside(sc, side.left_wrist) && !inside(sc, side.right_wrist));

const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
