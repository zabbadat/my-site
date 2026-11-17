// Nov 17 (real iPhone): a set end on the frame that completes a rep dropped that rep, and the reason sat only in #pushStatus
// (off screen once the camera closed), so the set looked like it ended with no words. Run: node test/set-end-rep-order.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const count = html.indexOf('$("camNote").textContent = "Counted " + pushState.reps');
const fw = html.indexOf('const failed = failWatch.update(pose ? pose.keypoints');
check("rep count runs before the form-break set end in the pose tick", count > 0 && fw > count && fw - count < 2000);
check("finishPushSet hands its reason to exitPushCam", /exitPushCam\(endedBy\); \/\/ set over/.test(html));
check("camera note shows the reason", /function exitPushCam\(why\)/.test(html) && /"Set ended: " \+ why \+ "\. Camera off\."/.test(html));
console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
