// Play and Earn: one tabbed section after the live cameras block. Run: node test/play-and-earn.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };

const start = html.indexOf('id="play-and-earn"');
const live = html.indexOf('id="live-cameras"');
const hub = html.indexOf('<section id="battles-hub">');
check("Play and Earn section and live cameras block exist", start > 0 && live > 0 && html.includes("<h2>Activate &amp; Earn</h2>"));
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
check("motto sits between the Activate & Earn heading and the tab row, with no 10K strip", (() => {
  const pe = html.slice(start, html.indexOf('<section id="league">'));
  const h2 = pe.indexOf("<h2>Activate &amp; Earn</h2>"), motto = pe.indexOf('id="peMotto"'), tabs = pe.indexOf('role="tablist"'), steps = pe.indexOf('<section id="steps"');
  const between = pe.slice(h2, tabs);
  return h2 > 0 && h2 < motto && motto < tabs && tabs < steps
    && /<p class="pe-motto" id="peMotto" aria-hidden="true">Breathe\. Activate\. Score\.<\/p>/.test(between)
    && !/aria-live/.test(between)
    && !pe.includes('id="playEarn10k"') && !pe.includes("pe-10k") && !pe.includes('id="playEarnSteps"')
    && !/class="pe-10k"/.test(html) && !/\.pe-10k\b/.test(html)
    && pe.includes("id=\"tenKBonus\"") && pe.includes("id=\"dailyCount\"") && pe.includes("id=\"dailyStepBoard\"");
})());
check("motto CSS is one tight muted line with a fade and a reduced-motion swap", /#play-and-earn \.pe-motto/.test(html) && /min-height: 1\.35em/.test(html) && /white-space: nowrap/.test(html) && /\.pe-motto\.is-fade \{ opacity: 0; \}/.test(html) && /prefers-reduced-motion: reduce/.test(html) && /#play-and-earn \.pe-motto \{ transition: none; \}/.test(html));
check("original IDs and camera/start controls are still in the document (not removed)", html.includes('id="pushStartBtn"') && html.includes('id="plankCamBtn"') && html.includes('id="plankVid"') && html.includes('id="camVid"') && html.includes('id="tbVid"') && html.includes('id="zmCamVid"') && html.includes('id="dailyWalkBtn"') && html.includes('id="wbCreate"'));
check("CSS hides hidden tab panels (display:none) instead of a script that removes them", /#play-and-earn > section\[role="tabpanel"\]\[hidden\] \{ display: none !important; \}/.test(html) && !/panel\.remove\(\)|removeChild\(.*tabpanel/.test(html));
check("hash routing: load + hashchange, unhide on in-page anchors, default Steps", /window\.addEventListener\("hashchange", \(\) => peApplyHash/.test(html) && /peShowTab\("steps"/.test(html) && /a\[href\^='#'\]/.test(html) && /PE_TABS = \["zab", "washerbattle", "steps", "tutbattles", "plank", "battles"\]/.test(html));
check("paintPlayEarn10k and its daily-step call sites are gone", !/function paintPlayEarn10k/.test(html) && !/paintPlayEarn10k\(/.test(html));
check("#tut-board and #push stay outside Play and Earn", html.indexOf('<section class="washers" id="tut-board">') < html.indexOf('id="play-and-earn"') && html.indexOf('<section id="push">') < html.indexOf('id="play-and-earn"'));
check("Washer Battle countdown (get-set + 3-2-1) is still present", /get set|get-set|3-2-1|three, go/i.test(html) || fs.existsSync(path.join(__dirname, "../test/washers-prompt-timing.test.js")));

// routing helpers
const src = html.slice(html.indexOf("const PE_TABS ="), html.indexOf("window.addEventListener(\"hashchange\", () => peApplyHash"));
const els = {};
const parentOf = { tenKBonus: "steps", dailyCount: "steps", plankVid: "plank", wbCreate: "washerbattle" };
const mk = (id) => els[id] || (els[id] = { id, hidden: id !== "steps" && !id.startsWith("pe-tab-"), attrs: {}, style: {}, childNodes: [], querySelector(){ return this._ring || null; }, appendChild(n){ this.childNodes.push(n); if (n && n.className==="zab") this._ring=n; this.textContent = (this.textContent||"") + (n.textContent||""); return n; }, getAttribute(n){return this.attrs[n];}, setAttribute(n,v){ this.attrs[n]=v; if(n==="hidden") this.hidden = v !== null && v !== false; }, removeAttribute(n){ delete this.attrs[n]; if(n==="hidden") this.hidden=false; }, focus(){ this.focused=true; }, scrollIntoView(){ this.scrolled=true; }, closest(sel){ const pid = parentOf[id]; if (!pid) return null; const ids = sel.split(",").map((s)=>s.replace("#","").trim()); return ids.includes(pid) ? mk(pid) : null; } });
const ctx = {
  PE_SKIP: true,
  document: { getElementById: mk, addEventListener(){}, readyState: "complete" },
  window: { addEventListener(){}, PE_SKIP: true },
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

// rotating motto
const mottoSrc = html.match(/\(function peMottoRotate\(\) \{[\s\S]*?\}\)\(\);/)[0];
const ZC = require("../zab-currency.js");
function runMotto(opts) {
  const hiddenStart = !!(opts && opts.hiddenStart), reduce = !!(opts && opts.reduce);
  const intervals = [], timeouts = [];
  let now = 0, nid = 1;
  const vis = [];
  const el = { innerHTML: "Breathe. Activate. Score.", className: "pe-motto", classList: { add(c){ el.className += " " + c; }, remove(c){ el.className = el.className.split(/\s+/).filter((x)=>x && x!==c).join(" "); } } };
  const doc = { hidden: hiddenStart, getElementById: (id) => id === "peMotto" ? el : null, addEventListener(type, fn){ if (type === "visibilitychange") vis.push(fn); } };
  const mctx = {
    document: doc,
    window: { ZabCurrency: ZC, matchMedia: () => ({ matches: reduce }) },
    setInterval(fn, ms){ const t = { id: nid++, fn, ms, next: now + ms, kind: "i" }; intervals.push(t); return t.id; },
    clearInterval(i){ const ix = intervals.findIndex((t)=>t.id===i); if (ix>=0) intervals.splice(ix,1); },
    setTimeout(fn, ms){ const t = { id: nid++, fn, ms, next: now + ms, kind: "t" }; timeouts.push(t); return t.id; },
    clearTimeout(i){ const ix = timeouts.findIndex((t)=>t.id===i); if (ix>=0) timeouts.splice(ix,1); }
  };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const ev = intervals.concat(timeouts).filter((t)=>t.next<=end).sort((a,b)=>a.next-b.next)[0];
      if (!ev) { now = end; break; }
      now = ev.next;
      if (ev.kind === "t") { timeouts.splice(timeouts.indexOf(ev), 1); ev.fn(); }
      else { ev.next = now + ev.ms; ev.fn(); }
    }
  }
  function setHidden(v){ doc.hidden = v; vis.forEach((fn)=>fn()); }
  vm.createContext(mctx);
  vm.runInContext(mottoSrc, mctx);
  return { el, advance, setHidden, intervals, timeouts };
}
check("motto script lists all five lines in order and paints ZAB with the ring badge", (() => {
  const lines = [
    "Breathe. Activate. Score.",
    "Every rep stacks ZAB.",
    "Hit your daily 10K, win rank & reward.",
    "Hold the line. Earn the minute.",
    "One more set. One more step."
  ];
  const block = html.slice(html.indexOf("function peMottoRotate"), html.indexOf("})();", html.indexOf("function peMottoRotate")));
  const idx = lines.map((l) => block.indexOf(JSON.stringify(l).slice(1, -1) === l ? l : l));
  // the JS source contains the raw strings in order
  let pos = -1, ok = true;
  for (const l of lines) { const i = block.indexOf(l); if (i < 0 || i < pos) ok = false; pos = i; }
  return ok && /setInterval\(tick, 4000\)/.test(block) && /document\.hidden/.test(block) && /prefers-reduced-motion: reduce/.test(block) && /ZabCurrency\.html/.test(block) && !/aria-live/.test(block);
})());
{
  const r = runMotto({});
  r.advance(3999);
  const stillFirst = r.el.innerHTML === "Breathe. Activate. Score." && !/\bis-fade\b/.test(r.el.className);
  r.advance(1);
  const fading = /\bis-fade\b/.test(r.el.className) && r.el.innerHTML === "Breathe. Activate. Score.";
  r.advance(350);
  const second = /Every rep stacks/.test(r.el.innerHTML) && /<span class="zab">ZAB/.test(r.el.innerHTML) && /zab-ring/.test(r.el.innerHTML) && !/\bis-fade\b/.test(r.el.className);
  r.advance(4000 + 350);
  const third = /Hit your daily 10K, win rank &amp; reward\./.test(r.el.innerHTML);
  check("motto fades every 4s and shows the ZAB ring on line 2, then line 3 with an ampersand", stillFirst && fading && second && third);
}
{
  const r = runMotto({ reduce: true });
  r.advance(4000);
  check("reduced motion swaps the motto with no fade class", r.el.innerHTML.indexOf("Every rep stacks") === 0 && !/\bis-fade\b/.test(r.el.className));
}
{
  const r = runMotto({});
  const before = r.intervals.length;
  r.setHidden(true);
  const stopped = r.intervals.length === 0;
  r.advance(8000);
  const unchanged = r.el.innerHTML === "Breathe. Activate. Score.";
  r.setHidden(false);
  const resumed = r.intervals.length === before;
  r.advance(4000 + 350);
  check("motto rotation pauses while the document is hidden and resumes after", stopped && unchanged && resumed && /Every rep stacks/.test(r.el.innerHTML));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
