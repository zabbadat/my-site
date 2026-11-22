// Plank count voice (owner Nov 17): iOS WKWebView / some WebViews drop utterances passed to
// speechSynthesis.speak() while another line is still speaking (or queued from a timer before onend).
// The live cue must still speak Set up, hold on three. / One / two / three / Hold, one after the
// previous ends, and start the clock on Hold. interruptSpeak must not cancel that sequence.
// Run: node test/plank-count-voice.test.js
const G = require("../get-set.js"), fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log((ok ? "PASS  " : "FAIL  ") + n); R.push(!!ok); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function iosSynth(dur) {
  // Drops speak() while speaking (no queue). onend after `dur` ms when a word is accepted.
  const ss = {
    speaking: false, pending: false, cancelled: 0, spoken: [], dropped: [], resumed: 0, _cur: null,
    resume() { this.resumed++; },
    cancel() {
      this.cancelled++; this.speaking = false; this.pending = false;
      const u = this._cur; this._cur = null;
      if (u && u.onerror) setTimeout(() => u.onerror({ error: "canceled" }), 0);
    },
    speak(u) {
      if (this.speaking) { this.dropped.push(u.text); return; }
      this.speaking = true; this._cur = u; this.spoken.push(u.text);
      const hold = dur == null ? 350 : dur;
      if (hold < 0) return; // never ends: fallback test
      setTimeout(() => { this.speaking = false; this._cur = null; if (u.onend) u.onend(); }, hold);
    }
  };
  return ss;
}
function install(ss) {
  const w = { speechSynthesis: ss, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  global.window = w; global.self = w;
  return ss;
}

check("page wires waitEnd + protect so counts run on utterance end and cannot be cancelled",
  /makeGoCountdown\(\{ steps: window\.ZabbadatGetSet\.PLANK_STEPS, speak: window\.ZabbadatGetSet\.plankSpeak, stop: \(\) => \{\}, waitEnd: true, protect: true \}\)/.test(html));
check("plankCue no longer force-starts the count on a 5 s speech-idle cap (that queued counts under the intro)",
  !/waited >= 5000/.test(html) && /waitEnd/.test(html));

(async () => {
  // --- bug reproduction: timer cue + iOS drop-while-speaking ---
  {
    const ss = install(iosSynth(2000));
    ss.speaking = true; // intro still playing
    const said = [];
    const cd = G.makeGoCountdown({
      steps: G.PLANK_STEPS,
      speak: (w) => { said.push(w); ss.speak(new window.SpeechSynthesisUtterance(w)); },
      stop: () => {},
      waitEnd: false
    });
    const done = cd.run(() => {});
    await wait(50);
    check("BUG shape: timer cue calls speak() for One while the intro is still talking", said[0] === "One");
    check("BUG shape: iOS-like synth drops that One (and later ticks would drop too)", ss.dropped.includes("One") && ss.spoken.length === 0);
    cd.cancel();
    await Promise.resolve(done).catch(() => {});
  }

  // --- fix: waitEnd waits for the intro to end, then speaks each count on onend ---
  {
    const ss = install(iosSynth(300));
    G.plankSpeak("Go on, hold on three."); // still speaking when the cue starts
    const shown = [];
    let doneAt = null, started = Date.now();
    const cd = G.makeGoCountdown({ steps: G.PLANK_STEPS, speak: G.plankSpeak, stop: () => {}, waitEnd: true, protect: true });
    const p = cd.run((t) => shown.push(t)).then((ok) => { doneAt = { ok, ms: Date.now() - started }; return ok; });
    await wait(80);
    check("waitEnd: does not speak One while the intro is still talking", !ss.spoken.includes("One") && ss.dropped.length === 0 && ss.spoken[0] === "Go on, hold on three.");
    const ok = await p;
    check("waitEnd: intro then One, two, three, hold, each accepted (none dropped)",
      ss.dropped.length === 0 && ss.spoken.join("|") === "Go on, hold on three.|One|two|three|hold");
    check("waitEnd: on-screen digits 1 2 3 HOLD", shown.join("|") === "1|2|3|hold");
    check("waitEnd: run() resolves true at Hold (clock starts when Hold is spoken)", ok === true && doneAt && doneAt.ok === true);
    const iHold = ss.spoken.indexOf("hold"), iThree = ss.spoken.indexOf("three");
    check("waitEnd: Hold is spoken after three, not queued under it", iHold === iThree + 1 && iHold === 4);
  }

  // --- interruptSpeak during a protected cue must not cancel / drop counts ---
  {
    const ss = install(iosSynth(300));
    const cd = G.makeGoCountdown({ steps: G.PLANK_STEPS, speak: G.plankSpeak, stop: G.defaultStop ? undefined : () => {}, waitEnd: true, protect: true });
    const p = cd.run(() => {});
    await wait(80); // One is speaking
    G.interruptSpeak("Set complete.");
    const ok = await p;
    check("protect: interruptSpeak during the cue does not cancel the engine", ss.cancelled === 0 && !ss.spoken.includes("Set complete."));
    check("protect: One, two, three, hold all still spoken", ok === true && ss.spoken.join("|") === "One|two|three|hold" && ss.dropped.length === 0);
  }

  // --- onend never fires: timed fallback still advances and reaches Hold ---
  {
    const ss = {
      speaking: false, pending: false, cancelled: 0, spoken: [], dropped: [],
      resume() {}, cancel() { this.cancelled++; },
      speak(u) { this.spoken.push(u.text); } // accepted, but onend never fires
    };
    install(ss);
    const t0 = Date.now();
    const cd = G.makeGoCountdown({ steps: G.PLANK_STEPS, speak: G.plankSpeak, stop: () => {}, waitEnd: true, protect: true, idleMaxMs: 200 });
    const ok = await Promise.race([cd.run(() => {}), wait(12000).then(() => "timeout")]);
    const ms = Date.now() - t0;
    check("fallback: when onend never fires, One / two / three / Hold are still spoken and the cue finishes",
      ok === true && ss.spoken.join("|") === "One|two|three|hold" && ms >= 4000 && ms < 11000, { ok, spoken: ss.spoken, ms });
  }

  delete global.window; delete global.self;
  const fails = R.filter((x) => !x).length;
  console.log(`\n${R.length - fails}/${R.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL  harness", e); process.exit(1); });
