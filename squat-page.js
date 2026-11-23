/* Gyatt Squats page glue (#squats): front camera -> pose -> squat-session.js; spoken cadence (gyatt-cadence.js) as
 * pacing guidance only; face logo (ZabPfp.frame, public API only) on every pose frame from camera open; Start set is
 * the only start button, End set (on the camera, same muted 52 px fallback as push-ups / plank) the manual stop.
 * The shared camera / pose / sign-in / save / ZAB helpers come from the page module through window.ZabSquatHost.
 * Flow: tap Start set -> camera opens (setup line spoken in the tap) -> pose + logo run -> placement and stance
 * (wide, toes out, glutes the whole way) -> "Gyatt squat on three." One, two, three, Go (standing baseline
 * calibrated during this countdown) -> set clock starts at Go, the cadence starts 1 s after Go (so "Go" is not cut off)
 * -> reps counted from pose only (reach parallel, then stand back up). Faster or slower than the voice never fails a rep.
 * Voice in the set (gyatt-cadence.js): "Down, one, two, three, four" / "Hold, one, two, three, four" / a single "Up" /
 * a short "Squeeze", then the next "Down, one". No rep number is ever spoken. Coaching lines go through cadence.coach()
 * so they never talk over a count (spoken in the quiet gap after Squeeze, or by the caller when the cadence is idle).
 * A set is ten reps: the tenth counted pose rep ends the set (reason set_done). Squeeze still plays, then "Set complete."
 * and the loop stops; the camera closes, the panel shows "Set done" and the button reads "Start next set"
 * (no setup talk on a restart). A completed set saves once and pays 1 ZAB (10 squats).
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  if (!$("sqStartBtn")) return;
  var SQ = window.ZabbadatSquat, SS = window.ZabbadatSquatSession, GC = window.GyattCadence, GS = window.ZabbadatGetSet;
  var CADENCE_LEAD_MS = 1000, COACH_EVERY_MS = 8000;
  // Every spoken squat line outside the cadence cues (short, plain, no numbers):
  var SAY = {
    start: "Gyatt squat on three.", // then One · two · three · Go (shared get-set timing); standing baseline calibrates meanwhile
    theme: "Stay under tension: down, hold, and up.",
    missing: "Step back into view.", moved: "Stay on your spot.", bent: "Squat, don't bend over.",
    half: "Lower to parallel", chest: "Chest up", knees: "Knees out", stance: "Stand wider, toes out.",
    end: { stall_bottom: "Set over. You stayed down too long.", no_rep: "Set over. No squats for a while.", sat: "Set over. You sat down.",
      hands_down: "Set over. Hands on the floor.", left_frame: "Set over. You left the frame.", max_reps: "Set over." }
  };
  var st = { starting: false, running: false, seq: 0, loopId: 0, stream: null, counter: null, set: null, calibrating: false, startedAt: 0, cadenceTimer: null, countdown: null };
  var host = function () { return window.ZabSquatHost || null; };
  var now = function () { return performance.now(); };

  var cadence = GC ? GC.makeCadence({
    onPhase: function (phase, count, rep, info) {
      window.__sqCadence = (window.__sqCadence || []).concat([{ phase: phase, count: count, rep: rep, word: info.word, spoken: info.spoken, t: now() }]).slice(-200);
      if (!st.running) return; // the closing top beat after a finished set does not repaint "Set done"
      if ($("sqHudCount")) $("sqHudCount").textContent = String(count);
      if ($("sqHudPhase")) $("sqHudPhase").textContent = info.label;
      if ($("sqCount")) $("sqCount").textContent = String(count);
      if ($("sqPhase")) $("sqPhase").textContent = info.label;
    },
    // pose hook is unused for counting: the voice is guidance only and never fails or resyncs a pose rep
  }) : null;

  function paintDay() {
    if (!SS) return; var d = SS.getDay(localStorage);
    if ($("sqRepsToday")) $("sqRepsToday").textContent = String(d.reps);
    if ($("sqSetsToday")) $("sqSetsToday").textContent = String(d.sets);
  }
  function midnightRepaint() { setTimeout(function () { paintDay(); midnightRepaint(); }, SS ? SS.msToMidnight() + 1000 : 3600000); }
  function paintReps(n) { if ($("sqReps")) $("sqReps").textContent = String(n); if ($("sqHudReps")) $("sqHudReps").textContent = String(n); }
  function msg(t) { if ($("sqMsg")) $("sqMsg").textContent = t; }
  function status(t) { if ($("sqStatus")) $("sqStatus").textContent = t; }
  function speak(line) { try { if (GS && GS.plankSpeak) GS.plankSpeak(line); } catch (e) {} }
  function fmtTut(ms) {
    var t = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    var ss = (sec < 10 ? "0" : "") + sec;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }
  function paintTut(ms) { var s = fmtTut(ms); if ($("sqHudTut")) $("sqHudTut").textContent = s; }

  function nextFrame(vid, fn) { if (vid && typeof vid.requestVideoFrameCallback === "function") vid.requestVideoFrameCallback(function () { fn(); }); else requestAnimationFrame(fn); }
  function frameMsg(r) {
    if (r.frame === "missing") return "Step back into view";
    if (r.guard === "moved") return "Stay on your spot";
    if (r.guard === "bent") return "Squat, don't bend over";
    if (st.halfUntil && now() < st.halfUntil) return "Lower to parallel";
    if (r.kneesCave) return "Knees out";
    if (r.chestDown) return "Chest up";
    if (r.stanceNarrow && r.phase === "top") return "Stand wider, toes out";
    if (r.phase === "bottom") return "Hold. Glutes working";
    if (r.phase === "up") return "Stand all the way up. Squeeze at the top";
    if (r.phase === "down") return "Sit back, lower to parallel";
    return "Gyatt squat";
  }
  // in-set coaching voice: one line per kind at most every 8 s, routed through the cadence so it never overlaps a cue
  function coach(kind) {
    var t = now(); st.coachAt = st.coachAt || {};
    if (st.coachAt[kind] && t - st.coachAt[kind] < COACH_EVERY_MS) return;
    st.coachAt[kind] = t;
    var line = SAY[kind]; if (!line) return;
    if (!cadence || cadence.coach(line) === "idle") speak(line);
  }
  function coachFor(r) {
    if (r.frame === "missing") { st.missSince = st.missSince || now(); if (now() - st.missSince >= 1000) coach("missing"); return; }
    st.missSince = 0;
    if (r.guard === "moved") return coach("moved");
    if (r.guard === "bent") return coach("bent");
    if (r.event === "half") { st.halfUntil = now() + 2000; coach("half"); return; }
    if (r.kneesCave) return coach("knees");
    if (r.chestDown) return coach("chest");
    if (r.stanceNarrow && r.phase === "top") return coach("stance");
  }
  async function tick(id) {
    if (id !== st.loopId) return;
    var vid = $("sqVid"), H = host();
    try {
      var det = await H.ensurePose();
      var t = now();
      var poses = await det.estimatePoses(window.ZabPfp && window.ZabPfp.input ? window.ZabPfp.input(vid, det) : vid, { flipHorizontal: true });
      if (id !== st.loopId) return;
      var p = poses && poses[0], kps = p ? p.keypoints : [];
      if (window.ZabPfp) window.ZabPfp.frame(vid, kps, t); // face logo from camera open, same keypoints; visual only, never throws
      var extra = p ? { knee3D: p.knee3D, pose3d: p.pose3d } : null;
      if (st.calibrating && st.counter) st.counter.calibrate(kps, t);
      if (st.running && st.set) {
        var r = st.set.update(kps, t, extra);
        if (r.ended) { endSet(r); return; }
        paintReps(r.reps); paintTut(r.tutMs);
        // Reps come from pose only. Do not resync the voice when a squat finishes early or late — that jump
        // used to yank the cadence to Squeeze and fight the next descent.
        coachFor(r);
        msg(frameMsg(r));
      }
    } catch (e) { status("Pose paused."); }
    if (id === st.loopId) nextFrame(vid, function () { tick(id); });
  }
  function closeCam() {
    st.loopId += 1;
    try { if (window.ZabPfp && window.ZabPfp.clear) window.ZabPfp.clear("sqVid"); } catch (e) {}
    var H = host();
    if (st.stream) { try { st.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} st.stream = null; }
    if ($("sqVid")) $("sqVid").srcObject = null;
    if ($("sqWrap")) $("sqWrap").hidden = true;
    if (H) { H.camFs("sqWrap", false); if (H.wake) H.wake.stop().catch(function () {}); }
  }
  function stopCadence() { if (st.cadenceTimer) { clearTimeout(st.cadenceTimer); st.cadenceTimer = null; } if (cadence) cadence.stop("set"); }
  function setStartLabel(next) { $("sqStartBtn").textContent = next ? "Start next set" : "Start set"; }
  function cancelStart(text) {
    st.seq += 1; st.starting = false; st.calibrating = false;
    if (st.countdown && st.countdown.cancel) st.countdown.cancel();
    stopCadence(); closeCam();
    $("sqStartBtn").disabled = false;
    if (text) status(text);
  }
  function endSet(r) {
    if (!st.running) return;
    st.running = false; st.calibrating = false;
    var done = r.reason === "set_done";
    if (st.cadenceTimer) { clearTimeout(st.cadenceTimer); st.cadenceTimer = null; }
    // Set complete: Squeeze plays, then "Set complete." and the loop stops. Any other end: cut the cadence,
    // then one short "Set over." line (End set is silent).
    if (done && cadence) cadence.complete(null, r.reps); else { stopCadence(); if (done) speak(GS && GS.SET_DONE_LINE ? GS.SET_DONE_LINE : "Set complete."); else if (SAY.end[r.reason]) speak(SAY.end[r.reason]); }
    closeCam();
    var H = host(); if (H) H.sessionTouch();
    $("sqStartBtn").disabled = false; setStartLabel(true);
    paintReps(r.reps);
    if ($("sqPhase")) $("sqPhase").textContent = done ? "Set done" : "Cadence";
    if ($("sqCount")) $("sqCount").textContent = done ? "\u2713" : "\u2013";
    paintTut(r.tutMs);
    var tutBit = r.tutMs != null ? " Time under tension " + fmtTut(r.tutMs) + "." : "";
    msg(done ? "Set done! " + r.reps + " squats · TUT " + fmtTut(r.tutMs || 0) : "Set over: " + r.reps + (r.reps === 1 ? " squat" : " squats") + " · TUT " + fmtTut(r.tutMs || 0));
    var day = SS.recordSet(localStorage, r.reps);
    paintDay();
    var line = (done ? "Set done: ten reps." : "Set ended: " + r.why + ". " + r.reps + (r.reps === 1 ? " squat" : " squats") + (r.halfReps ? " (" + r.halfReps + " not deep enough)" : "") + ".") + tutBit + (r.reps > 0 ? " Set " + day.sets + " today." : "") + " Tap Start next set when ready.";
    status(line);
    window.__sqLast = r;
    if (!(r.reps > 0) || !H) return;
    if (!H.user()) { status(line + " Sign in to save sets and earn ZAB."); return; }
    H.save({ name: H.playerName(), reps: r.reps, ms: r.ms, sessionStartedAt: st.startedAt }).then(function (id) {
      status(line + " Saved.");
      if (r.reps >= 10) H.award(id) // once per saved set; the claim is keyed to this set's id, so it can't pay twice.then(function (tk) { status($("sqStatus").textContent + H.zabNote(tk)); H.zabRing($("sqStatus")); }, function () {});
    }, function () { status(line + " Saved on this phone (board offline)."); });
  }
  function endNow() {
    if (st.starting) { cancelStart("Start cancelled."); return; }
    if (st.running && st.set) endSet(st.set.stop(now(), "stopped"));
  }
  async function start() {
    var H = host();
    if (st.running || st.starting) return;
    if (!H || !SQ || !SS) { status("Loading… try again in a moment."); return; }
    if (!H.requireSignIn("squats", start, { practice: true })) return;
    if (H.wake) H.wake.start().catch(function () {}); // inside the tap
    H.unlockGetSet(); // iOS: unlock speech inside the tap
    var my = ++st.seq, live = function () { return my === st.seq; };
    st.starting = true; $("sqStartBtn").disabled = true;
    try {
      H.stopOtherCams();
      var restart = H.sessionPlan("squats") === "restart";
      var C = GS && GS.coachLines ? GS.coachLines("squats") : null;
      if (!restart && C) { status(C.place); speak(C.place); } else status("Starting camera…");
      var vid0 = $("sqVid");
      $("sqWrap").hidden = false; H.camFs("sqWrap", true);
      try { if (window.ZabPfp && window.ZabPfp.prepare && vid0) window.ZabPfp.prepare(vid0); } catch (e) {}
      var gum = navigator.mediaDevices.getUserMedia(H.CAM_CONSTRAINTS);
      H.ensurePose().catch(function () {}); // pose model loads while the camera opens; the feed does not wait
      var stream = await gum;
      if (!live()) { H.stopCamTracks(stream); return; }
      st.stream = stream;
      var vid = $("sqVid"); await H.attachCam(vid, stream);
      await H.ensurePose();
      if (!live()) return;
      st.counter = SQ.createCounter(); paintReps(0);
      tick(++st.loopId); // pose + face logo from camera open (before Go)
      if (!restart && C && GS.sayAndWait) { status(C.criteria); msg("Whole body in view"); if (!(await GS.sayAndWait(GS.withCameraOn ? GS.withCameraOn(C.criteria) : C.criteria, { minMs: 2000, maxMs: 22000, cancelled: function () { return !live(); }, now: now }))) return; }
      if (!restart && SAY.theme && GS && GS.sayAndWait) { status(SAY.theme); if (!(await GS.sayAndWait(SAY.theme, { minMs: 0, maxMs: 8000, cancelled: function () { return !live(); }, now: now }))) return; }
      if (!live()) return;
      st.calibrating = true; // standing baseline from the "Gyatt squat on three. One, two, three, Go" frames
      st.countdown = GS && GS.makeNextSetCountdown ? GS.makeNextSetCountdown({ line: SAY.start }) : null;
      var show = function (t) { msg(t); if ($("sqHudCount")) $("sqHudCount").textContent = t.length > 4 ? "…" : t; if ($("sqHudPhase")) $("sqHudPhase").textContent = "Get set"; };
      var go = st.countdown ? await st.countdown.run(show, function () { return !live(); }) : true;
      if (!go || !live()) return;
      H.sessionCommit("squats");
      st.calibrating = false; st.starting = false;
      st.set = SS.createSquatSet({ counter: st.counter }); st.set.start(now());
      st.startedAt = Date.now(); st.running = true;
      st.coachAt = {}; st.missSince = 0; st.halfUntil = 0; setStartLabel(false);
      status("Sit back to parallel, stand all the way up. Keep your glutes working the whole rep: down, hold, up and squeeze. A set is ten reps.");
      if (cadence) st.cadenceTimer = setTimeout(function () { st.cadenceTimer = null; if (st.running && live()) cadence.start(); }, CADENCE_LEAD_MS);
    } catch (e) { if (live()) cancelStart(H.camErrorText ? H.camErrorText(e) : "Camera or pose blocked."); }
  }
  $("sqStartBtn").addEventListener("click", start);
  if ($("sqEndBtn")) $("sqEndBtn").addEventListener("click", endNow);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") paintDay(); });
  paintDay(); midnightRepaint();
  window.ZabSquatPage = { SAY: SAY, start: start, end: endNow, state: function () { return { starting: st.starting, running: st.running, reps: st.set ? st.set.state() && st.set.state().reps : 0, cadence: cadence ? cadence.state() : null, calibrated: !!(st.counter && st.counter.baseline()) }; }, cadence: cadence };
})();
