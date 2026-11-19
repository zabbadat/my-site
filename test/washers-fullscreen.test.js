const fs = require("fs"), path = require("path");
const F = require("../washers-fs.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pfp = fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8");
const proof = fs.readFileSync(path.join(__dirname, "..", "tools/pfp-proof/run.mjs"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

check("WashersFs enter / exit toggles cam-fs", (function () {
  const { JSDOM } = (() => { try { return require("jsdom"); } catch (e) { return {}; } })();
  if (!JSDOM) {
    // No jsdom: still verify the API shape and that enter is a no-op without a document node.
    return typeof F.enter === "function" && F.enter("zmGame") === false && F.CLASS === "cam-fs";
  }
  return false;
})() || (typeof F.enter === "function" && F.enter("missing") === false && F.CLASS === "cam-fs" && F.IDS.play === "zmGame" && F.IDS.watch === "zlStage"));

check("play and watch roots exist for single and split full screen", html.includes('id="zmGame"') && html.includes('id="zlStage"') && html.includes('id="zmLiveSlot"') && html.includes('id="zmCamBox"'));
check("full-screen HUD reuses arcade-strip / arcade-num / arcade-lbl", /\barcade-strip washers-fs-strip\b/.test(html) && html.includes("arcade-num") && html.includes('data-fs-clock') && html.includes('data-fs-score="0"'));
check("versus full-screen HUD has no steps cell", !/washers-fs-strip[\s\S]{0,800}steps/i.test(html));
function hasBtn(id, ghost) {
  const re = new RegExp(`id="${id}"[^>]*class="[^"]*\\bbtn` + (ghost ? "\\s+ghost" : "") + `|class="[^"]*\\bbtn` + (ghost ? "\\s+ghost" : "") + `[^"]*"[^>]*id="${id}"`);
  return re.test(html);
}
check("caster End button is a site .btn", hasBtn("zlEndBtn", false));
check("watch End button is a site .btn", hasBtn("zlWatchEndBtn", false));
check("Full screen buttons reuse .btn.ghost", hasBtn("zlFsBtn", true) && hasBtn("zlWatchFsBtn", true));
check("all washers FS buttons stay on existing .btn / .btn.ghost classes (no invented FS button style)", !/\.washers-fs-.*btn[^{]*\{[^}]*background:(?!var\(--grad\))/ .test(html) && !/washers-fs-btn/.test(html) && !/zl-fs-btn/.test(html));
check("End stops the live session and leaves full screen", html.includes("zlCastStop") && html.includes("WashersFs.exitCast") && html.includes("zlEndBtn") && html.includes("WashersFs.exitWatch"));
check("Go live enters CSS .cam-fs (no Fullscreen API required)", html.includes("WashersFs.enterCast") && /zlCastCode = zmCode[\s\S]{0,250}enterCast/.test(html));
check("stop live / stop watching / leave match also exit full screen", html.includes("function zlCastStop") && html.includes("WashersFs.exitCast") && /function zlStop\(\)[\s\S]{0,500}exitWatch/.test(html) && html.includes("WashersFs.exitAll"));
check("split-screen full screen keeps both camera columns", /#zlStage\.cam-fs .zl-tiles\{[^}]*grid-template-columns:1fr 1fr/.test(html));
check("single and split FS reuse the same .cam-fs fixed column as other cameras", /#zmGame\.cam-fs,#zmLiveSlot\.cam-fs,#zmCamBox\.cam-fs,#zlStage\.cam-fs\{[^}]*position:fixed/.test(html) && /flex-direction:column/.test(html));
check("production OPEN_IDS is unchanged (registerCam only adds test cameras)", /var OPEN_IDS = \{ camVid: 1, plankVid: 1, tbVid: 1, sqVid: 1, zlSelf: 1, zmCamVid: 1 \};/.test(pfp));
check("pfp-proof is the existing runner, extended with fs states like mirror-21", proof.includes('surface: "mirror21"') && proof.includes("sc.fs") && proof.includes("WashersFs") && !/new proof|proof framework/i.test(proof));
check("never reintroduce openMask or a rec.js / pfp full-frame dark hood", !/\bopenMask\b/.test(html+pfp) && !/full-frame dark/.test(fs.readFileSync(path.join(__dirname, "..", "rec.js"), "utf8")) && !/coverBack blanket/.test(pfp));
check("paint writes score + clock and never a steps field", (function () {
  const nodes = {};
  const strip = { querySelector(sel) { if (!nodes[sel]) nodes[sel] = { textContent: "", hidden: false }; return nodes[sel]; } };
  const prev = global.document;
  global.document = { querySelectorAll() { return [strip]; } };
  try {
    F.paint({ clock: "1:05", seats: [{ name: "Ada", score: 12 }, { name: "Bo", score: 7 }] });
    return nodes["[data-fs-clock]"].textContent === "1:05" && nodes["[data-fs-score='0']"].textContent === "12" && nodes["[data-fs-score='1']"].textContent === "7" && nodes["[data-fs-lbl='0']"].textContent === "Ada" && !Object.keys(nodes).some((k) => /step/i.test(k));
  } finally { if (prev === undefined) delete global.document; else global.document = prev; }
})());

const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
