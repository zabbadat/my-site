// bank-summary needs a Firebase sign-in or the read-only ZAB_BANK_READ_KEY. Run: node test/bank-summary-auth.test.js
const fsx = require("fs"), path = require("path");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || "{}";
delete process.env.ZAB_BANK_READ_KEY;
const F = require("../netlify/functions/bank-summary.js");
const { readKeyOk } = require("../netlify/lib/read-key");
(async () => {
  let r = await F.handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
  check("no credential: 401, no data", r.statusCode === 401 && !/holders/.test(r.body));
  r = await F.handler({ httpMethod: "GET", headers: { authorization: "Bearer not-a-real-credential" }, queryStringParameters: {} });
  check("bad credential: 401", r.statusCode === 401);
  r = await F.handler({ httpMethod: "POST", headers: {} });
  check("POST: 405", r.statusCode === 405);
  const src = fsx.readFileSync(path.join(__dirname, "../netlify/functions/bank-summary.js"), "utf8");
  check("no public cache / no open CORS any more", !/public, max-age/.test(src) && !/Access-Control-Allow-Origin/.test(src) && /private, max-age=60/.test(src));
  check("Vary includes the read-key header", /X-Zab-Read-Key/.test(src));

  const KEY = "unit-test-bank-read-key-aaaaaaaa";
  check("missing env: key path disabled even with header", readKeyOk({ headers: { "x-zab-read-key": KEY } }) === false);
  r = await F.handler({ httpMethod: "GET", headers: { "x-zab-read-key": KEY }, queryStringParameters: {} });
  check("header present but env missing: 401", r.statusCode === 401);

  process.env.ZAB_BANK_READ_KEY = KEY;
  check("wrong key rejected", readKeyOk({ headers: { "x-zab-read-key": "nope" } }) === false);
  check("empty header rejected", readKeyOk({ headers: { "x-zab-read-key": "" } }) === false);
  check("X-Zab-Read-Key accepted", readKeyOk({ headers: { "X-Zab-Read-Key": KEY } }) === true);
  check("lowercase header accepted", readKeyOk({ headers: { "x-zab-read-key": KEY } }) === true);
  check("Bearer key accepted", readKeyOk({ headers: { authorization: "Bearer " + KEY } }) === true);
  check("Bearer wrong rejected", readKeyOk({ headers: { authorization: "Bearer " + KEY + "x" } }) === false);

  r = await F.handler({ httpMethod: "GET", headers: { "x-zab-read-key": "wrong-key" }, queryStringParameters: {} });
  check("handler wrong key: 401", r.statusCode === 401);
  r = await F.handler({ httpMethod: "GET", headers: { "x-zab-read-key": KEY }, queryStringParameters: {} });
  check("handler valid key: not 401 (auth passed; firestore may 500 in unit tests)", r.statusCode !== 401);
  r = await F.handler({ httpMethod: "GET", headers: { authorization: "Bearer " + KEY }, queryStringParameters: {} });
  check("handler Bearer key: not 401", r.statusCode !== 401);

  delete process.env.ZAB_BANK_READ_KEY;
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
