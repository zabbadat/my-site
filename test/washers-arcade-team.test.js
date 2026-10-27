// Arcade scoreboard for the 2v2 team match: team panels, big team totals, per-player contributions, team names, effects, reduced motion.
const A = require("../washers-arcade.js"), AR = require("../washers-arena.js"), H = require("./lib/arena-match.js"), fs = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tm = (v) => (typeof v === "number" ? v : null), ctx = (x) => Object.assign({ nowMs: 2000, toMs: tm }, x || {});
const M = (a, me = "a1", c) => A.teamModel(a, me, ctx(c));
// ---- state -> label ----
let a = { size: 4, status: "waiting", createdAt: 0, slots: {}, seats: {}, teamNames: {} }; a.seats.a1 = H.seat("Ann", 0, 4, { ready: false });
let m = A.teamMode(a, ctx());
check("one seated: INSERT COIN, waiting for 3 more players", m.key === "waiting" && m.title === "INSERT COIN" && m.sub === "Waiting for 3 more players");
a.seats.a2 = H.seat("Bo", 1, 4, { ready: false }); a.seats.b1 = H.seat("Cy", 2, 4, { ready: false }); check("two more: still waiting; singular wording at one left", A.teamMode(a, ctx()).sub === "Waiting for 1 more player");
a = H.arena({ status: "waiting" }); Object.values(a.seats).forEach((s) => { s.ready = false; });
check("all seated, not ready: READY? tap ready", A.teamMode(a, ctx()).key === "ready" && /Everyone taps/.test(A.teamMode(a, ctx()).sub));
a = H.arena({ status: "waiting" }); check("all ready: All ready", A.teamMode(a, ctx()).sub === "All ready");
check("countdown shows the shared countdown label", A.teamMode(H.arena({ status: "countdown" }), ctx({ cd: { phase: "countdown", n: 4 } })).title === "SET");
check("live before the opening settles = OPENING PITCH; after = ROUND 1", A.teamMode(H.arena(), ctx()).key === "bariboshi" && A.teamMode(H.bariboshi(H.arena(), [10, 40, 30, 50]), ctx()).title === "ROUND 1");
let r = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.report(r, "a1", 1, [5, 5, 5]); H.confirm(r, "b1", 1, "a1", false);
check("dispute = REFEREE CHECK naming the ruler", A.teamMode(r, ctx()).key === "disputed" && /Ann \(Bariboshi winner\) rules round 1/.test(A.teamMode(r, ctx()).sub));
r = H.bariboshi(H.arena({ teamNames: { a: "Team Rocket" } }), [10, 40, 30, 50]); H.round(r, 1, [[5, 5, 5], [5, 5, 5], [0, 0, 0], [0, 0, 0]]);
check("finished = K.O. + WINNER: the team name (not the player)", A.teamMode(r, ctx()).key === "finished" && A.teamMode(r, ctx()).title === "K.O." && A.teamMode(r, ctx()).sub === "WINNER: Team Rocket" && A.teamMode(r, ctx()).winner === "a");
r = H.bariboshi(H.arena(), [10, 40, 30, 50]); r.seats.b1.leftAt = 2; r.seats.b2.leftAt = 2; check("forfeit finish says so", /WINNER: Team A \(forfeit\)/.test(A.teamMode(r, ctx()).sub));
r = H.arena({ status: "live" }); ["a1", "a2", "b1", "b2"].forEach((u) => { r.seats[u].leftAt = 1; }); H.bariboshi(r, [1, 2, 3, 4]);
check("cancelled / abandoned = GAME OVER", A.teamMode(H.arena({ status: "abandoned" }), ctx()).title === "GAME OVER" && A.teamMode(null, ctx()).key === "cancelled");
// ---- model: team panels with contributions ----
r = H.bariboshi(H.arena({ teamNames: { b: "Wolves" } }), [10, 40, 30, 50]); H.round(r, 1, [[5, 3, 0], [2, 2, 0], [3, 0, 0], [0, 0, 0]]); r.seats.a1.steps = 1204;
m = M(r, "a2"); let h = A.html(m, A.fx(null, m), null);
check("model: two team rows (uid = team key), me = my team key, kind team", m.kind === "team" && m.rows.length === 2 && m.rows[0].uid === "a" && m.rows[1].uid === "b" && m.me === "a" && m.rows[0].you && !m.rows[1].you);
check("team totals are the sums of confirmed packs and bars show progress toward 21", m.rows[0].total === 12 && m.rows[1].total === 3 && m.rows[0].pct === 57 && m.rows[1].pct === 14);
check("each player's contribution beneath the total, with YOU on mine", m.rows[0].players.map((p) => p.contrib).join() === "8,4" && m.rows[1].players.map((p) => p.contrib).join() === "3,0" && m.rows[0].players[1].you && !m.rows[0].players[0].you);
check("team names replace Team A / Team B on the board; defaults otherwise", m.rows[1].name === "Wolves" && m.rows[0].name === "Team A" && />Wolves</.test(h) && />Team A /.test(h));
check("html: two team panels with big totals /21, player lines, contributions, YOUR TEAM tag", /arc-team arc-p1/.test(h) && /arc-team arc-p2/.test(h) && /<span class="n">12<\/span>/.test(h) && /<span class="n">3<\/span>/.test(h) && /\/21/.test(h) && /<ul class="arc-members">/.test(h) && /<li class=""><span class="arc-mname">Ann<\/span><b>8<\/b>/.test(h) && /YOUR TEAM/.test(h) && />ROUND 2</.test(h));
check("per-player status: reported / to pitch while a round is open; out players marked", /TO PITCH/.test(h) && (() => { const x = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.report(x, "a1", 1, [5, 5, 5]); x.seats.b2.leftAt = 5; const mm = M(x); return mm.rows[0].players[0].status === "REPORTED" && mm.rows[1].players[1].status === "LEFT" && mm.rows[1].players[1].out && !mm.rows[1].out; })());
check("a team with every player out shows FORFEIT", (() => { const x = H.bariboshi(H.arena(), [10, 40, 30, 50]); x.seats.b1.leftAt = 5; x.seats.b2.result = { forfeit: true }; return M(x).rows[1].status === "FORFEIT" && M(x).rows[1].out; })());
check("lobby statuses: READY / NOT READY per player", (() => { const x = H.arena({ status: "waiting" }); x.seats.a2.ready = false; const mm = M(x); return mm.rows[0].players[0].status === "READY" && mm.rows[0].players[1].status === "NOT READY"; })());
// ---- safety: names only, escaped ----
r = H.bariboshi(H.arena({ teamNames: { a: "<img src=x onerror=alert(1)>" } }), [10, 40, 30, 50]); r.seats.a1.name = "zed@mail.com"; r.seats.a2.pubName = "<b>Bo</b>";
h = A.html(M(r), null, null);
check("no email, no raw HTML from names or team names reaches the scoreboard", !/zed@mail/.test(h) && !/<img/.test(h) && !/<b>Bo<\/b>/.test(h) && /&lt;b&gt;Bo&lt;\/b&gt;/.test(h) && /Player/.test(h));
check("saved pubName is shown instead of the seat name", (() => { const x = H.arena(); x.seats.a1.pubName = "Annie"; return A.html(M(x), null, null).includes(">Annie") && !A.html(M(x), null, null).includes(">Ann<"); })());
// ---- effects (reuse fx): flash on a team score, banner on a new round, win sound for my team ----
const m1 = M(H.bariboshi(H.arena(), [10, 40, 30, 50])), x2 = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.round(x2, 1, [[5, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]); const m2 = M(x2), f = A.fx(m1, m2);
check("effects: nothing on first paint; team flash + score sound when a team scores; round banner", Object.keys(A.fx(null, m2).flash).length === 0 && f.flash.a === true && f.sound.indexOf("score") >= 0 && f.banner === "ROUND 2");
const xw = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.round(xw, 1, [[5, 5, 5], [5, 5, 5], [0, 0, 0], [0, 0, 0]]); const fw = A.fx(m2, M(xw, "a1"));
check("effects: K.O. banner, win sound for the winning team's own player; none for the other team", fw.banner === "K.O." && fw.sound.indexOf("win") >= 0 && A.fx(m2, M(xw, "b1")).sound.indexOf("win") < 0);
check("model is pure: same doc, same output", JSON.stringify(M(r)) === JSON.stringify(M(r)));
// ---- page css: team layout is static; every animation stays in the no-preference block / switched off by reduced motion ----
const html = fs.readFileSync(__dirname + "/../index.html", "utf8"), css = html.slice(html.indexOf("/* ARC-START"), html.indexOf("/* ARC-END */"));
const teamCss = css.slice(css.indexOf(".arc-members {"), css.indexOf(".wa-teams {"));
check("team scoreboard css: members list styled, no animation or transition in it", /\.arc-members li/.test(teamCss) && !/animation|transition|@keyframes/.test(teamCss));
check("reduced motion still switches every wb-board animation off (team board lives in .wb-board)", /prefers-reduced-motion: reduce\) \{ \.wb-board \*, \.wb-board \{ animation:none !important; transition:none !important;/.test(css) && /id="waBoard" class="card wb-board"/.test(html));
const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
