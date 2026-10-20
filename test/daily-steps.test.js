// Tests for daily-steps.js. Run: node test/daily-steps.test.js
const D = require("../daily-steps.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("local date key pads", D.localDateKey(new Date(2026, 0, 5, 23, 59)) === "2026-01-05");
check("doc id", D.docId("abc", "2026-10-20") === "abc_2026-10-20");
check("clamp negative/NaN/cap", D.clampSteps(-3) === 0 && D.clampSteps("x") === 0 && D.clampSteps(99999) === 60000 && D.clampSteps(12.7) === 12);
check("web adds", D.addWeb(100, 25) === 125 && D.addWeb(59990, 50) === 60000);
check("native never lowers", D.mergeNative(500, 300) === 500 && D.mergeNative(500, 800) === 800);
const rec = D.buildRecord({ name: "  Jo ", xHandle: "@jojo", uid: "u1", date: "2026-10-20", steps: 4321.9, source: "native" });
check("record shape", rec.name === "Jo" && rec.xHandle === "@jojo" && rec.steps === 4321 && rec.source === "native");
check("no handle -> omitted", !("xHandle" in D.buildRecord({ uid: "u", date: "2026-10-20", steps: 1 })));
check("source defaults web", D.buildRecord({ uid: "u", date: "2026-10-20", steps: 1, source: "hack" }).source === "web");
check("valid record ok", D.validateRecord(rec, "u1_2026-10-20").ok);
check("wrong id rejected", !D.validateRecord(rec, "u2_2026-10-20").ok);
check("zero steps rejected", !D.validateRecord({ ...rec, steps: 0 }, "u1_2026-10-20").ok);
check("over cap rejected", !D.validateRecord({ ...rec, steps: 60001 }, "u1_2026-10-20").ok);
check("decrease rejected", !D.validateRecord(rec, "u1_2026-10-20", 5000).ok);
check("long name rejected", !D.validateRecord({ ...rec, name: "x".repeat(41) }, "u1_2026-10-20").ok);
const rows = [{ name: "a", date: "2026-10-20", steps: 10 }, { name: "b", date: "2026-10-19", steps: 99 }, { name: "c", date: "2026-10-20", steps: 50 }, { name: "d", date: "2026-10-20", steps: 0 }];
const top = D.rankDaily(rows, "2026-10-20");
check("rank today only, desc", top.length === 2 && top[0].name === "c");
const cap = (plugins, native = true) => ({ Capacitor: { isNativePlatform: () => native, Plugins: plugins } });
check("picks ZabbaSteps", D.pickSource(cap({ ZabbaSteps: { getTodaySteps() {} } })).name === "ZabbaSteps");
check("picks Pedometer", D.pickSource(cap({ Pedometer: { getTodaySteps() {} } })).name === "Pedometer");
check("plugin without method -> web", D.pickSource({ ...cap({ Pedometer: {} }), DeviceMotionEvent: function () {} }).kind === "web");
check("not native -> web", D.pickSource({ ...cap({ ZabbaSteps: { getTodaySteps() {} } }, false), DeviceMotionEvent: function () {} }).kind === "web");
check("nothing -> none", D.pickSource({}).kind === "none");
const mem = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } };
D.writeLocal(mem, "2026-10-20", 777);
check("local storage by date", D.readLocal(mem, "2026-10-20") === 777 && D.readLocal(mem, "2026-10-21") === 0);
// controller with fake native plugin
(async () => {
  const win = { ...cap({ ZabbaSteps: { async requestPermissions() { return { granted: true }; }, async getTodaySteps() { return { steps: 4200 }; } } }), localStorage: mem, addEventListener() {}, removeEventListener() {} };
  const c = D.createController(win, {});
  await c.refreshNative();
  check("controller native total", c.state().steps === 4200 && c.state().source === "native" && D.readLocal(mem, D.localDateKey()) === 4200);
  // web walk via fake motion events
  let handler = null;
  const det = { reset() {}, update: () => ({ added: 3 }) };
  const w2 = { DeviceMotionEvent: function () {}, localStorage: { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } },
    performance: { now: () => 1 }, addEventListener(t, f) { handler = f; }, removeEventListener() { handler = null; } };
  const c2 = D.createController(w2, { detectorFactory: () => det });
  await c2.startWalk(); handler({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } }); handler({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } });
  c2.stopWalk();
  check("web walk counts and stops", c2.state().steps === 6 && !c2.state().walking && handler === null);
  w2.DeviceMotionEvent.requestPermission = async () => "denied";
  const c3 = D.createController(w2, { detectorFactory: () => det });
  check("iOS denied -> no walk", (await c3.startWalk()) === false && !c3.state().walking);
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})();
