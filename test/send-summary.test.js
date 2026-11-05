// send-summary: key-gated recent transfers (names/amounts/times only). Run: node test/send-summary.test.js
const fsx = require("fs"), path = require("path");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || "{}";
delete process.env.ZAB_BANK_READ_KEY;
const F = require("../netlify/functions/send-summary.js");
const { readKeyOk } = require("../netlify/lib/read-key");
(async () => {
  const KEY = "unit-test-bank-read-key-bbbbbbbb";
  let r = await F.handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
  check("no key: 401", r.statusCode === 401);
  r = await F.handler({ httpMethod: "POST", headers: {} });
  check("POST: 405", r.statusCode === 405);
  r = await F.handler({ httpMethod: "GET", headers: { "x-zab-read-key": KEY }, queryStringParameters: {} });
  check("key header but env missing: 401", r.statusCode === 401);

  process.env.ZAB_BANK_READ_KEY = KEY;
  r = await F.handler({ httpMethod: "GET", headers: { "x-zab-read-key": "nope" }, queryStringParameters: {} });
  check("wrong key: 401", r.statusCode === 401);
  r = await F.handler({ httpMethod: "GET", headers: { authorization: "Bearer not-firebase-and-not-key" }, queryStringParameters: {} });
  check("signed-in-looking Bearer that is not the key: 401 (sign-in is not enough)", r.statusCode === 401);
  r = await F.handler({ httpMethod: "GET", headers: { "x-zab-read-key": KEY }, queryStringParameters: {} });
  check("valid key: not 401", r.statusCode !== 401);

  const rows = F.summarizeSends([
    { source: "transfer", type: "send", amount: -12.3, fromName: "Ann", toName: "Bob", uid: "uidAnn", to: "uidBob", createdAt: "2026-11-05T12:00:00.000Z" },
    { source: "transfer", type: "receive", amount: 12.3, fromName: "Ann", toName: "Bob", createdAt: "2026-11-05T12:00:00.000Z" },
    { source: "earn", type: "earn", amount: 1, createdAt: "2026-11-05T12:00:00.000Z" },
    { source: "transfer", type: "send", amount: -0.5, fromName: "Bob", toName: "Ann", uid: "uidBob", to: "uidAnn", createdAt: "2026-11-05T12:05:00.000Z" },
    { source: "transfer", type: "send", amount: -2, fromName: "eve@example.com", toName: "Ann", uid: "uidEve", to: "uidAnn", createdAt: "2026-11-05T12:06:00.000Z" }
  ]);
  check("only send/transfer rows, newest first", rows.length === 3 && rows[0].at === "2026-11-05T12:06:00.000Z" && rows[1].from === "Bob" && rows[1].to === "Ann" && rows[1].amount === 0.5);
  check("tenths preserved", rows.find((x) => x.from === "Ann").amount === 12.3);
  check("email-looking name replaced, no raw email", rows.every((x) => x.from.indexOf("@") < 0 && x.to.indexOf("@") < 0) && rows.some((x) => /^Zabba #/.test(x.from)));
  const dumped = JSON.stringify(rows);
  check("no uids in summary rows", !/uidAnn|uidBob|uidEve/.test(dumped) && !/"uid"/.test(dumped) && !/"to":"uid/.test(dumped));

  const src = fsx.readFileSync(path.join(__dirname, "../netlify/functions/send-summary.js"), "utf8");
  check("handler is GET and never writes", /httpMethod !== "GET"/.test(src) && !/\.set\(|\.update\(|\.delete\(/.test(src));

  delete process.env.ZAB_BANK_READ_KEY;
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
