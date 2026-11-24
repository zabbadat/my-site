// Sponsor watermark layout + 2-3 s branded end card (rec.js). Run: node test/rec-video-ads.test.js
const RC = require("../rec.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const sp = RC.getSponsor();
check("SPONSOR config is one object with enabled, name, logoUrl, line", !!(RC.SPONSOR && "enabled" in RC.SPONSOR && "name" in RC.SPONSOR && "logoUrl" in RC.SPONSOR && "line" in RC.SPONSOR));
check("default sponsor slot is the placeholder 'Your brand here' and is enabled", sp.enabled === true && sp.name === "Your brand here" && sp.logoUrl === "");
check("default end-card line is short and says Breathe", sp.line === "Breathe. Then begin." && !/Zabadat/.test(sp.line) && sp.line.length <= 40);
check("end card length is 2-3 seconds (2500 ms)", RC.W.endMs === 2500 && RC.W.endMs >= 2000 && RC.W.endMs <= 3000);

function assertLayout(fw, fh, label) {
  const lay = RC.wmCluster(fw, fh, "right");
  const hud = RC.hudRect(fw, fh);
  const m = Math.round(Math.max(8, fw * RC.W.marginFrac));
  check(`${label}: brand watermark is in the bottom-right margin`, lay.brand.x + lay.brand.w <= fw - m + 1 && lay.brand.y + lay.brand.h <= fh - m + 1);
  check(`${label}: sponsor sits with the brand and they do not overlap`, !!(lay.sponsor && !RC.rectsOverlap(lay.brand, lay.sponsor, 0)));
  check(`${label}: cluster stays below the HUD and on-frame`, !RC.rectsOverlap(lay.cluster, hud, 0) && lay.cluster.y >= hud.h && lay.cluster.x >= 0 && lay.cluster.x + lay.cluster.w <= fw && lay.cluster.y + lay.cluster.h <= fh);
  const left = RC.wmCluster(fw, fh, "left");
  check(`${label}: left cluster mirrors the hop and still misses the HUD`, left.side === "left" && left.sponsor && !RC.rectsOverlap(left.brand, left.sponsor, 0) && !RC.rectsOverlap(left.cluster, hud, 0));
}

assertLayout(720, 540, "720x540");
assertLayout(720, 405, "720x405 landscape");
assertLayout(405, 720, "405x720 portrait");

{
  const { brand, sponsor, cluster } = RC.wmCluster(720, 540, "right");
  const typHead = { x: 360, y: 180, r: 90 }; // locked chest-up head, not the huge opening disc
  check("typical locked head does not hit the right-hand cluster", !RC.circleHitsRect(typHead, cluster, RC.W.pad));
  const pl = RC.createWmPlacer();
  check("typical locked head: watermarks stay bottom-right, not hidden", pl.step(typHead, 720, 540, 0).side === "right" && !pl.step(typHead, 720, 540, 16).hidden);
  const cover = { x: brand.x + brand.w / 2, y: brand.y, r: 50 };
  const hop = pl.step(cover, 720, 540, 40);
  check("when the logo would cover the cluster it hops together to the left", hop.side === "left" && hop.sponsor && !hop.hidden);
  check("after the hop, the left cluster no longer hits that logo", !RC.circleHitsRect(cover, hop.cluster, RC.W.pad));
  const huge = { x: 360, y: 300, r: 340 };
  const both = RC.createWmPlacer().step(huge, 720, 540, 0);
  check("a logo that would cover both corners hides the marks rather than covering it", both.hidden === true);
}

{
  const saved = { enabled: RC.SPONSOR.enabled, name: RC.SPONSOR.name, logoUrl: RC.SPONSOR.logoUrl, line: RC.SPONSOR.line };
  RC.SPONSOR.enabled = false;
  const off = RC.wmCluster(720, 540, "right");
  check("enabled: false drops the sponsor slot and leaves the original brand box", !off.sponsor && off.cluster.w === off.brand.w && off.cluster.h === off.brand.h && off.brand.w === RC.wmBox(720, 540, "right").w);
  RC.SPONSOR.name = "Acme Co"; RC.SPONSOR.enabled = true; RC.SPONSOR.logoUrl = "/sponsor.svg";
  check("swapping SPONSOR.name/logoUrl is picked up by getSponsor", RC.getSponsor().name === "Acme Co" && RC.getSponsor().logoUrl === "/sponsor.svg");
  RC.SPONSOR.enabled = saved.enabled; RC.SPONSOR.name = saved.name; RC.SPONSOR.logoUrl = saved.logoUrl; RC.SPONSOR.line = saved.line;
}

{
  const calls = [];
  const ctx = {
    save() { calls.push("save"); }, restore() { calls.push("restore"); },
    setTransform() { calls.push("setTransform"); },
    fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h, this.fillStyle]); },
    fillText(t, x, y) { calls.push(["fillText", t, x, y]); },
    stroke() { calls.push("stroke"); }, beginPath() { calls.push("beginPath"); },
    arc() { calls.push("arc"); }, moveTo() {}, lineTo() {},
    drawImage(img) { calls.push(["drawImage", img && img.tagName || img && img.kind || "img"]); }
  };
  // stub used props
  ["fillStyle", "strokeStyle", "globalAlpha", "shadowColor", "shadowBlur", "font", "textAlign", "textBaseline", "lineWidth"].forEach((k) => {
    Object.defineProperty(ctx, k, { writable: true, configurable: true, value: "" });
  });
  RC.paintEndCard(ctx, 720, 540, {});
  const texts = calls.filter((c) => Array.isArray(c) && c[0] === "fillText").map((c) => c[1]);
  const fills = calls.filter((c) => Array.isArray(c) && c[0] === "fillRect");
  check("end card paints a dark full-frame fill first", fills[0] && fills[0][1] === 0 && fills[0][2] === 0 && fills[0][3] === 720 && fills[0][4] === 540 && String(fills[0][5]).toLowerCase() === "#0e1412");
  check("end card shows Zabbadat, zabbadat.com, the breath line, and the sponsor placeholder", texts.includes("Zabbadat") && texts.includes("zabbadat.com") && texts.includes("Breathe. Then begin.") && texts.includes("Your brand here"));
  check("end card never draws a video/camera frame", !calls.some((c) => Array.isArray(c) && c[0] === "drawImage" && c[1] === "VIDEO"));
  const video = { tagName: "VIDEO", kind: "VIDEO" };
  RC.paintEndCard(ctx, 720, 540, { mark: null, sponsor: null, video: video });
  check("even if a video is passed in assets, the end card still does not draw it", !calls.some((c) => Array.isArray(c) && c[0] === "drawImage" && (c[1] === "VIDEO" || c[1] === video)));
}

