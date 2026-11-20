const fs = require("fs"), path = require("path");
const LT = require("../lower-third.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "lower-third.js"), "utf8");
check("label is exactly Zabbadat", LT.LABEL === "Zabbadat" && /var LABEL = "Zabbadat";/.test(src));
const sizes = [[640, 480], [1280, 720], [1920, 1080], [480, 640], [720, 1280]];
check("layout: bottom-left, inside the frame with a title-safe margin, at every size", sizes.every(([w, h]) => {
  const L = LT.layout(w, h); return L && L.x > 0 && L.y > 0 && L.x + L.w < w * 0.5 && L.y + L.h < h && (h - (L.y + L.h)) >= h * 0.03 && L.y > h * 0.6;
}));
check("layout: small card (<= 40% of width, <= 12% of height)", sizes.every(([w, h]) => { const L = LT.layout(w, h); return L.w <= w * 0.4 + 1 && L.h <= h * 0.12; }));
check("layout: 1920x1080 matches the design (80px margin)", (() => { const L = LT.layout(1920, 1080); return L.x === 80 && L.w === 470 && L.h === 120; })());
check("layout: no frame = no card", LT.layout(0, 0) === null);
check("compositor draws the source first, then the card (cover is never skipped or drawn over the card)", /g\.drawImage\(src, 0, 0, w, h\);[\s\S]*?ensureCard\(w, h\);[\s\S]*?g\.drawImage\(card\.img/.test(src));
check("compositor: no source this frame = nothing drawn (no raw fallback inside)", /var src = opts\.source && opts\.source\(\); if \(!src\) return false;/.test(src));
check("card pre-rendered once per size, not per frame", /cardKey === key\) return;/.test(src));
check("in-DOM canvas (iOS captureStream)", /appendChild\(cv\)/.test(src));
check("no openMask / coverBack / dark cover", !/openMask|coverBack/.test(src) && !/openMask|coverBack/.test(html));
check("index loads lower-third.js after washers-live-controls.js", /washers-live-controls\.js"><\/script>\s*<script src="\/lower-third\.js"><\/script>/.test(html));
check("index: YouTube WHIP sends zlYtOutbound(zlOutbound()), still refusing when zlOutbound() is null", /const out = zlOutbound\(\); if \(!out\) \{[\s\S]{0,300}startWhip\(zlYtOutbound\(out\), cfg\.whipUrl\)/.test(html));
check("index: compositor source is the PFP shield only while Profile is on (never raw)", /function zlYtLowerSource\(\) \{[\s\S]*?if \(pfpOn\) return \(window\.ZabPfp\.shieldCanvas && window\.ZabPfp\.shieldCanvas\("zlSelf"\)\) \|\| null;/.test(html));
check("index: match viewers, preview and Record unchanged (caster still uses outbound)", /zlCaster\.start\(\{[\s\S]*?stream: outbound \|\| zlStream/.test(html) && (html.match(/zlYtOutbound\(/g) || []).length === 2);
check("index: compositor stopped with the camera and on a failed relay", /zlYtPc = null; zlYtLowerStop\(\);/.test(html) && /catch \(e\) \{ zlYtPc = null; zlYtLowerStop\(\);/.test(html));
// compositor with a fake DOM: shield missing -> no frame; shield present -> drawn then card
(function () {
  const calls = [];
  const mkCanvas = () => ({ width: 0, height: 0, style: {}, setAttribute() {}, parentNode: null,
    getContext: () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {}, fillText() {},
      drawImage: (img, x, y) => calls.push([img.tag || "card", x, y]) }),
    captureStream: () => ({ getVideoTracks: () => [{ stop() {} }], getTracks: () => [{ stop() {} }] }) });
  const doc = { createElement: mkCanvas, body: { appendChild(c) { c.parentNode = this; }, removeChild() {} } };
  let shield = null;
  global.requestAnimationFrame = () => 0;
  const LT2 = require("../lower-third.js");
  const c = LT2.compositor({ doc, source: () => shield, fps: 24 });
  check("fake: missing shield paints nothing", calls.length === 0 && c.frames() === 0);
  shield = { tag: "shield", width: 640, height: 480 };
  c.paint();
  check("fake: shield drawn first at full frame, card second at bottom-left", calls.length >= 2 && calls[calls.length - 2][0] === "shield" && calls[calls.length - 1][0] === "card" && calls[calls.length - 1][1] === 27 && calls[calls.length - 1][2] === 416);
  c.stop();
})();
// timing: the frame loop keeps painting (one clock for rAF/timer), ~24 fps
(async function () {
  const calls = [];
  const mkCanvas = () => ({ width: 0, height: 0, style: {}, setAttribute() {}, parentNode: null,
    getContext: () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {}, fillText() {}, drawImage: () => calls.push(1) }),
    captureStream: () => ({ getVideoTracks: () => [{ stop() {} }], getTracks: () => [{ stop() {} }] }) });
  const doc = { createElement: mkCanvas, body: { appendChild(c) { c.parentNode = this; }, removeChild() {} } };
  global.requestAnimationFrame = (f) => setTimeout(() => f(performance.now() + 123456), 16); // rAF timestamp on another base must not stall it
  delete require.cache[require.resolve("../lower-third.js")];
  const LT3 = require("../lower-third.js");
  const c = LT3.compositor({ doc, source: () => ({ width: 640, height: 480 }), fps: 24 });
  await new Promise((r) => setTimeout(r, 500));
  const n = c.frames(); c.stop();
  check("loop keeps painting at about 24 fps (" + n + " frames in 0.5 s)", n >= 8 && n <= 16);
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
})();
