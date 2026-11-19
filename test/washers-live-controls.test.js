const L = require("../washers-live-controls.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("clock text waiting is 0:00", L.matchClockText({ status: "waiting" }, "ABCDE", 50_000, (x) => x) === "0:00");
check("clock text active from seq 0 turnAt, no new firestore field", L.matchClockText({ status: "active", seq: 0, turnAt: 10_000 }, "ABCDE", 40_000, (x) => x) === "0:30");
check("gum constraints: deviceId exact, else facingMode; audio AEC on", (function () {
  const a = L.gumConstraints("environment", true);
  const b = L.gumConstraints("user", true, "osmo-1");
  const c = L.gumConstraints("user", false);
  return a.audio && a.audio.echoCancellation && a.video.facingMode.ideal === "environment"
    && b.video.deviceId.exact === "osmo-1" && c.audio === false;
})());
check("listCameras / startWhip / coveredStream exported", typeof L.listCameras === "function" && typeof L.startWhip === "function" && typeof L.coveredStream === "function" && typeof L.prepareAudio === "function");
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
