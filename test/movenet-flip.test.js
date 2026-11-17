// MoveNet mirror fix (Nov 17): pose-detection 2.1.3 MoveNet ignores flipHorizontal, so the PFP cover landed on the MIRROR
// side of the head (face visible off-centre). honorFlip makes the detector mirror x when asked; Vision is left alone.
const fs = require("fs"), path = require("path"), PF = require("../pfp.js");
let pass = 0, fail = 0; const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); c ? pass++ : fail++; };
(async () => {
  const seen = []; const fake = () => ({ estimatePoses: async (img, cfg) => { seen.push(cfg); return [{ keypoints: [{ name: "nose", x: 410, y: 100 }, { name: "left_eye", x: 400, y: 90 }] }]; } }); // raw camera x (ignores flip, like MoveNet 2.1.3)
  const d = PF.honorFlip(fake());
  const vid = { videoWidth: 640, videoHeight: 480 }, cv = { width: 640, height: 480 };
  let p = await d.estimatePoses(vid, { flipHorizontal: true });
  check(`video, flipHorizontal: nose 410 -> ${p[0].keypoints[0].x} (640 - 410)`, p[0].keypoints[0].x === 230 && p[0].keypoints[1].x === 240);
  p = await d.estimatePoses(cv, { flipHorizontal: true });
  check("canvas snapshot (PFP shield input), flipHorizontal: mirrored with the canvas width", p[0].keypoints[0].x === 230);
  p = await d.estimatePoses(vid, { flipHorizontal: false });
  check("no flip asked (#zlSelf, not mirrored): raw x untouched", p[0].keypoints[0].x === 410);
  check("library itself is never asked to flip (no double flip if a later version honours it)", seen.every((c) => !c.flipHorizontal));
  check("wrapping twice is a no-op", PF.honorFlip(d) === d && (await d.estimatePoses(vid, { flipHorizontal: true }))[0].keypoints[0].x === 230);
  const vis = { engine: "vision", estimatePoses: async () => [{ keypoints: [{ x: 410, y: 1 }] }] }, ve = vis.estimatePoses;
  check("Apple Vision detector (pose-vision.js mirrors itself) is left alone", PF.honorFlip(vis) === vis && vis.estimatePoses === ve);
  // cover lands on the head in the mirrored picture: head at raw x 410 in a 640 frame shows at 230 on screen
  const K = (o) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: 0.9 }));
  const raw = { nose: [410, 200], left_eye: [425, 185], right_eye: [395, 185], left_ear: [440, 190], right_ear: [380, 190], left_shoulder: [485, 290], right_shoulder: [335, 290] };
  const dd = PF.honorFlip({ estimatePoses: async () => [{ keypoints: K(raw) }] }), q = await dd.estimatePoses(vid, { flipHorizontal: true }), c = PF.headCircle(q[0].keypoints, 640, 480);
  check(`cover centre on the mirrored head (x ${c.x.toFixed(0)} = 640 - 410)`, Math.abs(c.x - 230) < 1);
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), mt = fs.readFileSync(path.join(__dirname, "..", "match-pfp-cam.js"), "utf8");
  check("index.html: the shared MoveNet detector (push, plank, squats, TUT, Live Match, iOS rescue) gets honorFlip", /moveNetOpts\(null\)\); \}\n  if \(window\.ZabPfp && window\.ZabPfp\.honorFlip\) window\.ZabPfp\.honorFlip\(poseDetector\);/.test(html));
  check("match-pfp-cam.js: its own fallback MoveNet gets honorFlip", /root\.ZabPfp\.honorFlip\(d\)/.test(mt));
  console.log(`${pass}/${pass + fail} passed`); if (fail) process.exitCode = 1;
})();
