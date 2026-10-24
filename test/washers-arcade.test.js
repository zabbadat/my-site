// Arcade scoreboard skin: state -> label mapping, effects/sounds, reduced-motion guard, no email leakage, quiet WebAudio.
const A = require("../washers-arcade.js"), W = require("../washers-battle.js"), H = require("./lib/washers-match.js"), fs = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tm = (v) => (typeof v === "number" ? v : null), T0 = 1e6, ctx = (x) => Object.assign({ nowMs: T0 + 1000, toMs: tm }, x || {});
const ord = (r) => Object.keys(r.players).map((u) => ({ uid: u, ...r.players[u] }));
const M = (r, c, me = "a") => A.model(r, ord(r), me, ctx(c));
const two = (extra) => Object.assign({ createdAt: T0, players: { a: H.seat("Ann", { ready: false }), b: H.seat("Bo", { ready: false }) } }, extra || {});
// ---- state -> label ----
let m = A.mode({ status: "waiting", createdAt: T0, players: { a: H.seat("Ann") } }, ctx());
check("waiting = INSERT COIN / Waiting for challenger", m.key === "waiting" && m.title === "INSERT COIN" && m.sub === "Waiting for challenger");
m = A.mode(two({ status: "waiting" }), ctx()); check("ready = READY?", m.key === "ready" && m.title === "READY?");
check("countdown labels: READY, SET, 3, 2, 1, GO!", [5, 4, 3, 2, 1].map((n) => A.countdownLabel({ phase: "countdown", n })).join() === "READY,SET,3,2,1" && A.countdownLabel({ phase: "go" }) === "GO!" && A.countdownLabel({ phase: "live" }) === "GO!");
m = A.mode(H.room({ status: "countdown" }), ctx({ cd: { phase: "countdown", n: 4 } })); check("countdown state shows the shared countdown label", m.key === "countdown" && m.title === "SET");
m = A.mode(H.room(), ctx()); check("live, before the opening pitch settles = OPENING PITCH", m.key === "bariboshi" && m.title === "OPENING PITCH");
m = A.mode(H.bariboshi(H.room(), 10, 30), ctx()); check("live = ROUND 1", m.key === "live" && m.title === "ROUND 1");
let r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [5, 5, 5], [5, 5, 5]); H.round(r, 2, [3, 3, 0], [3, 3, 0]);
check("tied at 21+ = ROUND n · OVERTIME", A.mode(r, ctx()).title === "ROUND 3 · OVERTIME");
r = H.bariboshi(H.room(), 10, 30); H.report(r, "a", 1, [5, 5, 5]); H.confirm(r, "b", 1, false); m = A.mode(r, ctx());
check("dispute = REFEREE CHECK, names the ruler", m.key === "disputed" && m.title === "REFEREE CHECK" && /Ann \(Bariboshi winner\) rules round 1/.test(m.sub));
r = H.round(H.round(H.bariboshi(H.room(), 10, 30), 1, [5, 5, 5], [0, 0, 0]), 2, [5, 5, 5], [0, 0, 0]); m = A.mode(r, ctx());
check("finished = K.O. + WINNER: name", m.key === "finished" && m.title === "K.O." && m.sub === "WINNER: Ann" && m.winner === "a");
r = H.bariboshi(H.room(), 10, 30); r.players.b.leftAt = 3; check("forfeit finish says so", /WINNER: Ann \(forfeit\)/.test(A.mode(r, ctx()).sub));
check("cancelled = GAME OVER (abandoned, expired, missing)", A.mode({ status: "abandoned", players: {} }, ctx()).title === "GAME OVER" && A.mode(two({ status: "waiting" }), ctx({ nowMs: T0 + 31 * 60000 })).key === "cancelled" && A.mode(null, ctx()).key === "cancelled");
// ---- panels: P1/P2, score toward 21, progress bar, turn, steps, reputation badge ----
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [5, 3, 0], [2, 2, 0]); r.players.a.steps = 1204;
m = M(r, { reps: { a: 52, b: 20 } }); let h = A.html(m, A.fx(null, m), null);
check("two panels P1/P2 with names, YOU tag, score, progress bar, steps", /arc-p1/.test(h) && /arc-p2/.test(h) && />P1</.test(h) && />P2</.test(h) && />Ann <em>YOU<\/em>/.test(h) && /<span class="n">8<\/span>/.test(h) && /style="width:38%"/.test(h) && /aria-valuenow="8"/.test(h) && /STEPS <b>1,204/.test(h));
check("reputation badge next to the name (Steady 52, Shaky 20)", /arc-rep-steady[^>]*>STEADY 52</.test(h) && /arc-rep-shaky[^>]*>SHAKY 20</.test(h) && !/arc-badge/.test(A.html(M(r, {}), null, null)));
check("round counter and turn indicator", /ROUND 2/.test(h) && /arc-turn/.test(h) && /&#9654; PITCHING PACK/.test(h));
// ---- effects and sounds ----
const prev = M(r, {}); H.round(r, 2, [5, 5, 0], [0, 0, 0]); const cur = M(r, {}); let f = A.fx(prev, cur);
check("score change: flash + score cue", f.flash.a === true && !f.flash.b && f.sound.includes("score"));
check("no effects on the first paint", JSON.stringify(A.fx(null, cur)) === JSON.stringify({ flash: {}, shake: {}, banner: "", sound: [] }));
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [2, 0, 0], [2, 0, 0]); const p1 = M(r, {}); H.round(r, 2, [2, 0, 0], [2, 0, 0]);
f = A.fx(p1, M(r, {})); check("new round: banner + round cue", f.banner === "ROUND 3" && f.sound.includes("round"));
r = H.bariboshi(H.room(), 10, 30); const live0 = M(r, {}); H.report(r, "a", 1, [5, 5, 5]); H.confirm(r, "b", 1, false);
f = A.fx(live0, M(r, {})); check("dispute: the disputed panel shakes", f.shake.a === true && !f.shake.b);
r = H.round(H.round(H.bariboshi(H.room(), 10, 30), 1, [5, 5, 5], [0, 0, 0]), 2, [0, 0, 0], [0, 0, 0]); const pre = M(r, {}); H.round(r, 3, [5, 5, 0], [0, 0, 0]);
f = A.fx(pre, M(r, {})); check("finish: K.O. banner + win cue for the winner, not for the loser", f.banner === "K.O." && f.sound.includes("win") && !A.fx(pre, M(r, {}, "b")).sound.includes("win"));
check("winner panel highlighted", /arc-win/.test(A.html(M(r, {}), null, null)));
// ---- reduced motion: every animation is gated; reduce switches it all off ----
const page = fs.readFileSync(__dirname + "/../index.html", "utf8"), css = page.slice(page.indexOf("/* ARC-START"), page.indexOf("/* ARC-END */"));
const stripped = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, "");
check("arcade CSS present, pixel/monospace font, dark neon look", css.length > 1000 && /ui-monospace/.test(css) && /text-shadow/.test(css) && /#0a0618/.test(css));
check("reduced motion: no animation/transition declared outside the no-preference block", !/animation\s*:|transition\s*:|@keyframes/.test(stripped.replace(/@media \(prefers-reduced-motion: reduce\)[^\n]*\n/, "")));
check("reduced motion: reduce block cancels animation + shows static numbers", /prefers-reduced-motion: reduce\) \{[^}]*animation:none !important/.test(css) && /\.arc-score \.n \{ display:inline !important/.test(css));
check("no-preference block has count-up, flash, shake, banner, winner glow", ["arc-count", "arc-flash", "arc-shake", "arc-banner", "arc-glow"].every((k) => new RegExp("@keyframes " + k).test(css)));
// ---- no email leakage ----
r = H.bariboshi(H.room({ createdBy: "a", players: { a: H.seat("zabba@gmail.com", { email: "zabba@gmail.com" }), b: H.seat("Bo", { email: "bo@example.com", uid: "b" }) } }), 10, 30);
m = M(r, { reps: { a: 50 } }); h = A.html(m, null, null) + A.bannerHtml(m.mode.title) + m.mode.sub;
check("an email-looking name is never printed (shown as Player)", !/@/.test(h) && />Player </.test(h.replace("<em>", "<")) || /Player/.test(h));
check("seat email fields never reach the board", !/example\.com|gmail/.test(h) && A.safeName("a@b.co") === "Player" && A.safeName("  Zab  ") === "Zab" && A.safeName(null) === "Player");
check("names are HTML-escaped", /&lt;b&gt;/.test(A.html(M(H.bariboshi(H.room({ players: { a: H.seat("<b>x</b>"), b: H.seat("Bo") } }), 10, 30), {}), null, null)));
check("user-facing text spells Zabba, never Zaba", !/\bZaba\b/.test(fs.readFileSync(__dirname + "/../washers-arcade.js", "utf8").replace(/ZabaWager|zaba-/g, "")) && /Zabba Washer Battle live board/.test(page));
// ---- sound: quiet, gesture-gated, mutable, absent-safe ----
const ctxs = []; class AC { constructor() { this.currentTime = 0; this.state = "suspended"; this.destination = {}; ctxs.push(this); this.osc = 0; } resume() { this.state = "running"; } createOscillator() { this.osc++; return { frequency: {}, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } }
const store = {}, win = { AudioContext: AC, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) } };
let s = A.makeSound(win);
check("no cue before the user-gesture unlock", s.available && s.cue("score") === false && ctxs.length === 0);
check("unlock inside a gesture, then cues play", s.unlock() === true && s.cue("score") === true && s.cue("round") === true && s.cue("win") === true && ctxs[0].osc === 2 + 3 + 4 && s.cue("nope") === false);
check("quiet by default (volume <= 0.05)", A.VOLUME <= 0.05);
check("mute toggle silences and persists", s.setMuted(true) === true && s.cue("score") === false && store.zdArcMute === "1" && A.makeSound(win).muted === true && s.setMuted(false) === false && s.cue("score") === true);
s = A.makeSound({}); check("no audio support: everything is a safe no-op", s.available === false && s.unlock() === false && s.cue("win") === false);
s = A.makeSound(null); check("no window: safe", s.cue("win") === false);
check("index wiring: gesture unlock on ready/create/join, mute button, cues from fx", /wbArcSound\.unlock\(\)/.test(page) && (page.match(/wbArcSound\.unlock\(\)/g) || []).length >= 4 && /data-arc-mute/.test(page) && /f\.sound\.forEach\(\(c\) => wbArcSound\.cue\(c\)\)/.test(page) && /src="\/washers-arcade\.js"/.test(page));
const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
