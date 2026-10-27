// Saved player names: one resolver for every match (account name, never an email, Guest when signed out), stored on the seat as pubName.
const W = require("../washers-battle.js"), BR = require("../battle-rooms.js"), AR = require("../washers-arena.js"), A = require("../washers-arcade.js"), HR = require("./lib/washers-match.js"), HA = require("./lib/arena-match.js"), mockFs = require("./lib/mockfs.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("signed in with a display name: that name", W.resolveName({ displayName: "Ann Lee" }) === "Ann Lee");
check("the site's own player-name box wins when filled (existing behaviour); otherwise the account name", W.resolveName({ typed: "Zabba", displayName: "Ann" }) === "Zabba" && W.resolveName({ typed: "  ", displayName: "Ann" }) === "Ann");
check("no display name: the local part of the email (what the site's publicName() already does), never the address", W.resolveName({ email: "zed.q@mail.com" }) === "zed.q" && !/@/.test(W.resolveName({ email: "zed.q@mail.com" })));
check("nothing at all on a signed-in account: Player", W.resolveName({}) === "Player" && W.resolveName({ displayName: "", email: "" }) === "Player" && W.resolveName({ displayName: "@@" }) === "Player");
check("signed out / no user: Guest, never blank", W.resolveName(null) === "Guest" && W.resolveName(undefined) === "Guest" && W.GUEST === "Guest");
check("an email typed as the name never leaks (cut to its local part)", W.resolveName({ displayName: "a.b@c.com" }) === "a.b" && !/@/.test(W.resolveName({ typed: "me@x.org" })));
check("24 characters at most; HTML and control characters stripped; whitespace collapsed", W.resolveName({ displayName: "x".repeat(60) }).length === 24 && W.NAME_MAX === 24 && W.resolveName({ displayName: "Ann <b>Lee</b>\u0000" }) === "Ann Lee" && W.resolveName({ displayName: "<script>alert(1)</script>" }) === "alert(1)" && W.resolveName({ displayName: "A   B" }) === "A B");
check("seatName prefers the saved pubName, falls back to the older name, never an email", W.seatName({ name: "old", pubName: "Saved" }) === "Saved" && W.seatName({ name: "old" }) === "old" && W.seatName({ name: "zed@mail.com" }) === "Player" && W.seatName(null) === "Player" && W.seatName({ pubName: "zed@mail.com", name: "x" }) === "Player");
// ---- 1v1 seat claim writes pubName (opt-in; plank / TUT rooms unchanged) ----
(async () => {
  const S = mockFs(), c = BR.controller(S.fs, { now: () => S.T, seatExtra: (u) => (u && u.pubName ? { pubName: String(u.pubName).slice(0, 24) } : null) });
  const code = await c.createRoom({ uid: "a", name: "Ann", pubName: "Ann" });
  check("1v1 create: the creator's seat carries pubName", S.docs[code].players.a.pubName === "Ann" && S.docs[code].players.a.name === "Ann");
  await c.joinRoom(code, { uid: "b", name: "Bo", pubName: "Bo" });
  check("1v1 join: the joiner's seat carries pubName; seat fields stay inside the allowed set", S.docs[code].players.b.pubName === "Bo" && Object.keys(S.docs[code].players.b).sort().join() === "joinedAt,name,pubName,ready");
  const plain = BR.controller(S.fs, { now: () => S.T }); const c2 = await plain.createRoom({ uid: "p", name: "Plank", pubName: "ignored" });
  check("rooms made without seatExtra (plank / TUT) never get a pubName", !("pubName" in S.docs[c2].players.p));
  // 2v2 claim at create and join
  const ac = AR.controller(S.fs, { now: () => S.T }), ac1 = await ac.createArena({ uid: "u1", name: "Ann", pubName: "Ann" }, 4); await ac.joinArena(ac1, { uid: "u2", name: "Bo", pubName: "Bo" });
  check("2v2 claim writes pubName on every seat; a seat without one stays valid", S.docs[ac1].seats.u1.pubName === "Ann" && S.docs[ac1].seats.u2.pubName === "Bo" && (await ac.joinArena(ac1, { uid: "u3", name: "Cy" }), !("pubName" in S.docs[ac1].seats.u3)));
  check("pubName is cut to 24 characters at claim time", (await ac.joinArena(ac1, { uid: "u4", name: "Di", pubName: "d".repeat(40) }), S.docs[ac1].seats.u4.pubName.length === 24));
  await ac.setReady(ac1, { uid: "u2", name: "Bo", pubName: "Bobby" }, false);
  check("the saved name refreshes at the next ready tap (account name changed)", S.docs[ac1].seats.u2.pubName === "Bobby");
  // ---- scoreboards render the saved name ----
  const room = HR.room(); room.players.a.pubName = "Annie"; room.players.b.pubName = "zed@mail.com"; room.players.a.name = "old"; room.players.b.name = "Bo";
  const ord = Object.keys(room.players).map((u) => ({ uid: u, ...room.players[u] })), model = A.model(room, ord, "a", { nowMs: 2000, toMs: (v) => v }), h1 = A.html(model, A.fx(null, model), null);
  check("1v1 arcade scoreboard prints the saved name (and never an email pubName)", /Annie/.test(h1) && !/>old</.test(h1) && !/zed@/.test(h1) && />Player</.test(h1) && W.boardRows(room, ord, "a")[0].name === "Annie (you)");
  const arena = HA.arena(); arena.seats.a1.pubName = "Annie"; const tmodel = A.teamModel(arena, "a1", { nowMs: 2000, toMs: (v) => v }), h2 = A.html(tmodel, null, null);
  const dsp = HA.bariboshi(HA.arena(), [10, 40, 30, 50]); dsp.seats.a1.pubName = "Annie"; HA.report(dsp, "a1", 1, [5, 5, 5]); HA.confirm(dsp, "b1", 1, "a1", false);
  check("2v2 team scoreboard prints the saved name; the dispute status line uses it too", /Annie/.test(h2) && /Dispute on Annie round 1/.test(AR.boardStatus(dsp, 2000, (v) => v).extra) && AR.nameOf(arena, "a1") === "Annie");
  // ---- Battlers board uses the saved name from the seat ----
  const B = require("../washers-battlers.js"), db = {}, K = (p) => p.join("/"), clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  const fs = { toMs: (v) => (typeof v === "number" ? v : null), ts: () => 1, tx: (fn) => { const w = []; return Promise.resolve(fn({ get: async (p) => clone(db[K(p)]), set: (p, x) => w.push(() => (db[K(p)] = clone(x))), update: () => {} })).then((o) => { w.forEach((f) => f()); return o; }); } };
  const won = HR.round(HR.round(HR.bariboshi(HR.room({ startAt: Date.UTC(2026, 9, 27, 15) }), 10, 30), 1, [5, 5, 5], [0, 0, 0]), 2, [5, 5, 5], [0, 0, 0]); won.players.a.pubName = "Annie"; won.players.a.name = "Ann"; db["washersBattles/K7QX"] = won;
  await B.settle(fs, "a", "K7QX", Date.UTC(2026, 9, 27, 16));
  check("the Battlers board record takes the seat's saved pubName", db["washersBattleSeason/2026-Q4_a"].name === "Annie" && db["washersBattleSeason/2026-Q4_b"].name === "Bo");
  // ---- page wiring ----
  const html = fsx.readFileSync(__dirname + "/../index.html", "utf8");
  check("page: one name helper (wbUser -> WB.resolveName) gives uid, name and pubName for 1v1 and 2v2; the 1v1 controller stores pubName", /function wbUser\(\) \{[^\n]*WB\.resolveName\(\{ typed: \$\("player"\)\.value\.trim\(\), displayName: currentUser\.displayName, email: currentUser\.email \}\)[^\n]*pubName: n/.test(html) && /seatExtra: \(u\) =>/.test(html) && /wac\.createArena\(u, 4/.test(html) && /wac\.joinArena\(raw, u/.test(html) && !/publicName/.test(html.slice(html.indexOf("function wbUser()"), html.indexOf("function wbEnter(")).split("\n")[0]));
  check("page: lobby seat names and team names are set with textContent only", /li\.textContent = AR\.nameOf\(a, u\)/.test(html) && /\$\("waTeam" \+ t\.toUpperCase\(\) \+ "Name"\)\.textContent = /.test(html) && /\$\("wbP" \+ \(i \+ 1\)\)\.textContent = p \? WB\.seatName\(p\)/.test(html) && !/waTeam[AB](Name|List)"\)\.innerHTML/.test(html));
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
