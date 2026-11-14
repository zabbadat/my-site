/* Zabbadat Record & Share. Records the camera exercise ON THIS DEVICE ONLY (nothing is uploaded; Share / Save are the
 * user's own taps). Flow: tap Record before starting the camera to ARM it ("Record armed"); when that exercise's camera
 * goes full screen, recording starts by itself; the in-frame Stop, tapping Record again, or the set ending stops it and
 * opens the preview (Share / Save). The arm resets after each recording. Hidden where MediaRecorder or canvas capture is
 * missing. Visual / local only: it reads the video element and the PFP head spot, never the counter or the session.
 * The recording (not the live view) gets the HUD numbers on top, the PFP logo when that switch is on, and a small
 * watermark bottom-right that hops to bottom-left while the head / logo would touch it (0.5 s clear before it returns).
 */
(function (root) {
  "use strict";
  var W = { markFrac: 0.06, marginFrac: 0.035, clearMs: 500, hudFrac: 0.12, pad: 6 };
  // ---- pure layout maths ----
  function wmBox(fw, fh, side) {
    var m = Math.round(Math.max(8, fw * W.marginFrac)), mark = Math.max(14, Math.round(fw * W.markFrac)), font = Math.max(9, Math.round(mark * 0.42));
    var tw = Math.round(font * 4.9), w = mark + Math.round(font * 0.5) + tw, h = Math.max(mark, Math.round(font * 2.3));
    return { x: side === "left" ? m : fw - m - w, y: fh - m - h, w: w, h: h, mark: mark, font: font };
  }
  function circleHitsRect(c, r, pad) {
    if (!c || !r) return false; var p = pad || 0;
    var nx = Math.max(r.x - p, Math.min(c.x, r.x + r.w + p)), ny = Math.max(r.y - p, Math.min(c.y, r.y + r.h + p));
    return Math.hypot(c.x - nx, c.y - ny) < c.r;
  }
  function createWmPlacer(opts) {
    var o = Object.assign({}, W, opts || {}), side = "right", clearSince = null;
    return {
      step: function (head, fw, fh, t) {
        var right = wmBox(fw, fh, "right"), hitR = circleHitsRect(head, right, o.pad);
        if (side === "right") { if (hitR) { side = "left"; clearSince = null; } }
        else if (hitR) clearSince = null;
        else { if (clearSince == null) clearSince = t; if (t - clearSince >= o.clearMs) { side = "right"; clearSince = null; } }
        return { side: side, box: wmBox(fw, fh, side) };
      },
      side: function () { return side; }
    };
  }
  // Arm / record state machine (pure; the browser side injects start/stop).
  function createCtl(io) {
    var armed = {}, rec = null; // rec = { id }
    function paint() { if (io.paint) io.paint({ armed: Object.assign({}, armed), recording: rec ? rec.id : null }); }
    return {
      tap: function (id) { // the Record button
        if (rec && rec.id === id) { var r = rec; rec = null; armed[id] = false; io.stop(r.id); paint(); return "stopped"; }
        armed[id] = !armed[id]; paint();
        if (armed[id] && io.isFs && io.isFs(id)) return this.onFs(id, true); // armed while that exercise is already full screen: start now
        return armed[id] ? "armed" : "disarmed";
      },
      onFs: function (id, on) { // camera exercise went full screen / left it
        if (on && armed[id] && !rec) { var ok = false; try { ok = io.start(id) !== false; } catch (e) { ok = false; } if (ok) rec = { id: id }; else armed[id] = false; paint(); return ok ? "recording" : "failed"; }
        if (!on && rec && rec.id === id) { rec = null; armed[id] = false; io.stop(id); paint(); return "stopped"; }
        return "";
      },
      stopNow: function () { if (!rec) return ""; var id = rec.id; rec = null; armed[id] = false; io.stop(id); paint(); return "stopped"; },
      state: function () { return { armed: Object.assign({}, armed), recording: rec ? rec.id : null }; }
    };
  }
  var api = { wmBox: wmBox, circleHitsRect: circleHitsRect, createWmPlacer: createWmPlacer, createCtl: createCtl, W: W };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // ---- browser side ----
  var doc = root && root.document;
  if (!doc) return;
  var VID = { camWrap: "camVid", tbCamWrap: "tbVid", plankWrap: "plankVid" };
  function supported() {
    try { return typeof root.MediaRecorder === "function" && !!(root.HTMLCanvasElement && root.HTMLCanvasElement.prototype.captureStream); } catch (e) { return false; }
  }
  function pickType() {
    var c = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (var i = 0; i < c.length; i++) try { if (root.MediaRecorder.isTypeSupported && root.MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {}
    return "";
  }
  var mark = null; function ensureMark() { if (!mark && typeof Image !== "undefined") { mark = new Image(); mark.src = "/zd-v2-mark.svg"; } }
  var cur = null; // { id, vid, cv, x, mr, chunks, raf, placer, type, stopBtn }
  function hudText(id) {
    var wrap = doc.getElementById(id), out = [];
    var strip = doc.getElementById("sessionStrip");
    var src = strip && !strip.hidden ? strip : wrap;
    if (src) src.querySelectorAll(".arcade-cell").forEach(function (cell) { if (cell.hidden) return; var n = cell.querySelector(".arcade-num"), l = cell.querySelector(".arcade-lbl"); if (n && !n.hidden && n.textContent.trim()) out.push([n.textContent.trim(), l ? l.textContent.trim() : ""]); });
    return out.slice(0, 3);
  }
  // One recorded frame: mirrored video (as the user sees it), HUD numbers on top, PFP logo if on, watermark.
  function paintFrame(r, now) {
    var v = r.vid, x = r.x, fw = r.cv.width, fh = r.cv.height;
    var pfpOn = !!(root.ZabPfp && root.ZabPfp.isOn && root.ZabPfp.isOn());
    var head0 = root.ZabPfp && root.ZabPfp.lastHead ? root.ZabPfp.lastHead(VID[r.id], typeof performance !== "undefined" ? performance.now() : null) : null;
    x.save(); x.translate(fw, 0); x.scale(-1, 1);
    try {
      if (pfpOn && !head0) { // PFP on but no head spot yet / lost: never record a plain face - pixelate the whole frame
        r.px = r.px || doc.createElement("canvas"); r.px.width = 16; r.px.height = 12; r.px.getContext("2d").drawImage(v, 0, 0, 16, 12);
        x.imageSmoothingEnabled = false; x.drawImage(r.px, 0, 0, fw, fh); x.imageSmoothingEnabled = true;
      } else x.drawImage(v, 0, 0, fw, fh);
    } catch (e) {}
    x.restore();
    var cells = hudText(r.id), hh = Math.round(fh * W.hudFrac);
    if (cells.length) {
      x.fillStyle = "rgba(4,6,16,.78)"; x.fillRect(0, 0, fw, hh);
      var cw = fw / cells.length;
      cells.forEach(function (c, i) {
        x.textAlign = "center"; x.fillStyle = "#7dff7a"; x.font = "700 " + Math.round(hh * 0.46) + "px 'Press Start 2P', monospace"; x.textBaseline = "alphabetic"; x.fillText(c[0], cw * (i + 0.5), hh * 0.58);
        x.fillStyle = "#ffd84a"; x.font = "700 " + Math.round(hh * 0.18) + "px 'Press Start 2P', monospace"; x.fillText(c[1].toUpperCase(), cw * (i + 0.5), hh * 0.88);
      });
    }
    var vw = v.videoWidth || fw, sc = fw / vw;
    var hd = head0 ? { x: head0.x * sc, y: head0.y * sc, r: head0.r * sc } : null;
    if (hd && pfpOn) root.ZabPfp.drawLogo(x, hd);
    var pl = r.placer.step(hd, fw, fh, now); drawWatermark(x, pl.box);
  }
  function drawWatermark(x, b) {
    ensureMark();
    x.save(); x.globalAlpha = 0.7; x.shadowColor = "rgba(0,0,0,.65)"; x.shadowBlur = Math.max(2, b.font * 0.5); x.shadowOffsetY = 1;
    if (mark && mark.complete && mark.naturalWidth) x.drawImage(mark, b.x, b.y + (b.h - b.mark) / 2, b.mark, b.mark);
    else { x.strokeStyle = "#fff"; x.lineWidth = Math.max(1.5, b.mark * 0.07); x.beginPath(); x.arc(b.x + b.mark / 2, b.y + b.h / 2, b.mark * 0.44, 0, Math.PI * 2); x.stroke(); }
    var tx = b.x + b.mark + Math.round(b.font * 0.5); x.fillStyle = "#fff"; x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.font = "600 " + b.font + "px 'Cormorant Garamond', Georgia, serif"; x.fillText("Zabbadat", tx, b.y + b.h * 0.52);
    x.font = "500 " + Math.round(b.font * 0.72) + "px Outfit, sans-serif"; x.fillText("zabbadat.com", tx, b.y + b.h * 0.9);
    x.restore();
  }
  function start(id) {
    var vid = doc.getElementById(VID[id]); if (!vid || !supported()) return false;
    var vw = vid.videoWidth || 640, vh = vid.videoHeight || 480, k = Math.min(1, 720 / Math.max(vw, vh));
    var cv = doc.createElement("canvas"); cv.width = Math.round(vw * k); cv.height = Math.round(vh * k);
    var r = { id: id, vid: vid, cv: cv, x: cv.getContext("2d"), chunks: [], placer: createWmPlacer(), type: pickType() };
    var stream = cv.captureStream(30), mo = r.type ? { mimeType: r.type, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 };
    r.mr = new root.MediaRecorder(stream, mo);
    r.mr.ondataavailable = function (e) { if (e.data && e.data.size) r.chunks.push(e.data); };
    r.mr.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); preview(new Blob(r.chunks, { type: r.type.split(";")[0] || "video/webm" })); };
    var loop = function () { if (cur !== r) return; try { paintFrame(r, performance.now()); } catch (e) {} r.raf = root.requestAnimationFrame(loop); };
    cur = r; paintFrame(r, performance.now()); r.mr.start(1000); r.raf = root.requestAnimationFrame(loop);
    var wrap = doc.getElementById(id), b = doc.createElement("button"); b.type = "button"; b.className = "btn rec-stop"; b.innerHTML = '<span class="rec-dot"></span>Stop recording';
    b.onclick = function () { ctl.stopNow(); }; if (wrap) wrap.appendChild(b); r.stopBtn = b;
    return true;
  }
  function stop() {
    var r = cur; if (!r) return; cur = null;
    try { root.cancelAnimationFrame(r.raf); } catch (e) {}
    if (r.stopBtn && r.stopBtn.parentNode) r.stopBtn.parentNode.removeChild(r.stopBtn);
    try { if (r.mr.state !== "inactive") r.mr.stop(); } catch (e) {}
  }
  function preview(blob) {
    if (!blob || !blob.size) return;
    var url = URL.createObjectURL(blob), ext = /mp4/.test(blob.type) ? "mp4" : "webm", name = "zabbadat-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "." + ext;
    var box = doc.createElement("div"); box.className = "rec-preview"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Your recording");
    box.innerHTML = '<div class="rec-card"><h3>Your recording</h3><video controls playsinline></video><p class="note">Saved on this phone only until you share or save it.</p><div class="row"><button class="btn" type="button" data-a="share">Share</button><a class="btn ghost" data-a="save">Save</a><button class="btn ghost" type="button" data-a="close">Close</button></div></div>';
    box.querySelector("video").src = url;
    var sv = box.querySelector('[data-a="save"]'); sv.href = url; sv.download = name;
    var file = null; try { file = new File([blob], name, { type: blob.type }); } catch (e) {}
    var sh = box.querySelector('[data-a="share"]');
    if (!(file && root.navigator.canShare && root.navigator.canShare({ files: [file] }))) sh.hidden = true;
    sh.onclick = function () { root.navigator.share({ files: [file], title: "Zabbadat", text: "zabbadat.com" }).catch(function () {}); };
    box.querySelector('[data-a="close"]').onclick = function () { box.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
    doc.body.appendChild(box);
  }
  function paint(st) {
    doc.querySelectorAll(".rec-btn").forEach(function (b) {
      var id = b.getAttribute("data-rec"), on = !!st.armed[id], recNow = st.recording === id;
      b.classList.toggle("armed", on && !recNow); b.classList.toggle("recording", recNow);
      b.setAttribute("aria-pressed", on || recNow ? "true" : "false");
      b.lastChild.textContent = recNow ? "Stop recording" : on ? "Record armed" : "Record";
    });
  }
  var ctl = createCtl({ start: start, stop: stop, paint: paint, isFs: function (id) { var w = doc.getElementById(id); return !!(w && w.classList.contains("cam-fs") && !w.hidden); } });
  api.ctl = ctl; api.onFs = function (id, on) { try { return ctl.onFs(id, on); } catch (e) { return ""; } }; api.supported = supported; api.paintFrame = paintFrame;
  root.ZabRec = api;
  function wire() {
    try {
      var okSup = supported();
      doc.querySelectorAll(".rec-btn").forEach(function (b) { b.hidden = !okSup; if (!b._rec) { b._rec = 1; b.addEventListener("click", function () { ctl.tap(b.getAttribute("data-rec")); }); } });
    } catch (e) {}
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wire); else wire();
})(typeof window !== "undefined" ? window : this);
