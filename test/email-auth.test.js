// Tests for email-auth.js. Run: node test/email-auth.test.js
const A = require("../email-auth.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const ok = { name: "Zab", email: "a@b.co", password: "secret1", confirm: "secret1" };
check("valid signup", A.validate("signup", ok) === "");
check("needs name", /name/.test(A.validate("signup", { ...ok, name: " " })));
check("bad email", /valid email/.test(A.validate("signup", { ...ok, email: "a@b" })));
check("short pw", /6/.test(A.validate("signup", { ...ok, password: "12345", confirm: "12345" })));
check("mismatch", /match/.test(A.validate("signup", { ...ok, confirm: "secret2" })));
check("signin no name/confirm", A.validate("signin", { email: "a@b.co", password: "secret1" }) === "");
check("reset only email", A.validate("reset", { email: "a@b.co" }) === "");
check("op not allowed", A.friendlyError({ code: "auth/operation-not-allowed" }) === "Email sign-up isn't enabled yet. Please use Google or X for now.");
for (const c of ["email-already-in-use", "weak-password", "invalid-email", "wrong-password", "invalid-credential"])
  check("msg " + c, !/went wrong/.test(A.friendlyError({ code: "auth/" + c })));
check("unknown", /went wrong/.test(A.friendlyError({})));
if (R.includes(false)) process.exit(1);
