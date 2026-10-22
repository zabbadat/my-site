// Battle seat names are visible to the opponent: they must never be an email address.
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0; const t = (n, f) => { f(); pass++; console.log("PASS  " + n); };
// Pull publicName + battleUser out of the page script and run them.
const grab = (re) => { const m = src.match(re); assert(m, "missing " + re); return m[0]; };
const code = grab(/function publicName\(s\) \{[\s\S]*?\n\}/) + "\n" + grab(/function battleUser\(\) \{[^\n]*\}/) + "\nfunction displayNameOf(u){return (u.displayName||u.email||'Player').trim().slice(0,40);}";
function run(playerVal, user) { const f = new Function("currentUser", "$", code + "\nreturn battleUser();"); return f(user, () => ({ value: playerVal })); }
t("email in board name is stripped to local part", () => assert.strictEqual(run("ann.lee@example.com", { uid: "u1" }).name, "ann.lee"));
t("email fallback (no display name) is stripped", () => assert.strictEqual(run("", { uid: "u1", email: "bob@example.com" }).name, "bob"));
t("normal name kept, capped at 20", () => assert.strictEqual(run("Player A", { uid: "u1" }).name, "Player A"));
t("X handle kept", () => assert.strictEqual(run("@zabba", { uid: "u1" }).name, "@zabba"));
t("signup clears auto-filled email board name", () => assert(/updateProfile\(cred\.user[^\n]*\n[^\n]*\n\s*if \(\$\("player"\)\.value\.trim\(\) === \(cred\.user\.email/.test(src)));
console.log("\n" + pass + "/5 passed");
