// Mini dashboard addition: glance totals in the 10K step tile, full dashboard stays low.
// Run: node test/mini-dashboard.test.js
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };

const navStart = html.indexOf("<nav>"), navEnd = html.indexOf("</nav>");
const strip = html.indexOf('id="playEarn10k"');
const home = html.indexOf('class="home-art"');
const pe = html.indexOf('id="play-and-earn"');
const steps = html.search(/<section id="steps"[^>]*>/);
const stepsEnd = html.indexOf("</section>", steps);
const sec = html.slice(steps, stepsEnd);
const dash = sec.indexOf('id="userDash"');
const daily = sec.indexOf('>Daily Earn Steps Board</h3>');
const live = sec.indexOf('>Live walk sessions</h3>');

check("full dashboard stays inside the Steps tab, in its original lower position (after Daily Earn, before Live walk)",
  dash > 0 && daily > 0 && live > 0 && daily < dash && dash < live);
check("exactly one #userDash in the page, and it is not moved up next to the hero or the 10K tile",
  html.split('id="userDash"').length === 2 && strip > 0 && dash > 0 && html.indexOf('id="userDash"') > home && html.indexOf('id="userDash"') > pe);
check("mini dashboard sits in the 10K step tile, after the nav and before the home-art ZD mark, not in the nav and not in Activate & Earn",
  strip > navEnd && strip < home && home < pe
  && html.slice(navStart, navEnd).indexOf("miniDash") < 0
  && html.slice(navStart, navEnd).indexOf("goToDash") < 0
  && html.slice(pe, html.indexOf('<section id="league">')).indexOf('id="miniDash"') < 0
  && html.slice(strip, home).indexOf('id="miniDash"') > 0);
check("Go to dashboard button lives on the mini tile and targets #userDash",
  /id="goToDash"[^>]*href="#userDash"/.test(html.slice(strip, home))
  && /Go to dashboard/.test(html.slice(strip, home)));
check("mini shows ZAB bag and TUT sets only (no second Steps today readout)",
  /id="miniDashZab"/.test(html.slice(strip, home))
  && /ZAB bag/.test(html.slice(strip, home))
  && /id="miniDashTut"/.test(html.slice(strip, home))
  && /TUT sets/.test(html.slice(strip, home))
  && html.slice(html.indexOf('id="miniDash"'), home).indexOf("Steps today") < 0);
check("signed-out nudge is present and does not add a second Google or X sign-in button",
  /id="miniDashNudge">Sign in to track your totals</.test(html)
  && html.slice(strip, home).indexOf("signInBtn") < 0
  && html.slice(strip, home).indexOf("signInXBtn") < 0
  && html.slice(strip, home).indexOf("startPhoneGoogle") < 0);
