// Player-to-player ZAB sends (server only: netlify/functions/zab-send.js, admin SDK). One atomic transaction:
// debit the sender, credit the recipient, matching zabLedger entries on both sides, board mirrors kept equal.
// Rules: whole numbers >= 1, max MAX_SEND per send, max DAILY_SENDS sends and DAILY_ZAB per UTC day, no overdraft,
// no self-send, recipient must be on the zabBoard (picked by name; uids only, never emails). `key` = idempotency key.
(function () {
  const MAX_SEND = 1000, DAILY_SENDS = 20, DAILY_ZAB = 5000;
  const UID = /^[A-Za-z0-9]{1,128}$/, KEY = /^[A-Za-z0-9_-]{8,40}$/;
  const err = (status, message) => Object.assign(new Error(message), { status });
  const isInt = (n) => Number.isInteger(n);
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  function check(from, body) {
    body = body || {};
    if (!from) throw err(401, "Sign in to send ZAB.");
    const to = String(body.to || ""), amount = body.amount, key = String(body.key || "");
    if (!UID.test(to)) throw err(400, "Pick a player to send to.");
    if (to === from) throw err(400, "You can't send ZAB to yourself.");
    if (!isInt(amount) || amount < 1) throw err(400, "Amount must be a whole number of at least 1 ZAB.");
    if (amount > MAX_SEND) throw err(400, "The most you can send at once is " + MAX_SEND.toLocaleString("en-US") + " ZAB.");
    if (!KEY.test(key)) throw err(400, "Bad request key.");
    return { to, amount, key };
  }
  async function send(fs, from, body, nowMs) {
    const { to, amount, key } = check(from, body);
    const now = nowMs || Date.now(), today = day(now);
    const sId = "send-" + key, rId = "recv-" + from + "-" + key;
    return fs.tx(async (t) => {
      const [su, ru, sb, rb, prior, rate] = await Promise.all([t.get(["users", from]), t.get(["users", to]), t.get(["zabBoard", from]),
        t.get(["zabBoard", to]), t.get(["users", from, "zabLedger", sId]), t.get(["zabSendRate", from])]);
      if (prior) {
        if (prior.to === to && prior.amount === -amount) return { ok: true, already: true, amount, to, toName: prior.toName, balance: su && su.zabBalance };
        throw err(409, "That request key was already used for a different send.");
      }
      if (!rb || !ru) throw err(404, "That player isn't on the Zab Bank board.");
      const have = su && isInt(su.zabBalance) ? su.zabBalance : 0;
      if (amount > have) throw err(402, "Not enough ZAB. You have " + have.toLocaleString("en-US") + " ZAB.");
      const r = rate && rate.day === today ? rate : { day: today, count: 0, total: 0 };
      if (r.count + 1 > DAILY_SENDS) throw err(429, "Daily send limit reached (" + DAILY_SENDS + " sends). Try again tomorrow.");
      if (r.total + amount > DAILY_ZAB) throw err(429, "Daily send limit reached (" + DAILY_ZAB.toLocaleString("en-US") + " ZAB). Try again tomorrow.");
      const rHave = isInt(ru.zabBalance) ? ru.zabBalance : 0;
      const toName = String(rb.name || ""), fromName = String((sb && sb.name) || "");
      const ts = fs.ts(), sBal = have - amount, rBal = rHave + amount;
      t.set(["users", from, "zabLedger", sId], { uid: from, type: "send", source: "transfer", amount: -amount, to, toName, key, createdAt: ts });
      t.set(["users", to, "zabLedger", rId], { uid: to, type: "receive", source: "transfer", amount, from, fromName, key, createdAt: ts });
      t.update(["users", from], { zabBalance: sBal, lastTxId: sId, updatedAt: ts });
      t.update(["users", to], { zabBalance: rBal, lastTxId: rId, updatedAt: ts });
      if (sb) t.update(["zabBoard", from], { total: sBal, updatedAt: ts });
      t.update(["zabBoard", to], { total: rBal, updatedAt: ts });
      t.set(["zabSendRate", from], { day: today, count: r.count + 1, total: r.total + amount });
      return { ok: true, amount, to, toName, balance: sBal };
    });
  }
  const api = { MAX_SEND, DAILY_SENDS, DAILY_ZAB, check, send };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.ZabTransfer = api;
})();
