// Test helpers: build Zabba Washer Battle room docs with Bariboshi reports and confirmations.
const seat = (name, extra) => Object.assign({ name, ready: true, joinedAt: 1 }, extra || {});
const room = (extra) => Object.assign({ code: "K7QX", status: "live", startAt: 1000, createdAt: 500, players: { a: seat("Ann"), b: seat("Bo") } }, extra || {});
const add = (r, u, e) => { (r.players[u].rep = r.players[u].rep || []).push(e); return r; };
const other = (u) => (u === "a" ? "b" : "a");
// both report distance, both confirm -> order decided (lower cm first)
const bariboshi = (r, da, db, n = 1) => { add(r, "a", { k: "b", n, d: da }); add(r, "b", { k: "b", n, d: db }); add(r, "a", { k: "c", t: "b", n, ok: true }); add(r, "b", { k: "c", t: "b", n, ok: true }); return r; };
const report = (r, u, n, pack) => add(r, u, { k: "r", n, pack });
const confirm = (r, by, n, ok = true) => add(r, by, { k: "c", t: "r", n, ok });
// a full agreed round: reporter packs + both confirmations
const round = (r, n, pa, pb) => { report(r, "a", n, pa); report(r, "b", n, pb); confirm(r, "b", n); confirm(r, "a", n); return r; };
module.exports = { seat, room, add, other, bariboshi, report, confirm, round };
