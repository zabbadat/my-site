// Zabba Washers Live Match (zabba-match.js): join flow, turn enforcement, scoring to 21, timer expiry, rules mirror,
// over the shared mock Firestore (test/lib/mockfs.js) with skewed phone clocks. Plus page wiring and firestore.rules content.
const fsMod = require("fs"), path = require("path");
const ZM = require("../zabba-match.js"), mockFs = require("./lib/mockfs.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const A = { uid: "a", displayName: "Ann", photoURL: "https://lh3.googleusercontent.com/a/x" }, B = { uid: "b", name: "bo@example.com", photoURL: "javascript:alert(1)" };
const throwsMsg = async (p, re) => { try { await p; return false; } catch (e) { return re.test(e.message); } };

// ---- pure helpers ----
{ const seen = new Set(); let ok = true; for (let i = 0; i < 2000; i++) { const c = ZM.genCode(); seen.add(c); if (!ZM.isValidCode(c)) ok = false; }
  check("codes: 5 chars, no 0/O/1/I, varied", ok && seen.size > 1990 && ZM.CODE_LEN === 5);
  check("link round trip: ?match= and #match=", ZM.codeFromUrl("?x=1&match=k7qx2", "") === "K7QX2" && ZM.codeFromUrl("", "#match=K7QX2") === "K7QX2" && ZM.codeFromUrl("", "#match/k7qx2") === "K7QX2"
    && ZM.codeFromUrl("?match=K0QX2", "") === "" && ZM.linkFor("K7QX2", "https://zabbadat.com") === "https://zabbadat.com/?match=K7QX2#zabbaMatch");
  check("seat: name never an email, photo https only", ZM.seatOf(B).name === "bo" && ZM.seatOf(B).photo === "" && ZM.seatOf(A).photo === A.photoURL && ZM.seatOf(A).name === "Ann");
  check("point values match washers-battle.js (0/2/3/5, pack of 3, 21)", JSON.stringify(ZM.PTS) === JSON.stringify(require("../washers-battle.js").PTS) && ZM.PACK === 3 && ZM.TARGET === 21);
  check("pack validation", ZM.validPack([5, 3, 2]) && !ZM.validPack([5, 3]) && !ZM.validPack([4, 0, 0]) && ZM.validPartial([]) && ZM.validPartial([5]) && !ZM.validPartial([0, 0, 0, 0]));
}
// ---- scoring to 21 (pure afterPack replay) ----
const live = () => ({ code: "K7QX2", status: "active", uids: ["a", "b"], players: [ZM.seatOf(A), ZM.seatOf(B)], scores: [0, 0], round: 1, first: 0, turn: "a", turnAt: 0, turnMs: ZM.TURN_MS, pack: [], log: [], winner: null, reason: "", seq: 0 });
const play = (m, pack, x) => Object.assign({}, m, ZM.afterPack(m, pack, x));
{ let m = live(); m = play(m, [5, 5, 5]); check("first pack: score added, turn passes to b", m.scores[0] === 15 && m.turn === "b" && m.round === 1);
  m = play(m, [2, 0, 0]); check("round 1 done: a scored more -> a pitches first in round 2", m.round === 2 && m.first === 0 && m.turn === "a");
  m = play(m, [3, 3, 0]); check("a reaches 21 first but b still gets the equal turn (no win mid-round)", m.status === "active" && m.scores[0] === 21 && m.turn === "b");
  m = play(m, [5, 0, 0]); check("after both packs: a 21 v b 7 -> a wins by score", m.status === "finished" && m.winner === "a" && m.reason === "score" && m.turn === null);
  check("replay of the log reproduces the stored result", ZM.replay(m) && ZM.replay(m).winner === "a" && JSON.stringify(ZM.replay(m).scores) === JSON.stringify(m.scores));
  let t = live(); t = play(t, [5, 5, 5]); t = play(t, [5, 5, 5]); t = play(t, [2, 2, 2]); t = play(t, [2, 2, 2]);
  check("both at 21 after a round -> overtime, no winner, order kept on a tie", t.status === "active" && t.scores[0] === 21 && t.scores[1] === 21 && ZM.isOvertime(t) && t.first === 0 && t.turn === "a");
  t = play(t, [0, 0, 0]); t = play(t, [2, 0, 0]); check("overtime: higher total wins (no bust, over 21 is fine)", t.winner === "b" && t.scores[1] === 23);
  let o = live(); o = play(o, [0, 0, 2]); o = play(o, [5, 0, 0]); check("second pitcher outscores the round -> pitches first next round (same player twice)", o.first === 1 && o.turn === "b" && o.round === 2);
  let z = live(); for (let i = 0; i < ZM.MAX_ROUNDS * 2; i++) z = play(z, [0, 0, 0]); check("30 rounds without a winner -> tie", z.status === "finished" && z.reason === "tie" && z.winner === null);
}
// ---- timer helpers ----
{ const m = Object.assign(live(), { turnAt: 1000 });
  check("deadline = turnAt + 45 s", ZM.deadlineMs(m) === 46000 && ZM.timeLeftMs(m, 16000) === 30000 && ZM.timeLeftMs(m, 99999) === 0);
  check("submit allowed through the 5 s grace, not after", ZM.canSubmit(m, "a", 50999) && !ZM.canSubmit(m, "a", 51001) && !ZM.canSubmit(m, "b", 2000));
  check("claim only by the opponent, only after deadline + grace", !ZM.canClaim(m, "b", 50999) && ZM.canClaim(m, "b", 51001) && !ZM.canClaim(m, "a", 99999) && !ZM.canClaim(m, "z", 99999));
  const v = ZM.view(m, "a", 16000); const w = ZM.view(m, "b", 16000);
  check("banner: 'Your turn' for a, 'Waiting for Ann' for b, with the seat photo and 30 s left", v.mine && /Your turn/.test(v.banner) && !w.mine && w.banner === "Waiting for Ann" && w.who.photo === A.photoURL && v.secsLeft === 30);
}
// ---- rules mirror (checkWrite) ----
{ const T = 5000, n0 = ZM.newMatch("K7QX2", A, T);
  check("rules: create ok for the signed-in host", ZM.checkWrite(null, n0, "a", T, "K7QX2") === "");
  check("rules: create refused for someone else / bad code / extra field / pre-scored", ZM.checkWrite(null, n0, "b", T, "K7QX2") !== "" && ZM.checkWrite(null, Object.assign({}, n0, { code: "K0QX2" }), "a", T, "K0QX2") !== ""
    && ZM.checkWrite(null, Object.assign({}, n0, { hax: 1 }), "a", T, "K7QX2") !== "" && ZM.checkWrite(null, Object.assign({}, n0, { scores: [21, 0] }), "a", T, "K7QX2") !== "" && ZM.checkWrite(null, n0, null, T, "K7QX2") !== "");
  const j = Object.assign({}, n0, ZM.joinPatch(n0, B, T + 10));
  check("rules: join ok; host pitches first; turn clock = request time", ZM.checkWrite(n0, j, "b", T + 10) === "" && j.turn === "a" && j.status === "active");
  check("rules: join refused when it changes scores, takes host seat, or match is old", ZM.checkWrite(n0, Object.assign({}, j, { scores: [0, 5] }), "b", T + 10) !== ""
    && ZM.checkWrite(n0, Object.assign({}, j, { turn: "b" }), "b", T + 10) !== "" && ZM.checkWrite(n0, Object.assign({}, j, { updatedAt: T + ZM.EXPIRE_MS + 10, turnAt: T + ZM.EXPIRE_MS + 10 }), "b", T + ZM.EXPIRE_MS + 10) !== "");
  check("rules: third player can't join a full match", ZM.checkWrite(j, Object.assign({}, j, { updatedAt: T + 20 }), "c", T + 20) !== "");
  const t1 = T + 20000, s1 = Object.assign({}, j, ZM.afterPack(j, [5, 3, 2], false), { turnAt: t1, updatedAt: t1 });
  check("rules: current player scores own pack before deadline", ZM.checkWrite(j, s1, "a", t1) === "");
  check("rules: opponent can't score for the current player", ZM.checkWrite(j, s1, "b", t1) !== "");
  check("rules: inflated score refused", ZM.checkWrite(j, Object.assign({}, s1, { scores: [20, 0] }), "a", t1) !== "");
  check("rules: invalid washer value refused", ZM.checkWrite(j, Object.assign({}, s1, { log: [{ r: 1, i: 0, p: [5, 3, 4], x: false }], scores: [12, 0] }), "a", t1) !== "");
  check("rules: rewriting history refused", ZM.checkWrite(s1, Object.assign({}, s1, ZM.afterPack(s1, [0, 0, 0], false), { log: [{ r: 1, i: 0, p: [5, 5, 5], x: false }, { r: 1, i: 1, p: [0, 0, 0], x: false }], turnAt: t1 + 5, updatedAt: t1 + 5 }), "b", t1 + 5) !== "");
  const late = T + 10 + ZM.TURN_MS + ZM.GRACE_MS + 1;
  check("rules: current player's pack after deadline + grace refused", ZM.checkWrite(j, Object.assign({}, s1, { turnAt: late, updatedAt: late }), "a", late) === "turn time is up");
  const c1 = Object.assign({}, j, ZM.afterPack(j, [0, 0, 0], true), { turnAt: late, updatedAt: late });
  check("rules: opponent takes a timed-out turn as 0 0 0", ZM.checkWrite(j, c1, "b", late) === "" && c1.turn === "b" && c1.scores[0] === 0);
  check("rules: time-out claim refused before the deadline, or with points", ZM.checkWrite(j, Object.assign({}, c1, { turnAt: t1, updatedAt: t1 }), "b", t1) !== ""
    && ZM.checkWrite(j, Object.assign({}, j, ZM.afterPack(j, [5, 0, 0], true), { turnAt: late, updatedAt: late }), "b", late) !== "");
  check("rules: live taps only by the current player, max 3 valid washers", ZM.checkWrite(j, Object.assign({}, j, { pack: [5], updatedAt: t1 }), "a", t1) === ""
    && ZM.checkWrite(j, Object.assign({}, j, { pack: [5], updatedAt: t1 }), "b", t1) !== "" && ZM.checkWrite(j, Object.assign({}, j, { pack: [1], updatedAt: t1 }), "a", t1) !== "");
  check("rules: forfeit makes the OTHER player winner", ZM.checkWrite(j, Object.assign({}, j, { status: "finished", winner: "b", reason: "forfeit", turn: null, updatedAt: t1 }), "a", t1) === ""
    && ZM.checkWrite(j, Object.assign({}, j, { status: "finished", winner: "a", reason: "forfeit", turn: null, updatedAt: t1 }), "a", t1) !== "");
  check("rules: fake win below 21 refused", ZM.checkWrite(j, Object.assign({}, s1, { status: "finished", winner: "a", reason: "score", turn: null }), "a", t1) === "bad win");
  check("rules: host cancels a waiting match; delete refused", ZM.checkWrite(n0, Object.assign({}, n0, { status: "abandoned", updatedAt: T + 1 }), "a", T + 1) === "" && ZM.checkWrite(n0, null, "a", T + 1) !== "");
}
// ---- page + rules file wiring ----
{ const html = fsMod.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), rules = fsMod.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  check("page: module loaded, panel inside #washerbattle, hub card, buttons", /<script src="\/zabba-match.js"><\/script>/.test(html) && html.indexOf('id="zabbaMatch"') > html.indexOf('<section id="washerbattle">') && html.indexOf('id="zabbaMatch"') < html.indexOf('<section id="tutbattles">')
    && /href="#zabbaMatch" data-battle="match"/.test(html) && ["zmCreate", "zmJoin", "zmCode", "zmShare", "zmBanner", "zmSubmit", "zmUndo", "zmClaim", "zmForfeit", "zmSeats"].every((id) => html.includes('id="' + id + '"')));
  check("page: uses the matches collection, auth photo with no-referrer + onerror fallback, link join", /mkBattleFs\("matches"\)/.test(html) && /img.referrerPolicy = "no-referrer"; img.onerror/.test(html) && /ZM.codeFromUrl\(location.search, location.hash\)/.test(html) && /onAuthStateChanged\(auth, zmOnUser\)/.test(html));
  check("page: no Live streaming built yet (slot reserved only)", /id="zmLiveSlot" hidden/.test(html) && !/getDisplayMedia|RTCPeerConnection/.test(fsMod.readFileSync(path.join(__dirname, "..", "zabba-match.js"), "utf8")));
  const blk = rules.slice(rules.indexOf("match /matches/{code}"), rules.indexOf("match /{document=**}"));
  check("rules file: matches block before the default deny; signed-in read, no delete, 45+5 s clock, 5-char codes, 0/2/3/5", blk.length > 500 && /allow read: if request.auth != null;/.test(blk) && /allow delete: if false;/.test(blk)
    && /duration.value\(50, 's'\)/.test(blk) && /\^\[A-HJ-NP-Z2-9\]\{5\}\$/.test(blk) && /x in \[0, 2, 3, 5\]/.test(blk) && /n\(\).turnMs == 45000/.test(blk) && /m.scores\[wi\] >= 21/.test(blk));
  check("rules file: existing collections still present", ["battles/{code}", "washersBattles/{code}", "tutBattles/{code}", "zabBoard/{uid}", "liveWalk/{uid}", "pushups"].every((k) => rules.includes(k)));
}
// ---- two phones over the mock Firestore (skewed clocks) ----
(async () => {
  const S = mockFs(); const viol = []; let txCount = 0;
  // every write a phone makes is replayed through the rules mirror as that phone's user
  const asUser = (uid) => Object.assign({}, S.fs, { tx: (c, fn) => { let before, wrote = false; return S.fs.tx(c, (t) => { before = t.get();
    return fn({ get: t.get, set: (d) => { wrote = true; t.set(d); }, update: (p) => { wrote = true; t.update(p); } }); }).then((out) => {
      if (wrote) { txCount++; const why = ZM.checkWrite(before, S.docs[c], uid, S.T, c); if (why) viol.push(uid + ":" + why); } return out; }); } });
  const pa = ZM.controller(asUser("a"), { now: () => S.T + 3000 }), pb = ZM.controller(asUser("b"), { now: () => S.T - 4000 });
  const tick = () => new Promise((r) => setTimeout(r, 15));
  check("join: signed-out user refused", await throwsMsg(pa.create(null), /Sign in/) && await throwsMsg(pb.join("K7QX2", null), /Sign in/));
  const code = await pa.create(A);
  check("create: waiting, host seated with name + photo, offset learned", S.docs[code].status === "waiting" && S.docs[code].players[0].name === "Ann" && S.docs[code].players[0].photo === A.photoURL && Math.abs(pa.offset + 3000) < 60);
  check("join: bad code / no match", await throwsMsg(pb.join("abc", B), /5 letters/) && await throwsMsg(pb.join("ZZZZZ", B), /No match/));
  await pb.join(code.toLowerCase(), B);
  const m = S.docs[code];
  check("join: active, two players, host's turn, round 1, clock started", m.status === "active" && m.uids.join() === "a,b" && m.turn === "a" && m.round === 1 && m.turnAt === S.T && Math.abs(pb.offset - 4000) < 60);
  check("join: third player refused; rejoin by a seated player is fine", await throwsMsg(pb.join(code, { uid: "c", name: "Cy" }), /two players/) && (await pa.join(code, A)) === code);
  let seenA = [], seenB = []; const offA = pa.watch(code, (d) => seenA.push(d)), offB = pb.watch(code, (d) => seenB.push(d));
  check("turn: b can't submit on a's turn", await throwsMsg(pb.submit(code, B, [5, 5, 5]), /isn't your turn/));
  check("turn: incomplete pack refused", await throwsMsg(pa.submit(code, A, [5, 5]), /all 3/));
  check("turn: live taps only by the current player", (await pa.setPack(code, A, [5])) === true && (await pb.setPack(code, B, [5])) === false && S.docs[code].pack.join() === "5");
  await pa.submit(code, A, [5, 5, 5]); await tick();
  check("submit: a +15, pack cleared, b's turn, both phones saw it", S.docs[code].scores.join() === "15,0" && S.docs[code].pack.length === 0 && S.docs[code].turn === "b"
    && seenA[seenA.length - 1].turn === "b" && seenB[seenB.length - 1].scores[0] === 15);
  check("submit: concurrent double-submit counts once", (await Promise.allSettled([pb.submit(code, B, [2, 0, 0]), pb.submit(code, B, [2, 0, 0])])).filter((x) => x.status === "fulfilled").length === 1 && S.docs[code].scores[1] === 2 && S.docs[code].turn === "a");
  // timer expiry: a sits out the clock
  S.T += ZM.TURN_MS - 1000;
  check("timer: b can't claim before the deadline", (await pb.claim(code, B)) === false);
  S.T += 1000 + ZM.GRACE_MS + 10;
  check("timer: a's late pack refused after deadline + grace", await throwsMsg(pa.submit(code, A, [5, 5, 5]), /time ran out/));
  check("timer: b takes the turn, a's pack logged 0 0 0, claim is idempotent", (await pb.claim(code, B)) === true && (await pb.claim(code, B)) === false
    && S.docs[code].scores.join() === "15,2" && S.docs[code].log[2].x === true && S.docs[code].turn === "b" && S.docs[code].turnAt === S.T);
  check("every stored transition passes the rules mirror; log replays to the stored doc", ZM.replay(S.docs[code]).scores.join() === S.docs[code].scores.join());
  await pb.submit(code, B, [5, 5, 3]);
  check("b outscored round 2 (13 v 0) -> b pitches first in round 3", S.docs[code].round === 3 && S.docs[code].turn === "b" && S.docs[code].scores.join() === "15,15");
  await pb.submit(code, B, [2, 2, 0]);
  check("b at 19, a's turn, still active", S.docs[code].scores.join() === "15,19" && S.docs[code].status === "active" && S.docs[code].turn === "a");
  await pa.submit(code, A, [3, 3, 0]);
  check("scoring to 21: a wins 21-19 at the end of the round; no more turns", S.docs[code].status === "finished" && S.docs[code].winner === "a" && await throwsMsg(pb.submit(code, B, [5, 5, 5]), /isn't running/));
  check("view after the end: 'You win!' / 'Ann wins.'", pa.view(S.docs[code], "a").banner === "You win!" && pb.view(S.docs[code], "b").banner === "Ann wins.");
  // forfeit + cancel
  const c2 = await pa.create(A); check("cancel: only host, only while waiting", (await pb.cancel(c2, B)) === false && (await pa.cancel(c2, A)) === true && S.docs[c2].status === "abandoned" && await throwsMsg(pb.join(c2, B), /cancelled/));
  const c3 = await pa.create(A); await pb.join(c3, B); await pb.forfeit(c3, B);
  check("forfeit: opponent wins", S.docs[c3].status === "finished" && S.docs[c3].winner === "a" && S.docs[c3].reason === "forfeit");
  const c4 = await pa.create(A); S.T += ZM.EXPIRE_MS + 1; check("join: expired waiting match refused", await throwsMsg(pb.join(c4, B), /expired/));
  let hookHits = 0; const unhook = ZM.hooks.onState(() => hookHits++); const off5 = pa.watch(c3, () => {}); await tick(); unhook(); off5();
  check("hooks: onState fires for future Live tab", hookHits >= 1 && typeof ZM.hooks.photoFor === "function");
  check("rules mirror: all " + txCount + " controller writes allowed (" + viol.join(", ") + ")", txCount >= 12 && viol.length === 0);
  offA(); offB();
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})();
