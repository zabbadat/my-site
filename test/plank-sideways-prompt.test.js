// Plank House sideways-phone prompt (owner Nov 20). Run: node test/plank-sideways-prompt.test.js
const G = require("../get-set.js");
const R = []; const check = (n, ok, x) => { console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); R.push(!!ok); };

check("wording is exact, on the exported line", G.PLANK_SIDE_LINE === "Turn your phone to the side for optimal framing.");

function fakeWin(opts) {
  opts = opts || {};
  const listeners = {};
  const w = {
    innerWidth: opts.w || 390, innerHeight: opts.h || 844,
    matchMedia: (q) => {
      const portrait = (opts.orientation || "portrait") === "portrait";
      const matches = /orientation:\s*portrait/.test(q) ? portrait : /orientation:\s*landscape/.test(q) ? !portrait : false;
      const mq = { matches, addEventListener(type, fn) { (listeners.mq || (listeners.mq = [])).push(fn); }, removeEventListener() {}, addListener() {}, removeListener() {} };
      return mq;
    },
    screen: { orientation: { type: (opts.orientation || "portrait") + "-primary", addEventListener() {}, removeEventListener() {} } },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn); },
    _listeners: listeners
  };
  return w;
}

check("isPortrait: matchMedia portrait", G.isPortrait(fakeWin({ orientation: "portrait" })) === true);
check("isPortrait: matchMedia landscape", G.isPortrait(fakeWin({ orientation: "landscape", w: 844, h: 390 })) === false);
check("isPortrait: size fallback when matchMedia is missing", G.isPortrait({ innerWidth: 390, innerHeight: 844 }) === true);
check("isPortrait: size fallback landscape", G.isPortrait({ innerWidth: 844, innerHeight: 390 }) === false);
check("isPortrait: unreadable returns null (does not throw)", G.isPortrait(null) === null && G.isPortrait({}) === null);

{ const said = [], shown = [], cleared = [];
  const w = fakeWin({ orientation: "portrait" });
  const p = G.makePlankSidePrompt({ win: w, isPortrait: () => true, speak: (s) => said.push(s), show: (s) => shown.push(s), clear: () => cleared.push(1) });
  const line = p.start();
  check("portrait at setup: shows and speaks once, does not block", line === G.PLANK_SIDE_LINE && said.join("|") === G.PLANK_SIDE_LINE && shown[0] === G.PLANK_SIDE_LINE && p.visible() && p.prompted() === 1);
  p.tick();
  check("still portrait: no second prompt while visible", said.length === 1 && p.prompted() === 1);
}

{ const said = [], shown = [], cleared = [];
  let por = true;
  const p = G.makePlankSidePrompt({ isPortrait: () => por, speak: (s) => said.push(s), show: (s) => shown.push(s), clear: () => cleared.push(1) });
  p.start();
  por = false; p.tick();
  check("clears once landscape is detected", !p.visible() && cleared.length === 1 && said.length === 1);
  por = true; p.tick();
  check("re-prompts at most once more if the phone goes back to portrait before the clock starts", said.length === 2 && shown.length === 2 && p.prompted() === 2 && p.visible());
  por = false; p.tick(); por = true; p.tick();
  check("does not nag a third time", said.length === 2 && p.prompted() === 2 && !p.visible());
}

{ const said = [];
  const p = G.makePlankSidePrompt({ isPortrait: () => true, speak: (s) => said.push(s), show() {}, clear() {} });
  p.start(); p.clockStarted();
  p.tick();
  check("does not nag during the hold (clockStarted stops watching)", said.length === 1 && !p.visible() && !p.active());
}

{ const said = [], shown = [];
  const p = G.makePlankSidePrompt({ isPortrait: () => { throw new Error("no orientation"); }, speak: (s) => said.push(s), show: (s) => shown.push(s), clear() {} });
  const line = p.start();
  check("unreadable / throwing orientation does not block or prompt", line === null && said.length === 0 && shown.length === 0 && !p.visible());
}

{ const said = [];
  const p = G.makePlankSidePrompt({ isPortrait: () => false, speak: (s) => said.push(s), show() {}, clear() {} });
  check("already landscape at setup: no prompt", p.start() === null && said.length === 0 && !p.visible());
  // first time we see portrait still gets one prompt (not a 're-prompt')
  // switch via a mutable reader
}

{ let por = false, said = [];
  const p = G.makePlankSidePrompt({ isPortrait: () => por, speak: (s) => said.push(s), show() {}, clear() {} });
  p.start();
  por = true; p.tick();
  check("portrait after a landscape start still gets the first prompt", said.length === 1 && p.prompted() === 1);
}

const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pc = fs.readFileSync(path.join(__dirname, "..", "push-challenge.js"), "utf8");
check("wired at Plank House setup: startPlankCam waits on the prompt before the clock/rules lines", /newPlankHold\(\);\s*if \(typeof promptPlankSideways === "function"\) \{ if \(!\(await promptPlankSideways/.test(html) && /plankSide\.start\(\)/.test(html));
check("cleared when the clock starts (cue Hold / holding tick) and on stop/cancel", /plankSideClockStarted\(\)/.test(html) && /function cancelPlankStart\(\) \{[\s\S]*plankSideReset/.test(html) && /function stopPlankCam\(\) \{[\s\S]*plankSideReset/.test(html));
check("New hold / between-set restarts the prompt", /function newPlankHold\(\) \{[\s\S]*plankSide\.reset\(\); plankSide\.start\(\)/.test(html));
check("on-screen prompt element and exact wording are in the plank stage", /id="plankSidePrompt"/.test(html) && html.includes("Turn your phone to the side for optimal framing."));
check("TUT / push-up / two-minute paths do not call the sideways prompt (front-facing, not a side plank)", !/promptPlankSideways/.test(html.slice(html.indexOf("async function startPush("), html.indexOf("function beginPushClock("))) && !/plankSide/.test(pc));
check("Two-minute challenge countdown uses the Hold steps (clock at Hold)", /const holdSet = /.test(html) && /pushMode === "challenge"[\s\S]*holdSet/.test(html.slice(html.indexOf("function getSetCountdown"), html.indexOf("function getSetCountdown") + 500)) && /line: window\.ZabbadatGetSet\.PLANK_SET_LINE, steps: window\.ZabbadatGetSet\.PLANK_STEPS/.test(html));
check("rep-based getSet countdown is unchanged (Set up, go on three / Go)", /makeNextSetCountdown\(\{ waitIdleMaxMs: 2500 \}\)/.test(html) && G.NEXT_STEPS[3][1] === "Go" && G.PLANK_STEPS[3][1] === "Hold");

const ok = R.filter(Boolean).length;
console.log(`\n${ok}/${R.length} passed`);
process.exit(ok === R.length ? 0 : 1);
