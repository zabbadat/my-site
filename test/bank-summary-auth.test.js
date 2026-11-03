// bank-summary needs a Firebase sign-in (same policy as the signed-in-only leaderboard). Run: node test/bank-summary-auth.test.js
const fsx = require("fs"), path = require("path");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || "{}";
const F = require("../netlify/functions/bank-summary.js");
(async () => {
  let r = await F.handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
  check("no credential: 401, no data", r.statusCode === 401 && !/holders/.test(r.body));
  r = await F.handler({ httpMethod: "GET", headers: { authorization: "Bearer not-a-real-credential" }, queryStringParameters: {} });
  check("bad credential: 401", r.statusCode === 401);
  r = await F.handler({ httpMethod: "POST", headers: {} });
  check("POST: 405", r.statusCode === 405);
  const src = fsx.readFileSync(path.join(__dirname, "../netlify/functions/bank-summary.js"), "utf8");
  check("no public cache / no open CORS any more", !/public, max-age/.test(src) && !/Access-Control-Allow-Origin/.test(src) && /private, max-age=60/.test(src));
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
