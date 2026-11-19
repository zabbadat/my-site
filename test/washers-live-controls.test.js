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
check("youtubeConfigured exported", typeof L.youtubeConfigured === "function");
(async function () {
  const prev = global.fetch;
  try {
    global.fetch = async (url, opts) => {
      if (String(url).indexOf("/.netlify/functions/youtube-whip") < 0) throw new Error("unexpected url " + url);
      if (!opts || opts.method !== "POST") throw new Error("probe must POST");
      return { json: async () => ({ configured: false }) };
    };
    const cfg = await L.youtubeConfigured();
    check("probe: unset relay is configured false, no whipUrl", cfg && cfg.configured === false && !("whipUrl" in cfg));
    global.fetch = async () => { throw new Error("network down"); };
    const down = await L.youtubeConfigured();
    check("probe: fetch failure degrades to configured false", down && down.configured === false);
  } finally {
    if (prev === undefined) delete global.fetch; else global.fetch = prev;
  }
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("YouTube button starts hidden in the markup", /id="zlYtBtn"[^>]*\bhidden\b/.test(html));
  check("YouTube button stays hidden unless the relay probe says it is configured", html.includes("yt.hidden = !zlYtReady") && html.includes("youtubeConfigured"));
  check("unconfigured YouTube click says coming soon and does not start WHIP", html.includes('zlCastNote("YouTube coming soon")') && html.includes("if (!cfg || !cfg.configured)"));
  check("user-facing YouTube note does not mention a docs path", !/YouTube coming soon[\s\S]{0,80}docs\//.test(html));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
