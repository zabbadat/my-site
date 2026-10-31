// Player-to-player ZAB sends + the public bank-summary feed + the /bank page wiring.
const X = require("../zab-transfer.js"), Z = require("../zab-balance.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
let T = 1e9; const db = {}; const SV = { __ts: 1 };
const P = (p) => p.join("/"), clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
const deep = (v) => (v === SV ? T : v);
let lock = Promise.resolve(), readAfterWrite = false;
const fs = { tx: (fn) => { const run = lock.then(async () => { const w = []; const out = await fn({ get: async (p) => { if (w.length) readAfterWrite = true; return clone(db[P(p)]); },
  set: (p, d) => w.push(() => (db[P(p)] = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, deep(v)])))),
  update: (p, x) => w.push(() => { if (!db[P(p)]) throw new Error("update missing " + P(p)); Object.entries(x).forEach(([k, v]) => (db[P(p)][k] = deep(v))); }) }); w.forEach((f) => f()); return out; }); lock = run.catch(() => {}); return run; },
  ts: () => SV };
const user = (u, n, name) => { db["users/" + u] = { uid: u, zabBalance: n, lastTxId: "", createdAt: 0, updatedAt: 0 }; if (name) db["zabBoard/" + u] = { uid: u, name, total: n, updatedAt: 0 }; };
const bal = (u) => db["users/" + u].zabBalance, board = (u) => db["zabBoard/" + u].total;
const caught = async (p) => { try { await p; return null; } catch (e) { return e; } };
let k = 0; const key = () => "testkey" + String(++k).padStart(4, "0");
(async () => {
  user("alice", 100, "Alice"); user("bob", 5, "Bob"); user("ghost", 7);
  let r = await X.send(fs, "alice", { to: "bob", amount: 30, key: "kfixed0001" }, T);
  check("send moves ZAB atomically", r.ok && bal("alice") === 70 && bal("bob") === 35 && r.balance === 70 && r.toName === "Bob");
  check("board mirrors equal balances", board("alice") === 70 && board("bob") === 35);
  const s = db["users/alice/zabLedger/send-kfixed0001"], v = db["users/bob/zabLedger/recv-alice-kfixed0001"];
  check("matching ledger entries both sides", s.amount === -30 && v.amount === 30 && s.type === "send" && v.type === "receive" && v.fromName === "Alice");
  check("lastTxId points at the new entries", db["users/alice"].lastTxId === "send-kfixed0001" && db["users/bob"].lastTxId === "recv-alice-kfixed0001");
  r = await X.send(fs, "alice", { to: "bob", amount: 30, key: "kfixed0001" }, T);
  check("same key retried: idempotent, no double move", r.already && bal("alice") === 70 && bal("bob") === 35);
  let e = await caught(X.send(fs, "alice", { to: "bob", amount: 31, key: "kfixed0001" }, T)); check("same key, different send: 409", e && e.status === 409 && bal("alice") === 70);
  e = await caught(X.send(fs, "alice", { to: "bob", amount: 71, key: key() }, T)); check("no overdraft (402), nothing moved", e && e.status === 402 && bal("alice") === 70 && bal("bob") === 35);
  e = await caught(X.send(fs, "alice", { to: "alice", amount: 1, key: key() }, T)); check("no self-send", e && e.status === 400);
  for (const a of [0, -5, 1.5, "3", null]) { e = await caught(X.send(fs, "alice", { to: "bob", amount: a, key: key() }, T)); if (!(e && e.status === 400)) check("bad amount " + a, false); }
  check("amount must be positive whole number", true);
  e = await caught(X.send(fs, "alice", { to: "bob", amount: X.MAX_SEND + 1, key: key() }, T)); check("size cap per send", e && e.status === 400);
  e = await caught(X.send(fs, null, { to: "bob", amount: 1, key: key() }, T)); check("signed out: 401", e && e.status === 401);
  e = await caught(X.send(fs, "alice", { to: "ghost", amount: 1, key: key() }, T)); check("recipient must be on the board", e && e.status === 404 && bal("ghost") === 7);
  e = await caught(X.send(fs, "alice", { to: "bob@x.com", amount: 1, key: key() }, T)); check("recipient is a uid, never an email", e && e.status === 400);
  e = await caught(X.send(fs, "alice", { to: "bob", amount: 1, key: "short" }, T)); check("idempotency key required", e && e.status === 400);
  user("rich", 100000, "Rich");
  for (let i = 0; i < 5; i++) await X.send(fs, "rich", { to: "bob", amount: 1000, key: key() }, T);
  e = await caught(X.send(fs, "rich", { to: "bob", amount: 1, key: key() }, T)); check("daily ZAB limit (429)", e && e.status === 429 && bal("rich") === 95000);
  r = await X.send(fs, "rich", { to: "bob", amount: 1, key: key() }, T + 86400000); check("limit resets next UTC day", r.ok);
  user("busy", 1000, "Busy");
  for (let i = 0; i < X.DAILY_SENDS; i++) await X.send(fs, "busy", { to: "bob", amount: 1, key: key() }, T);
  e = await caught(X.send(fs, "busy", { to: "bob", amount: 1, key: key() }, T)); check("daily send-count limit (429)", e && e.status === 429);
  user("c", 10, "C"); user("d", 0, "D");
  const both = await Promise.allSettled([X.send(fs, "c", { to: "d", amount: 8, key: key() }, T), X.send(fs, "c", { to: "d", amount: 8, key: key() }, T)]);
  check("concurrent sends can't overdraw", both.filter((x) => x.status === "fulfilled").length === 1 && bal("c") === 2 && bal("d") === 8);
  check("all reads before writes in the transaction", !readAfterWrite);
  check("history line: sent/received with names", Z.txLine(s).source === "Sent" && Z.txLine(s).qty === "to Bob" && Z.txLine(v).qty === "from Alice" && Z.txLine(s).amount === "−30");
  check("history never shows an email name", !/@/.test(Z.txLine({ source: "transfer", type: "receive", amount: 1, fromName: "a@b.com", from: "u1" }).qty));
  // ---- bank-summary feed ----
  const F = require("../netlify/functions/bank-summary.js");
  const out = F.summary([{ id: "u1", uid: "u1", name: "Zed", total: 50 }, { id: "u2", uid: "u2", name: "mail@example.com", total: 50 }, { id: "u3", uid: "u3", name: "Zero", total: 0 }, { id: "u4", uid: "u4", name: "Amy", total: 9 }], 100, T);
  const txt = JSON.stringify(out);
  check("feed: names + totals + ranks, ties share rank", out.count === 3 && out.holders[0].total === 50 && out.holders[1].rank === 1 && out.holders[2].rank === 3);
  check("feed: no emails, no uids", !/@/.test(txt) && !/"uid"|u1|u2|u4/.test(txt));
  check("feed: ISO UTC timestamp, whole numbers", /Z$/.test(out.generatedAt) && out.holders.every((h) => Number.isInteger(h.total) && h.total >= 0));
  // ---- page ----
  const html = fsx.readFileSync(__dirname + "/../bank.html", "utf8");
  check("/bank: send form + confirm dialog + history", /id="sendForm"/.test(html) && /<dialog id="sendConfirm"/.test(html) && /zab-send/.test(html) && /id="bankHistory"/.test(html) && /zabLedger/.test(html));
  check("/bank: amounts use ring helper, no 'bet' wording, no location text", /amountHtml/.test(html) && !/\bbets?\b/i.test(html.replace(/<script[\s\S]*?<\/script>/g, "")) && !/jersey/i.test(html));
  check("zab-send function verifies sign-in", /uidFrom\(event\)/.test(fsx.readFileSync(__dirname + "/../netlify/functions/zab-send.js", "utf8")));
  const fail = R.filter((x) => !x).length; console.log(`${R.length - fail}/${R.length} passed`); process.exit(fail ? 1 : 0);
})();
