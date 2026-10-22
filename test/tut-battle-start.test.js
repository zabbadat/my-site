// TUT Battles: single Start battle button (sign-in, wake, camera + pose, then ready for shared countdown).
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let fails = 0; const check = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) { fails++; process.exitCode = 1; } };
const sec = html.slice(html.indexOf('<section id="tutbattles">'), html.indexOf("</section>", html.indexOf('<section id="tutbattles">')));
check("separate Turn on camera button removed", !/id="tbCam"/.test(html) && !/Turn on camera<\/button>/.test(html));
check("separate I'm ready button removed", !/id="tbReady"/.test(html) && !/\$\("tbReady"\)/.test(html) && !/\$\("tbCam"\)/.test(html));
check("one Start battle button in TUT Battles", (sec.match(/id="tbGo"/g) || []).length === 1 && />Start battle<\/button>/.test(sec));
const note = (sec.match(/<p class="note" id="tbGoNote"[^>]*>([^<]*)<\/p>/) || [])[1] || "";
check("camera note next to the button", /camera/i.test(note) && /Start battle/.test(note) && sec.indexOf('id="tbGoNote"') > sec.indexOf('id="tbGo"'));
// Behaviour: pull the handler out and run it with stubs.
const start = html.indexOf('$("tbGo").onclick = async () => {'), end = html.indexOf("\n};", start) + 3;
const src = html.slice(start, end).replace(/\r/g, "");
function run(o) {
  const log = [], el = { disabled: false }, $ = () => el;
  const env = { $, requireSignIn: (f) => { log.push("signin:" + f); return o.signed; }, battleUser: () => ({ uid: "me" }),
    tbRoom: { players: { me: { ready: !!o.ready } } }, tbCodeCur: "ABCD", tbStream: o.stream || null,
    tbWake: { start: () => { log.push("wake"); return Promise.resolve(); }, stop: () => { log.push("wakeStop"); return Promise.resolve(); } },
    tbCamOn: async () => { log.push("cam+pose"); return o.camOk !== false; },
    tb: { setReady: async (c, u, v) => { log.push("ready:" + v); } }, tbStat: (m) => log.push("stat:" + m) };
  const fn = new Function(...Object.keys(env), "let h;" + src.replace('$("tbGo").onclick =', "h =") + "\nreturn h;")(...Object.values(env));
  return fn().then(() => ({ log, el }));
}
(async () => {
  let r = await run({ signed: true });
  check("tap order: sign-in, wake, camera+pose, then ready", r.log.join(",") === "signin:tut battle,wake,cam+pose,ready:true");
  check("button re-enabled after start", r.el.disabled === false);
  r = await run({ signed: false });
  check("not signed in: stops at sign-in prompt, no camera", r.log.join(",") === "signin:tut battle");
  r = await run({ signed: true, camOk: false });
  check("camera blocked: wake released, not marked ready", r.log.includes("wakeStop") && !r.log.some((x) => x.startsWith("ready")));
  r = await run({ signed: true, stream: {} });
  check("camera already on: skips re-opening, marks ready", !r.log.includes("cam+pose") && r.log.includes("ready:true"));
  r = await run({ signed: true, ready: true });
  check("tapping Not ready un-readies without camera", r.log.join(",") === "signin:tut battle,ready:false");
  check("wake starts before the first await", src.indexOf("tbWake.start()") < src.indexOf("await tbCamOn"));
  check("Plank House 1.5s calibration unchanged", /readyMs: 1500/.test(fs.readFileSync(path.join(__dirname, "..", "plank-session.js"), "utf8")));
  check("countdown lead still 5s", /LEAD_MS = 5000/.test(fs.readFileSync(path.join(__dirname, "..", "battle-rooms.js"), "utf8")));
})();
