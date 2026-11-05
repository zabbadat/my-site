// The bank read key is accepted only by bank-summary and send-summary, never by write functions.
const fsx = require("fs"), path = require("path");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || "{}";
process.env.ZAB_EARN_SINCE = process.env.ZAB_EARN_SINCE || "1";
const KEY = "unit-test-bank-read-key-cccccccc";
process.env.ZAB_BANK_READ_KEY = KEY;
const headers = { "x-zab-read-key": KEY, authorization: "Bearer " + KEY };

const allowed = ["bank-summary.js", "send-summary.js"];
const denied = ["zab-send.js", "wager-stake.js", "wager-settle.js", "wager-pot.js", "wager-sweep.js", "rep-settle.js", "zab-earn.js", "zab-board.js"];
const dir = path.join(__dirname, "../netlify/functions");

(async () => {
  for (const name of denied) {
    const src = fsx.readFileSync(path.join(dir, name), "utf8");
    check(name + " source does not mention the read key", !/ZAB_BANK_READ_KEY|X-Zab-Read-Key|read-key/.test(src));
  }
  for (const name of allowed) {
    const src = fsx.readFileSync(path.join(dir, name), "utf8");
    check(name + " source uses the read-key helper", /read-key/.test(src) && /ZAB_BANK_READ_KEY/.test(src));
  }

  const writers = [
    ["zab-send.js", { httpMethod: "POST", headers, body: "{}" }],
    ["wager-stake.js", { httpMethod: "POST", headers, body: "{}" }],
    ["wager-settle.js", { httpMethod: "POST", headers, body: "{}" }],
    ["wager-pot.js", { httpMethod: "POST", headers, body: "{}" }],
    ["rep-settle.js", { httpMethod: "POST", headers, body: "{}" }],
    ["zab-earn.js", { httpMethod: "POST", headers, body: "{}" }],
    ["zab-board.js", { httpMethod: "POST", headers, body: "{}" }]
  ];
  for (const [name, event] of writers) {
    const F = require(path.join(dir, name));
    const r = await F.handler(event);
    check(name + " rejects the read key (not 200)", r.statusCode !== 200 && r.statusCode !== 201);
    check(name + " does not accept the key as write access (401 or later auth/input error, never a send/wager success)", r.statusCode === 401 || (r.statusCode >= 400 && r.statusCode !== 200));
  }

  delete process.env.ZAB_BANK_READ_KEY;
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
