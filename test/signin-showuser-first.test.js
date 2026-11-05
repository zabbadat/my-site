// The signed-in screen must update before balance/leaderboard snapshots.
// A throw in zabOnUser or onSnapshot must not leave a real session looking signed out.
// Run: node test/signin-showuser-first.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok, why) => { console.log((ok ? "PASS" : "FAIL") + "  " + n + (ok || !why ? "" : " :: " + why)); R.push(!!ok); };
const start = html.indexOf("onAuthStateChanged(auth, (u) =>");
const end = html.indexOf("onAuthStateChanged(auth, boardsOnUser)");
const cb = html.slice(start, end);
const show = cb.indexOf("showUser(u)");
const zab = cb.indexOf("zabOnUser(u)");
const snap = cb.indexOf("onSnapshot(");
check("auth listener calls showUser before zabOnUser and before any snapshot", cb.startsWith("onAuthStateChanged(auth, (u) => { showUser(u); zabOnUser(u);") && show < zab && zab < snap, "show " + show + " zab " + zab + " snap " + snap);
check("that listener calls showUser once", cb.split("showUser(u)").length === 2);
check("Google popup handler is unchanged: one signInWithPopup, errors go to setStatus", /\$\("signInBtn"\)\.onclick = async \(\) => \{\s*try \{\s*await signInWithPopup\(auth, provider\);/.test(html) && /setStatus\("Google sign-in failed: "/.test(html));
check("hidden controls stay hidden against .btn display", /\[hidden\] \{ display: none !important; \}/.test(html));

// Offline order check: a synchronous throw after showUser cannot undo the session flag.
function run(order) {
  let shown = null;
  const showUser = (u) => { shown = !!(u && u.uid); };
  const zabOnUser = () => { throw new Error("snapshot"); };
  try { order(showUser, zabOnUser, { uid: "u" }); } catch (e) {}
  return shown;
}
check("old order: throw before showUser leaves session unshown", run((showUser, zabOnUser, u) => { zabOnUser(u); showUser(u); }) === null);
check("new order: throw after showUser keeps the session shown", run((showUser, zabOnUser, u) => { showUser(u); zabOnUser(u); }) === true);
console.log("\n" + R.filter(Boolean).length + "/" + R.length + " passed");
process.exit(R.every(Boolean) ? 0 : 1);
