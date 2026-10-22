// Header nav order + page section order. Run: node test/nav-layout.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
const links = [...nav.matchAll(/<a href="(#[^"]+)">([^<]+)<\/a>/g)].map((m) => m[1]);
const NAV = ["#approach", "#washers", "#push", "#plank", "#battles-hub", "#steps", "#tokens", "#league", "#cooling-box", "#corporate", "#order", "#membership"];
check("nav order: Zabba Washers right after The Practice, others keep relative order", JSON.stringify(links) === JSON.stringify(NAV));
check("nav: Zabba Washers link immediately follows The Practice", /<a href="#approach">The Practice<\/a>\s*<a href="#washers">Zabba Washers<\/a>/.test(nav));
check("nav: TUT Battles link absent", !/href="#tutbattles"/.test(nav) && !/TUT Battles<\/a>/.test(nav));
check("TUT battles section still present with its buttons", /<section id="tutbattles">/.test(html) && /id="tbCreate"/.test(html) && /id="tbJoin"/.test(html) && /id="tbReady"/.test(html));
const sections = [...html.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);
const SECT = ["approach", "washers", "play", "board", "cooling-box", "push", "battles-hub", "tutbattles", "tut-board", "plank", "battles", "steps", "league", "tokens", "corporate", "order", "membership"];
check("section order unchanged (only Battle Gate removed, Battles hub added)", JSON.stringify(sections) === JSON.stringify(SECT));
// Battles hub: between #push (TUT set-push-up) and #tutbattles; lists every battle section; anchors exist.
{ const i = html.indexOf('<section id="battles-hub">'), hub = html.slice(i, html.indexOf("</section>", i));
  check("Battles hub sits right after #push and before #tutbattles", i > html.indexOf('<section id="push">') && sections.indexOf("battles-hub") + 1 === sections.indexOf("tutbattles") && sections.indexOf("battles-hub") - 1 === sections.indexOf("push"));
  const hrefs = [...hub.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const battleSections = sections.filter((id) => /<h2>[^<]*Battles<\/h2>/.test(html.slice(html.indexOf('<section'+(html.includes('<section id="'+id+'"')?' id="':' class="washers" id="')+id+'"'), html.indexOf("</h2>", html.indexOf('id="'+id+'"'))+5)) && id !== "battles-hub");
  check("hub lists every battle section on the page (" + battleSections.join(", ") + ")", battleSections.length >= 2 && battleSections.every((id) => hrefs.includes(id)));
  check("every hub link anchor exists", hrefs.length > 0 && hrefs.every((h) => html.includes('id="' + h + '"')));
  check("hub id unique; nav Battles points to #battles-hub", html.split('id="battles-hub"').length === 2 && html.split('id="battles"').length === 2 && /<a href="#battles-hub">Battles<\/a>/.test(nav)); }
// Battle Gate fully removed from UI; solo washers intact.
check("Battle Gate: no nav link, no section, no wb* ids, no script, no ?wb= parsing", !/battle-gate/.test(html) && !/id="wb/.test(html) && !/washers-battle\.js/.test(html) && !/parseInvite|wbInvite|wbHook|wbWake|ZabbaWashersBattle/.test(html) && !/Battle Gate/.test(html));
check("Battle Gate module file deleted", !fs.existsSync(path.join(__dirname, "..", "washers-battle.js")));
check("solo washers intact: Start game, finishGame, gameWake, pocket lock", /id="startBtn" type="button">Start game</.test(html) && /async function finishGame\(/.test(html) && /const gameWake = makeWake\(/.test(html) && /function setPocket\(/.test(html));
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);

{ const fs=require('fs'),path=require('path'),assert=require('assert');
  const h=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const nav=h.slice(h.indexOf('<nav'),h.indexOf('</nav>'));
  assert(nav.includes('<a href="#battles-hub">Battles</a>'),'nav Battles points to hub');
  assert(!nav.includes('href="#battles"'),'nav no longer jumps to plank battles');
  console.log('PASS nav Battles link -> #battles-hub'); }
