/* Gyatt Squats page glue (#squats): front camera -> pose -> squat-session.js; spoken cadence (gyatt-cadence.js) as the
 * voice guide; face logo (ZabPfp.frame, public API only) on every pose frame from camera open; Start set is the only
 * start button, End set (on the camera, same muted 52 px fallback as push-ups / plank) the manual stop.
 * The shared camera / pose / sign-in / save / ZAB helpers come from the page module through window.ZabSquatHost.
 * Flow: tap Start set -> camera opens (setup line spoken in the tap) -> pose + logo run -> "whole body, stand tall" ->
 * "Set up, go on three." One two three Go (standing baseline calibrated during this countdown) -> set clock starts at Go,
 * the cadence starts 1 s after Go (so "Go" is not cut off) -> reps counted from pose. Cadence pose-sync: when a counted
 * rep finishes more than 1 s away from the cadence's own rep boundary, the cadence restarts at "one" (Down) for the
 * next rep, so the voice follows the real movement; within 1 s it keeps running (no double "one").
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  if (!$("sqStartBtn")) return;
  var SQ = window.ZabbadatSquat, SS = window.ZabbadatSquatSession, GC = window.GyattCadence, GS = window.ZabbadatGetSet;
  var CADENCE_LEAD_MS = 1000, RESYNC_MS = 1000;
  var st = { starting: false, running: false, seq: 0, loopId: 0, stream: null, counter: null, set: null, calibrating: false, startedAt: 0, cadenceTimer: null, countdown: null };
  var host = function () { return window.ZabSquatHost || null; };
  var now = function () { return performance.now(); };

  var cadence = GC ? GC.makeCadence({
    onPhase: function (phase, count, rep, info) {
      if ($("sqHudCount")) $("sqHudCount").textContent = String(count);
      if ($("sqHudPhase")) $("sqHudPhase").textContent = info.label;
      if ($("sqCount")) $("sqCount").textContent = String(count);
      if ($("sqPhase")) $("sqPhase").textContent = info.label;
      window.__sqCadence = (window.__sqCadence || []).concat([{ phase: phase, count: count, rep: rep, word: info.word, spoken: info.spoken, t: now() }]).slice(-200);
    },
    // pose-sync hook: the counter's phase vs the cadence's phase (hint only; never ends a set, never changes reps)
    poseCheck: function (sample, c) { var p = sample && sample.phase; if (!p || !c.phase) return true; return !(c.phase === "hold" && p === "top") && !(c.phase === "down" && p === "up"); }
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

  function nextFrame(vid, fn) { if (vid && typeof vid.requestVideoFrameCallback === "function") vid.requestVideoFrameCallback(function () { fn(); }); else requestAnimationFrame(fn); }
  function frameMsg(r) {
    if (r.frame === "missing") return "Step back: whole body in frame";
    if (r.guard === "moved") return "Hold your spot";
    if (r.guard === "bent") return "Squat, don't bend over";
    if (r.phase === "bottom") return "Deep! Now stand all the way up";
    if (r.phase === "up") return "Up, all the way";
    if (r.phase === "down") return "Down to parallel";
    return "Squat";
  }
  async function tick(id) {
    if (id !== st.loopId) return;
    var vid = $("sqVid"), H = host();
    try {
      var det = await H.ensurePose();
      var t = now();
      var poses = await det.estimatePoses(vid, { flipHorizontal: true });
      if (id !== st.loopId) return;
      var p = poses && poses[0], kps = p ? p.keypoints : [];
      if (window.ZabPfp) window.ZabPfp.frame(vid, kps, t); // face logo from camera open, same keypoints; visual only, never throws
      var extra = p ? { knee3D: p.knee3D, pose3d: p.pose3d } : null;
      if (st.calibrating && st.counter) st.counter.calibrate(kps, t);
      if (st.running && st.set) {
        var r = st.set.update(kps, t, extra);
        if (r.ended) { endSet(r); return; }
        paintReps(r.reps);
        if (r.event === "rep") {
          if (cadence && cadence.state().running && cadence.offBoundaryMs() > RESYNC_MS) cadence.resync(r.reps + 1);
        }
        var off = cadence && cadence.state().running ? cadence.pose({ phase: r.phase }) : true;
        msg(frameMsg(r) + (off === false && r.frame === "ok" && r.guard === "ok" ? " · follow the count" : ""));
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
    stopCadence();
    closeCam();
    var H = host(); if (H) H.sessionTouch();
    if (r.reason !== "stopped") speak(GS && GS.SET_DONE_LINE ? GS.SET_DONE_LINE : "Set complete.");
    $("sqStartBtn").disabled = false;
    paintReps(r.reps);
    msg("Set over: " + r.reps + (r.reps === 1 ? " squat" : " squats"));
    var day = SS.recordSet(localStorage, r.reps);
    paintDay();
    var line = "Set ended: " + r.why + ". " + r.reps + (r.reps === 1 ? " squat" : " squats") + (r.halfReps ? " (" + r.halfReps + " not deep enough)" : "") + "." + (r.reps > 0 ? " Set " + day.sets + " today." : "");
    status(line);
    window.__sqLast = r;
    if (!(r.reps > 0) || !H) return;
    if (!H.user()) { status(line + " Sign in to save sets and earn ZAB."); return; }
    H.save({ name: H.playerName(), reps: r.reps, ms: r.ms, sessionStartedAt: st.startedAt }).then(function (id) {
      status(line + " Saved.");
      if (r.reps >= 10) H.award(id).then(function (tk) { status($("sqStatus").textContent + H.zabNote(tk)); H.zabRing($("sqStatus")); }, function () {});
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
      var gum = navigator.mediaDevices.getUserMedia(H.CAM_CONSTRAINTS);
      H.ensurePose().catch(function () {}); // instant lock: the pose model loads (and warms up) while the camera opens
      var stream = await gum;
      if (!live()) { H.stopCamTracks(stream); return; }
      st.stream = stream;
      var vid = $("sqVid"); await H.attachCam(vid, stream);
      $("sqWrap").hidden = false; H.camFs("sqWrap", true);
      await H.ensurePose();
      if (!live()) return;
      st.counter = SQ.createCounter(); paintReps(0);
      tick(++st.loopId); // pose + face logo from camera open (before Go)
      if (!restart && C && GS.sayAndWait) { status(C.criteria); msg("Whole body in frame"); if (!(await GS.sayAndWait(C.criteria, { minMs: 2000, maxMs: 10000, cancelled: function () { return !live(); }, now: now }))) return; }
      if (!live()) return;
      st.calibrating = true; // standing baseline from the 1-2-3-Go frames
      st.countdown = GS && GS.makeNextSetCountdown ? GS.makeNextSetCountdown() : null;
      var show = function (t) { msg(t); if ($("sqHudCount")) $("sqHudCount").textContent = t.length > 4 ? "…" : t; if ($("sqHudPhase")) $("sqHudPhase").textContent = "Get set"; };
      var go = st.countdown ? await st.countdown.run(show, function () { return !live(); }) : true;
      if (!go || !live()) return;
      H.sessionCommit("squats");
      st.calibrating = false; st.starting = false;
      st.set = SS.createSquatSet({ counter: st.counter }); st.set.start(now());
      st.startedAt = Date.now(); st.running = true;
      status("Squat to parallel, stand all the way up. Follow the count: 3 down, 4 hold, 5 up.");
      if (cadence) st.cadenceTimer = setTimeout(function () { st.cadenceTimer = null; if (st.running && live()) cadence.start(); }, CADENCE_LEAD_MS);
    } catch (e) { if (live()) cancelStart(H.camErrorText ? H.camErrorText(e) : "Camera or pose blocked."); }
  }
  $("sqStartBtn").addEventListener("click", start);
  if ($("sqEndBtn")) $("sqEndBtn").addEventListener("click", endNow);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") paintDay(); });
  paintDay(); midnightRepaint();
  window.ZabSquatPage = { start: start, end: endNow, state: function () { return { starting: st.starting, running: st.running, reps: st.set ? st.set.state() && st.set.state().reps : 0, cadence: cadence ? cadence.state() : null, calibrated: !!(st.counter && st.counter.baseline()) }; }, cadence: cadence };
})();
