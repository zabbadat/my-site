// Test helpers: build a 2v2 washersArenas doc (slots 0,1 = Team A, 2,3 = Team B) with reports and confirmations.
const seat = (name, slot, size, extra) => Object.assign({ name, ready: true, joinedAt: 1 + slot, slot, team: slot * 2 < size ? "a" : "b" }, extra || {});
const NAMES = ["Ann", "Bo", "Cy", "Di"], UIDS = ["a1", "a2", "b1", "b2"];
const arena = (extra) => {
  const a = Object.assign({ code: "K7QX", size: 4, status: "live", startAt: 1000, createdAt: 500, createdBy: "a1", teamNames: {}, slots: {}, seats: {} }, extra || {});
  UIDS.forEach((u, i) => { a.seats[u] = seat(NAMES[i], i, 4); a.slots[String(i)] = u; });
  return a;
};
const duo = (extra) => { const a = Object.assign({ code: "K7QX", size: 2, status: "live", startAt: 1000, createdAt: 500, teams: {}, slots: { 0: "a1", 1: "b1" }, teamNames: {}, seats: { a1: seat("Ann", 0, 2), b1: seat("Cy", 1, 2) } }, extra || {}); return a; };
const add = (a, u, e) => { (a.seats[u].rep = a.seats[u].rep || []).push(e); return a; };
const A = ["a1", "a2"], B = ["b1", "b2"], opp = (u) => (u[0] === "a" ? B : A);
// every player reports an opening distance (ds in UIDS order) and the other team confirms each (first opposing member by default)
const bariboshi = (a, ds, n = 1, ok = true) => { UIDS.forEach((u, i) => { if (u in a.seats) add(a, u, { k: "b", n, d: ds[i] }); }); Object.keys(a.seats).forEach((u) => add(a, opp(u)[0] in a.seats ? opp(u)[0] : opp(u)[0], { k: "c", t: "b", n, who: u, ok })); return a; };
const report = (a, u, n, pack) => add(a, u, { k: "r", n, pack });
const confirm = (a, by, n, who, ok = true) => add(a, by, { k: "c", t: "r", n, who, ok });
// a full agreed round: packs per player (in UIDS order) + one opposing confirm each
const round = (a, n, packs) => { Object.keys(a.seats).forEach((u, i) => report(a, u, n, packs[i])); Object.keys(a.seats).forEach((u) => confirm(a, opp(u)[0], n, u)); return a; };
module.exports = { seat, arena, duo, add, bariboshi, report, confirm, round, UIDS, NAMES, opp };
