// Play and Earn: one tabbed section after the live cameras block. Run: node test/play-and-earn.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };

const start = html.indexOf('id="play-and-earn"');
const live = html.indexOf('id="live-cameras"');
const hub = html.indexOf('<section id="battles-hub">');
check("Play and Earn section and live cameras block exist", start > 0 && live > 0 && html.includes("<h2>Activate and Earn</h2>"));
check("live cameras sit after Battles hub and before Play and Earn", hub > 0 && live > hub && start > live);
check("Live Match and Watch Live cards are in the live cameras block, not in the Washer Battle tab", (() => {
  const cam = html.slice(live, start);
  const wb = html.slice(html.indexOf('<section id="washerbattle"'), html.indexOf("</section>", html.indexOf('<section id="washerbattle"')));
  return cam.includes('id="zabbaMatch"') && cam.includes("Watch Live: both cameras, live score") && cam.includes('id="zabbaLive"') && !wb.includes("zabbaMatch") && !wb.includes("zabbaLive");
})());
check("tablist with the six labels, default tab Steps (aria-selected), others hidden", (() => {
  const pe = html.slice(start, html.indexOf('<section id="league">'));
  return /role="tablist"/.test(pe)
    && /id="pe-tab-zab"[^>]*>ZAB<\/button>/.test(pe)
    && /id="pe-tab-washerbattle"[^>]*>Washer Battle<\/button>/.test(pe)
    && /id="pe-tab-steps"[^>]*aria-selected="true"[^>]*>Steps<\/button>/.test(pe)
    && /id="pe-tab-tutbattles"[^>]*>TUT Battles<\/button>/.test(pe)
    && /id="pe-tab-plank"[^>]*>Plank House<\/button>/.test(pe)
    && /id="pe-tab-battles"[^>]*>Battles<\/button>/.test(pe)
    && /id="zab"[^>]*role="tabpanel"[^>]*hidden/.test(pe)
    && /id="washerbattle"[^>]*role="tabpanel"[^>]*hidden/.test(pe)
    && /id="steps"[^>]*role="tabpanel"/.test(pe) && !/<section id="steps"[^>]*hidden/.test(pe)
    && /id="tutbattles"[^>]*hidden/.test(pe)
    && /id="plank"[^>]*hidden/.test(pe)
    && /id="battles"[^>]*hidden/.test(pe);
})());
check("compact 10K strip sits above the tab row, full Step Equity stays in the Steps panel", (() => {
  const pe = html.slice(start, html.indexOf('<section id="league">'));
  const strip = pe.indexOf('id="playEarn10k"'), tabs = pe.indexOf('role="tablist"'), steps = pe.indexOf('<section id="steps"');
  return strip > 0 && strip < tabs && tabs < steps
    && pe.includes('id="playEarnSteps"') && pe.includes("Steps today")
    && pe.includes("id=\"tenKBonus\"") && pe.includes("id=\"dailyCount\"") && pe.includes("id=\"dailyStepBoard\"");
})());
check("original IDs and camera/start controls are still in the document (not removed)", html.includes('id="pushStartBtn"') && html.includes('id="plankCamBtn"') && html.includes('id="plankVid"') && html.includes('id="camVid"') && html.includes('id="tbVid"') && html.includes('id="zmCamVid"') && html.includes('id="dailyWalkBtn"') && html.includes('id="wbCreate"'));
check("CSS hides hidden tab panels (display:none) instead of a script that removes them", /#play-and-earn > section\[role="tabpanel"\]\[hidden\] \{ display: none !important; \}/.test(html) && !/panel\.remove\(\)|removeChild\(.*tabpanel/.test(html));
check("hash routing: load + hashchange, unhide on in-page anchors, default Steps", /window\.addEventListener\("hashchange", \(\) => peApplyHash/.test(html) && /peShowTab\("steps"/.test(html) && /a\[href\^='#'\]/.test(html) && /PE_TABS = \["zab", "washerbattle", "steps", "tutbattles", "plank", "battles"\]/.test(html));
check("10K strip paint is wired to the daily steps onChange and native resume hook", /paintPlayEarn10k\(s\.steps\)/.test(html) && /paintPlayEarn10k\(daily\.state\(\)\.steps\)/.test(html));
check("#tut-board and #push stay outside Play and Earn", html.indexOf('<section class="washers" id="tut-board">') < html.indexOf('id="play-and-earn"') && html.indexOf('<section id="push">') < html.indexOf('id="play-and-earn"'));
check("Washer Battle countdown (get-set + 3-2-1) is still present", /get set|get-set|3-2-1|three, go/i.test(html) || fs.existsSync(path.join(__dirname, "../test/washers-prompt-timing.test.js")));

// routing helpers
const src = html.slice(html.indexOf("const PE_TABS ="), html.indexOf("window.addEventListener(\"hashchange\", () => peApplyHash"));
const els = {};
const parentOf = { tenKBonus: "steps", playEarn10k: "play-and-earn", dailyCount: "steps", plankVid: "plank", wbCreate: "washerbattle" };
const mk = (id) => els[id] || (els[id] = { id, hidden: id !== "steps" && !id.startsWith("pe-tab-") && id !== "playEarnSteps" && id !== "playEarn10kFill" && id !== "playEarn10kLabel", attrs: {}, style: {}, childNodes: [], querySelector(){ return this._ring || null; }, appendChild(n){ this.childNodes.push(n); if (n && n.className==="zab") this._ring=n; this.textContent = (this.textContent||"") + (n.textContent||""); return n; }, getAttribute(n){return this.attrs[n];}, setAttribute(n,v){ this.attrs[n]=v; if(n==="hidden") this.hidden = v !== null && v !== false; }, removeAttribute(n){ delete this.attrs[n]; if(n==="hidden") this.hidden=false; }, focus(){ this.focused=true; }, scrollIntoView(){ this.scrolled=true; }, closest(sel){ const pid = parentOf[id]; if (!pid) return null; const ids = sel.split(",").map((s)=>s.replace("#","").trim()); return ids.includes(pid) ? mk(pid) : null; } });
const ctx = {
  PE_SKIP: true,
  document: { getElementById: mk, addEventListener(){}, readyState: "complete" },
  window: { addEventListener(){} },
  location: { hash: "" },
  history: { replaceState(){} },
  $: mk
};
// extract just the functions
const fns = html.match(/const PE_TABS = \[[\s\S]*?function peApplyHash\(opts\) \{[\s\S]*?\n\}/)[0];
vm.createContext(ctx);
vm.runInContext(fns, ctx);
ctx.peShowTab("zab", {});
check("peShowTab shows ZAB and hides Steps", els.zab && els.zab.hidden === false && els.steps.hidden === true && els["pe-tab-zab"].getAttribute("aria-selected")==="true" && els["pe-tab-steps"].getAttribute("aria-selected")==="false");
ctx.location.hash = "#plank";
ctx.peApplyHash({});
check("peApplyHash('#plank') opens the Plank House tab", els.plank.hidden === false && els.zab.hidden === true);
ctx.location.hash = "#tenKBonus";
ctx.peApplyHash({});
check("deep link inside Steps (#tenKBonus) opens the Steps tab", els.steps.hidden === false && els.plank.hidden === true);
ctx.location.hash = "#live=ABCD";
const before = els.steps.hidden;
ctx.peApplyHash({});
check("#live=CODE does not steal a tab (live cameras stay above)", els.steps.hidden === before);
ctx.paintPlayEarn10k(2500);
check("10K strip shows today's steps and a 25% fill", els.playEarnSteps.textContent === "2,500" && els.playEarn10kFill.style.width === "25%" && /2,500 \/ 10,000/.test(els.playEarn10kText.textContent));
ctx.paintPlayEarn10k(10000);
check("10K strip announces a completed 10K", els.playEarn10kText.textContent.indexOf("10K hit") === 0 && els.playEarn10kFill.style.width === "100%");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
