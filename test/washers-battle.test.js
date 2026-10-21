// Tests for washers-battle.js: two-phone flow on a mock Firestore via battle-rooms.js.
const WB = require("../washers-battle.js");
const BR = require("../battle-rooms.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
let T = 5_000_000; const SERVER = { __ts: 1 }, DEL = { __del: 1 };
function mkFs() {
  const docs = {}, subs = {};
  const deep = (v) => (v === SERVER ? T : Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
  const apply = (d, p) => { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; if (v === DEL) delete o[ks.at(-1)]; else o[ks.at(-1)] = deep(v); } return d; };
  const emit = (c) => setTimeout(() => (subs[c] || []).slice().forEach((f) => f(clone(docs[c]))));
  let lock = Promise.resolve();
  return { docs,
    tx: (c, fn) => (lock = lock.then(async () => { await new Promise((r) => setTimeout(r, 1)); let next; const out = fn({ get: () => clone(docs[c]), set: (d) => (next = deep(d)), update: (p) => (next = apply(next || docs[c], p)) }); if (next) { docs[c] = next; emit(c); } return out; })),
    update: async (c, p) => { docs[c] = apply(docs[c], p); emit(c); },
    watch: (c, cb) => { (subs[c] = subs[c] || []).push(cb); setTimeout(() => cb(clone(docs[c]))); return () => { subs[c] = subs[c].filter((f) => f !== cb); }; },
    ts: () => SERVER, del: () => DEL, toMs: (v) => (typeof v === "number" ? v : null) };
}
const res = (steps, ms, verified = true, reasons = []) => ({ score: 21, steps, ms, verified, reasons });
const A = { uid: "a", name: "Zab" }, B = { uid: "b", name: "Pal" };
async function room() {
  const fs = mkFs(), ca = BR.controller(fs, { now: () => T }), cb = BR.controller(fs, { now: () => T });
  const code = await ca.createRoom(A); await cb.joinRoom(code, B);
  await Promise.all([ca.setReady(code, A, true), cb.setReady(code, B, true)]);
  T = fs.docs[code].startAt + 1300; await cb.markLive(code);
  return { fs, code, ca, cb };
}
(async () => {
  // validation
  check("valid result ok", WB.validateResult(res(400, 600000)) === "");
  check("score 20 rejected", WB.validateResult({ ...res(400, 600000), score: 20 }) !== "");
  check("score 22 rejected", WB.validateResult({ ...res(400, 600000), score: 22 }) !== "");
  check("negative steps rejected", WB.validateResult(res(-1, 600000)) !== "");
  check("steps > 100000 rejected", WB.validateResult(res(100001, 600000)) !== "");
  check("fractional steps rejected", WB.validateResult(res(10.5, 600000)) !== "");
  check("ms > 4h rejected", WB.validateResult(res(400, 4 * 3600 * 1000 + 1)) !== "");
  check("ms 0 rejected", WB.validateResult(res(400, 0)) !== "");
  check("missing verified rejected", WB.validateResult({ score: 21, steps: 1, ms: 1, reasons: [] }) !== "");
  check("bad reasons rejected", WB.validateResult({ ...res(1, 1), reasons: "x" }) !== "");
  // create / join
  let { fs, code } = await room();
  const d0 = fs.docs[code];
  check("create + join: two seats keyed by auth uid", Object.keys(d0.players).sort().join() === "a,b" && d0.createdBy === "a");
  check("room goes live via shared rooms module", d0.status === "live");
  check("decide: playing before any result", WB.decide(fs.docs[code]).phase === "playing");
  check("progress publish", (await WB.publishProgress(fs, code, "a", 9, 120)) && fs.docs[code].players.a.score === 9 && fs.docs[code].players.a.steps === 120);
  check("progress clamps score to 21", WB.progressPatch("a", 99, 5)["players.a.score"] === 21);
  check("bad result rejected by postResult", await WB.postResult(fs, code, "a", res(5, 1, true, []).score && { ...res(5, 1000), score: 19 }).then(() => false, () => true));
  check("A posts", await WB.postResult(fs, code, "a", res(300, 700000)));
  check("no double-post", !(await WB.postResult(fs, code, "a", res(100, 500000))) && fs.docs[code].players.a.result.steps === 300);
  check("no progress after result", !(await WB.publishProgress(fs, code, "a", 3, 3)));
  check("waiting for opponent", WB.decide(fs.docs[code]).phase === "waiting-opponent" && WB.decide(fs.docs[code]).done === "a");
  check("B posts", await WB.postResult(fs, code, "b", res(450, 600000)));
  let dec = WB.decide(fs.docs[code]);
  check("fewer steps wins (slower but fewer)", dec.phase === "done" && dec.winnerUid === "a" && dec.why === "steps");
  // step tie
  ({ fs, code } = await room());
  await WB.postResult(fs, code, "a", res(300, 700000)); await WB.postResult(fs, code, "b", res(300, 650000));
  dec = WB.decide(fs.docs[code]); check("step tie -> faster time", dec.winnerUid === "b" && dec.why === "time");
  // exact draw
  ({ fs, code } = await room());
  await WB.postResult(fs, code, "a", res(300, 1000)); await WB.postResult(fs, code, "b", res(300, 1000));
  dec = WB.decide(fs.docs[code]); check("identical -> draw", dec.phase === "done" && dec.winnerUid === null && dec.why === "draw");
  // verified vs unverified
  ({ fs, code } = await room());
  await WB.postResult(fs, code, "a", res(100, 300000, false, ["page was hidden during play"])); await WB.postResult(fs, code, "b", res(900, 900000, true));
  dec = WB.decide(fs.docs[code]); check("verified beats unverified even with more steps", dec.winnerUid === "b" && dec.why === "verified");
  check("unverified reasons stored", fs.docs[code].players.a.result.reasons[0] === "page was hidden during play");
  // forfeit
  ({ fs, code } = await room());
  check("A forfeits", await WB.forfeit(fs, code, "a"));
  check("forfeit is final (no post after)", !(await WB.postResult(fs, code, "a", res(1, 1000))));
  check("forfeit: waiting until other finishes", WB.decide(fs.docs[code]).phase === "waiting-opponent");
  await WB.postResult(fs, code, "b", res(5000, 3000000, false, ["x"]));
  dec = WB.decide(fs.docs[code]); check("forfeit loses to a finish (even unverified)", dec.winnerUid === "b" && dec.why === "forfeit");
  ({ fs, code } = await room()); await WB.forfeit(fs, code, "a"); await WB.forfeit(fs, code, "b");
  dec = WB.decide(fs.docs[code]); check("both forfeit -> no winner", dec.phase === "done" && dec.winnerUid === null);
  // outsider + not live
  check("outsider can't post", !(await WB.postResult(fs, code, "zz", res(1, 1000))));
  const fs2 = mkFs(), c2 = await BR.controller(fs2, { now: () => T }).createRoom(A);
  check("can't post before live", !(await WB.postResult(fs2, c2, "a", res(1, 1000))));
  check("decide waiting with one seat", WB.decide(fs2.docs[c2]).phase === "waiting");
  // opener
  ({ fs, code } = await room());
  await WB.setOpener(fs, code, "a", "b"); check("opener: one pick not agreed", !WB.openerState(fs.docs[code]).agreed);
  await WB.setOpener(fs, code, "b", "a"); check("opener: conflict flagged", WB.openerState(fs.docs[code]).conflict === true);
  await WB.setOpener(fs, code, "b", "b"); const os = WB.openerState(fs.docs[code]); check("opener: agreed", os.agreed && os.opener === "b");
  check("opener must be a seated player", !(await WB.setOpener(fs, code, "a", "zz")));
  // invite links
  check("inviteUrl", WB.inviteUrl("K7QX") === "https://www.zabbadat.com/?wb=K7QX#battle-gate");
  check("parse ?wb=K7QX", WB.parseInvite("?wb=K7QX") === "K7QX");
  check("parse full url, lowercase", WB.parseInvite("https://www.zabbadat.com/?x=1&wb=k7qx#battle-gate") === "K7QX");
  check("round trip", WB.parseInvite(WB.inviteUrl("ABCD").split("#")[0]) === "ABCD");
  check("parse rejects bad code (O/0/1/I, length)", WB.parseInvite("?wb=O0I1") === null && WB.parseInvite("?wb=ABC") === null && WB.parseInvite("?wb=ABCDE") === null);
  check("parse missing -> null", WB.parseInvite("") === null && WB.parseInvite("?b=K7QX") === null);
  check("UI name", WB.NAME === "Zabba washer Battle Gate");
  check("share text", WB.shareText("K7QX") === "Join my Zabba washer Battle Gate: https://www.zabbadat.com/?wb=K7QX#battle-gate");
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); if (f) process.exit(1);
})();
