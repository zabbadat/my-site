// Header nav order + page section order. Run: node test/nav-layout.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
const links = [...nav.matchAll(/<a href="(#[^"]+)">(.+?)<\/a>/g)].map((m) => m[1]);
const NAV = ["#approach", "#washers", "#push", "#plank", "#steps", "#battles-hub", "#zab", "#league", "#cooling-box", "#corporate", "#order", "#membership"];
check("nav order: Zabba Washers right after The Practice, Step Equity before Battles, others keep relative order", JSON.stringify(links) === JSON.stringify(NAV));
check("nav: Zabba Washers link immediately follows The Practice", /<a href="#approach">The Practice<\/a>\s*<a href="#washers">Zabba Washers<\/a>/.test(nav));
check("nav: TUT Battles link absent", !/href="#tutbattles"/.test(nav) && !/TUT Battles<\/a>/.test(nav));
check("TUT battles section still present with its buttons", /<section id="tutbattles">/.test(html) && /id="tbCreate"/.test(html) && /id="tbJoin"/.test(html) && /id="tbReady"/.test(html));
const sections = [...html.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);
const SECT = ["approach", "washers", "play", "board", "cooling-box", "push", "battles-hub", "zab", "washerbattle", "tutbattles", "tut-board", "plank", "battles", "steps", "league", "corporate", "order", "membership"];
check("section order: ZAB, then Washer Battle, then TUT Battles (+ TUT board), then Plank; matches the hub card order", JSON.stringify(sections) === JSON.stringify(SECT));
// Battles hub: between #push (TUT set-push-up) and #tutbattles; lists every battle section; anchors exist.
{ const i = html.indexOf('<section id="battles-hub">'), hub = html.slice(i, html.indexOf("</section>", i));
  check("Battles hub sits right after #push, then ZAB, then #washerbattle, then #tutbattles", i > html.indexOf('<section id="push">') && sections.indexOf("battles-hub") + 2 === sections.indexOf("washerbattle") && sections.indexOf("washerbattle") + 1 === sections.indexOf("tutbattles") && sections.indexOf("tutbattles") + 1 === sections.indexOf("tut-board") && sections.indexOf("tut-board") + 1 === sections.indexOf("plank") && sections.indexOf("battles-hub") + 1 === sections.indexOf("zab") && sections.indexOf("battles-hub") - 1 === sections.indexOf("push"));
  const hrefs = [...hub.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const battleSections = sections.filter((id) => /<h2>[^<]*Battles<\/h2>/.test(html.slice(html.indexOf('<section'+(html.includes('<section id="'+id+'"')?' id="':' class="washers" id="')+id+'"'), html.indexOf("</h2>", html.indexOf('id="'+id+'"'))+5)) && id !== "battles-hub");
  check("hub lists every battle section on the page (" + battleSections.join(", ") + ")", battleSections.length >= 2 && battleSections.every((id) => hrefs.includes(id)));
  check("every hub link anchor exists", hrefs.length > 0 && hrefs.every((h) => html.includes('id="' + h + '"')));
  check("hub id unique; nav Battles points to #battles-hub", html.split('id="battles-hub"').length === 2 && html.split('id="battles"').length === 2 && /<a href="#battles-hub">Battles<\/a>/.test(nav)); }
// Old Battle Gate (invite links) stays removed; the new Zabba Washer Battle room section replaces it (no nav link).
check("Battle Gate remnants absent: no battle-gate, no ?wb= invite parsing, no Battle Gate text", !/battle-gate/.test(html) && !/parseInvite|wbInvite|wbWake|ZabbaWashersBattle/.test(html) && !/Battle Gate/.test(html));
check("Zabba Washer Battle section present (no nav link), module file present", /<section id="washerbattle">/.test(html) && !/href="#washerbattle">/.test(nav) && fs.existsSync(path.join(__dirname, "..", "washers-battle.js")));
check("solo washers intact: Start game, finishGame, gameWake, pocket lock", /id="startBtn" type="button">Start game</.test(html) && /async function finishGame\(/.test(html) && /const gameWake = makeWake\(/.test(html) && /function setPocket\(/.test(html));
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);

{ const fs=require('fs'),path=require('path'),assert=require('assert');
  const h=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const nav=h.slice(h.indexOf('<nav'),h.indexOf('</nav>'));
  assert(nav.includes('<a href="#battles-hub">Battles</a>'),'nav Battles points to hub');
  assert(!nav.includes('href="#battles"'),'nav no longer jumps to plank battles');
  console.log('PASS nav Battles link -> #battles-hub'); }

{ const fs=require('fs'),path=require('path'),assert=require('assert');
  const h=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const s=h.indexOf('<section id="battles-hub"'),hub=h.slice(s,h.indexOf('</section>',s));
  assert(/<a class="card" href="#washerbattle"[^>]*><h3>Zabba Washer Battle<\/h3>/.test(hub),'hub has Zabba Washer Battle card -> #washerbattle');
  assert(h.includes('<section id="washerbattle">'),'#washerbattle target exists');
  assert(hub.indexOf('Zabba Washer Battle')<hub.indexOf('TUT Battles') && hub.indexOf('TUT Battles')<hub.indexOf('Plank Battles'),'Washer Battle card first, above TUT Battles, then Plank Battles');
  console.log('PASS hub Zabba Washer Battle card'); }

// ZAB section sits between Battles hub and the first battle section (Washer Battle, then TUT Battles)
{const h=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const hub=h.indexOf('<section id="battles-hub">'),tk=h.indexOf('<section id="zab">'),tut=h.indexOf('<section id="washerbattle">'),tut2=h.indexOf('<section id="tutbattles">'),plank=h.indexOf('<section id="plank">');
if(!(hub>-1&&hub<tk&&tk<tut&&tut<tut2&&tut2<plank)){console.log('FAIL ZAB, then Washer Battle, then TUT Battles, then Plank');process.exitCode=1}else console.log('PASS ZAB, then Washer Battle, then TUT Battles, then Plank');
if(h.split('<section id="zab">').length!==2){console.log('FAIL ZAB section appears once');process.exitCode=1}else console.log('PASS ZAB section appears once');}