{
  check("at t=0 the end card still has 2500 ms left", RC.endCardRemaining(0, 0) === 2500 && !RC.endCardDone(0, 0));
  check("at 2 s the end card is still running", RC.endCardRemaining(1000, 3000) === 500 && !RC.endCardDone(1000, 3000));
  check("at 2.5 s the end card is done", RC.endCardDone(0, 2500) && RC.endCardRemaining(0, 2500) === 0);
  check("past 3 s it stays done (does not keep growing the file)", RC.endCardDone(0, 4000) && RC.endCardRemaining(0, 4000) === 0);

  const log = [];
  const rec = { ending: false };
  check("beginEndCard marks the clip as ending once", RC.beginEndCard(rec, 100).ending === true && rec.endAt === 100 && RC.beginEndCard(rec, 999) === rec && rec.endAt === 100);

  const phases = [];
  for (const t of [100, 1100, 2000, 2599, 2600]) {
    phases.push(RC.tickRecording(rec, t,
      function () { log.push("live:" + t); },
      function () { log.push("end:" + t); },
      function () { log.push("finish:" + t); }
    ));
  }
  check("stop flow paints the end card, never live frames, and finishes at 2.5 s",
    phases.join(",") === "ending,ending,ending,ending,finished" &&
    log.filter((s) => s.startsWith("live:")).length === 0 &&
    log.filter((s) => s.startsWith("end:")).length === 5 &&
    log[log.length - 1] === "finish:2600");

  const live = { ending: false };
  const p0 = RC.tickRecording(live, 0, function () { log.push("rec-live"); }, function () { log.push("rec-end"); }, function () {});
  check("before stop, tickRecording still paints the live (watermarked) frame", p0 === "recording" && log.includes("rec-live") && !log.includes("rec-end"));
}

{
  // Share/preview path is unchanged: share helpers still export the same title/text and file names.
  check("share helpers are unchanged (title, text, mp4/webm names)", RC.share.TITLE === "Zabbadat" && RC.share.TEXT === "zabbadat.com" && RC.share.isMp4("video/mp4") && RC.share.fileName({ type: "video/webm" }, new Date("2026-11-23T20:00:00Z")).endsWith(".webm"));
}


{
  // Recordings must follow the on-screen CSS mirror. Workout cams use scaleX(-1);
  // #zlSelf / #zmCamVid do not — flipping those would put the PFP logo on the wrong side.
  const plain = { style: { transform: "none" } };
  const zl = { style: {} };
  const workout = { style: { transform: "scaleX(-1)" } };
  const matrix = { style: { transform: "matrix(-1, 0, 0, 1, 0, 0)" } };
  const unflipped = { style: { transform: "matrix(1, 0, 0, 1, 0, 0)" } };
  check("sourceMirrored is exported", typeof RC.sourceMirrored === "function");
  check("unmirrored sources (#zlSelf, no transform) are not flipped", RC.sourceMirrored(plain) === false && RC.sourceMirrored(zl) === false && RC.sourceMirrored(unflipped) === false && RC.sourceMirrored(null) === false);
  check("workout cameras with scaleX(-1) or a mirrored matrix are flipped", RC.sourceMirrored(workout) === true && RC.sourceMirrored(matrix) === true);
}

const ok = R.filter(Boolean).length;
console.log(`\n${ok}/${R.length} passed`);
if (ok !== R.length) process.exit(1);