check("#signInBtn, #signInXBtn, and startPhoneGoogle are unchanged on the page",
  html.includes('id="signInBtn"') && html.includes('id="signInXBtn"') && /function startPhoneGoogle|startPhoneGoogle\(/.test(html));
check("10K tile and mini are not fixed or sticky, so they cannot cover the traveling wordmark",
  !/#playEarn10k[^}]*position:\s*(fixed|sticky)/.test(html)
  && !/\.pe-mini[^{]*\{[^}]*position:\s*(fixed|sticky)/.test(html)
  && /var\(--navh/.test((html.match(/#playEarn10k\.pe-10k\{[^}]+\}/) || [""])[0]));
check("full dashboard is a focus target with sticky-header scroll margin",
  /id="userDash"[^>]*tabindex="-1"/.test(html)
  && /#userDash \{[^}]*scroll-margin-top:\s*calc\(var\(--navh/.test(html));
check("goToUserDash glides with a nav offset and jumps instantly when reduced motion is on",
  /function goToUserDash\(/.test(html)
  && /behavior:\s*reduceMotionOn\(\) \? "auto" : "smooth"/.test(html)
  && /prefers-reduced-motion:\s*reduce/.test(html)
  && /scroll-behavior:\s*auto/.test(html)
  && /getPropertyValue\("--navh"\)/.test(html.slice(html.indexOf("function goToUserDash"), html.indexOf("function peHashName"))));
check("existing 10K strip still links to #steps and keeps Steps today",
  /class="pe-10k-main" href="#steps"/.test(html.slice(strip, home))
  && /id="playEarnSteps"/.test(html.slice(strip, home))
  && /Steps today/.test(html.slice(strip, home)));
check("nav wordmark and home-art ZD mark are still present",
  /<a class="logo" href="\/"[\s\S]*?Zabbadat/.test(html.slice(navStart, navEnd))
  && /class="home-art"[\s\S]*?zd-v2-mark\.svg[\s\S]*?class="word">Zabbadat</.test(html.slice(home, home + 600)));
check("tuck fade hides the mini tile as it meets the fixed nav, so it never paints over the wordmark",
  /function tuckMiniDash|tuckMiniDash\(/.test(html)
  && /#playEarn10k\.pe-10k\.is-tucked\{[^}]*visibility:\s*hidden/.test(html)
  && /#playEarn10k\.pe-10k\{transition:opacity/.test(html));

// routing: #userDash opens the Steps tab
const fns = html.match(/function paintPlayEarn10k\(steps\) \{[\s\S]*const PE_TABS = \[[\s\S]*?function peApplyHash\(opts\) \{[\s\S]*?\n\}/);
check("paint / routing helpers still extract cleanly", !!fns);
if (fns) {
  const els = {};
  const parentOf = { tenKBonus: "steps", playEarn10k: "play-and-earn", dailyCount: "steps", userDash: "steps", goToDash: "play-and-earn", miniDash: "play-and-earn" };
  const mk = (id) => els[id] || (els[id] = { id, hidden: id !== "steps" && !id.startsWith("pe-tab-") && id !== "playEarnSteps" && id !== "playEarn10kFill" && id !== "playEarn10kLabel", attrs: {}, style: {}, childNodes: [], classList: { toggle(){}, add(){}, remove(){} }, getBoundingClientRect(){ return { top: 800, height: 40, bottom: 840 }; }, focus(){ this.focused = true; }, hasAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n); }, getAttribute(n){ return this.attrs[n]; }, setAttribute(n,v){ this.attrs[n]=v; if(n==="hidden") this.hidden = v !== null && v !== false; }, removeAttribute(n){ delete this.attrs[n]; if(n==="hidden") this.hidden=false; }, closest(sel){ const pid = parentOf[id]; if (!pid) return null; const ids = sel.split(",").map((s)=>s.replace("#","").trim()); return ids.includes(pid) ? mk(pid) : null; } });
  const scrolls = [];
  const ctx = {
    PE_SKIP: true,
    document: { getElementById: mk, querySelector(){ return mk("nav"); }, documentElement: {}, addEventListener(){}, readyState: "complete" },
    window: { addEventListener(){}, removeEventListener(){}, PE_SKIP: true, scrollY: 0, scrollTo(opts){ scrolls.push(opts); }, matchMedia: () => ({ matches: false }) },
    location: { hash: "" },
    history: { replaceState(a,b,url){ ctx.location.hash = String(url).replace(/^[^#]*#/, "#"); } },
    getComputedStyle(){ return { getPropertyValue(){ return "72px"; } } },
    setTimeout(){ return 1; }, clearTimeout(){}, setInterval(){ return 1; }, clearInterval(){},
    $: mk
  };
  vm.createContext(ctx);
  vm.runInContext(fns[0], ctx);
  ctx.location.hash = "#userDash";
  ctx.peApplyHash({ scroll: true });
  check("#userDash hash opens the Steps tab, scrolls to the full dashboard, and focuses it",
    els.steps && els.steps.hidden === false
    && els["pe-tab-steps"] && els["pe-tab-steps"].getAttribute("aria-selected") === "true"
    && scrolls.length > 0 && scrolls[0].behavior === "smooth"
    && ctx.location.hash === "#userDash");
  scrolls.length = 0;
  ctx.window.matchMedia = () => ({ matches: true });
  ctx.goToUserDash();
  check("reduced motion makes Go to dashboard an instant jump",
    scrolls.length > 0 && scrolls[0].behavior === "auto");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
