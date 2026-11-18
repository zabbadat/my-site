// Recorded-video share sheet: native Capacitor Share + Filesystem, Web Share files, download
// fallback, cancel is not an error, and Share is called directly from the tap.
// Run: node test/rec-share.test.js
const RC = require("../rec.js");
const S = RC.share;
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

// ---- naming / container ----
check("mp4 blob keeps an .mp4 name", S.fileName({ type: "video/mp4" }, new Date("2026-11-17T23:05:00Z")) === "zabbadat-2026-11-17-23-05-00.mp4");
check("webm blob keeps a .webm name", S.fileName({ type: "video/webm;codecs=vp8" }, new Date("2026-11-17T23:05:00Z")) === "zabbadat-2026-11-17-23-05-00.webm");
check("empty type is treated as webm (MediaRecorder fallback)", S.fileName({ type: "" }, new Date("2026-11-17T23:05:00Z")).endsWith(".webm"));
check("isMp4 matches video/mp4 and a .mp4 name", S.isMp4("video/mp4") && S.isMp4("zabbadat-clip.mp4") && !S.isMp4("video/webm"));

// ---- cancel vs real errors ----
check("AbortError is a cancel, not a failure", S.isCancel({ name: "AbortError", message: "Share canceled" }));
check("Share canceled / cancelled messages are cancels", S.isCancel({ message: "Share canceled" }) && S.isCancel({ message: "Share cancelled" }) && S.isCancel(new Error("User cancelled share")));
check("missing error is treated as cancel", S.isCancel(null) && S.isCancel(undefined));
check("NotAllowedError and other failures are not cancels", !S.isCancel({ name: "NotAllowedError", message: "must be triggered by a user gesture" }) && !S.isCancel({ name: "TypeError", message: "Cannot share" }));

// ---- canShare / native detection ----
const file = { name: "clip.mp4", type: "video/mp4", size: 12 };
check("canWebShareFiles is true only when canShare({files}) and share exist", S.canWebShareFiles({ canShare: (o) => !!(o && o.files && o.files[0] === file), share() {} }, file));
check("canWebShareFiles is false when canShare is missing", !S.canWebShareFiles({ share() {} }, file));
check("canWebShareFiles is false when canShare throws", !S.canWebShareFiles({ canShare() { throw new Error("not supported"); }, share() {} }, file));
check("canWebShareFiles is false with no file", !S.canWebShareFiles({ canShare: () => true, share() {} }, null));
check("isNativeApp requires Capacitor.isNativePlatform() === true", S.isNativeApp({ isNativePlatform: () => true }) && !S.isNativeApp({ isNativePlatform: () => false }) && !S.isNativeApp(null));
check("getPlugin reads Capacitor.Plugins then registerPlugin", S.getPlugin({ Plugins: { Share: { share() {} } } }, "Share").share && S.getPlugin({ registerPlugin: (n) => n === "Filesystem" ? { writeFile() {} } : null }, "Filesystem").writeFile);

// ---- shareFromTap: native, web, download, cancel, gesture-direct ----
async function run() {
  const calls = [];
  const Share = { share(opts) { calls.push(["native", opts]); return Promise.resolve({ activity: "ok" }); } };
  const r1 = await S.shareFromTap({ uri: "file:///cache/share/clip.mp4", Share, file, nav: { canShare: () => true, share() { calls.push(["web"]); } } });
  check("native path: uses Capacitor Share.share with the file URI", r1.via === "native" && calls.length === 1 && calls[0][0] === "native" && calls[0][1].files[0] === "file:///cache/share/clip.mp4");
  check("native path: title, text, and Android dialogTitle are standard, no custom UI", calls[0][1].title === "Zabbadat" && calls[0][1].text === "zabbadat.com" && calls[0][1].dialogTitle === "Share");

  calls.length = 0;
  const nav = { canShare: (o) => !!(o && o.files), share(opts) { calls.push(["web", opts]); return Promise.resolve(); } };
  const r2 = await S.shareFromTap({ file, nav });
  check("web path: navigator.share({ files }) when the Web Share files API is available", r2.via === "web" && calls[0][0] === "web" && calls[0][1].files[0] === file && calls[0][1].title === "Zabbadat");

  calls.length = 0;
  let downloaded = 0;
  const r3 = await S.shareFromTap({ file, nav: { canShare: () => false }, downloadEl: { click() { downloaded++; } } });
  check("download fallback when neither native URI nor canShare({files}) is available", r3.via === "download" && downloaded === 1 && calls.length === 0);

  const rNone = await S.shareFromTap({ file, nav: { canShare: () => false } });
  check("no target and no download control: returns via none, does not throw", rNone.via === "none" && rNone.ok === false);

  const cancelShare = { share() { const e = new Error("Share canceled"); e.name = "AbortError"; return Promise.reject(e); } };
  const rC = await S.shareFromTap({ uri: "file:///x", Share: cancelShare });
  check("AbortError / cancel from the system sheet is not a failure", rC.cancelled === true);

  const cancelMsg = { share() { return Promise.reject(new Error("User cancelled share")); } };
  const rCm = await S.shareFromTap({ uri: "file:///x", Share: cancelMsg });
  check("cancelled message from the native plugin is not a failure", rCm.cancelled === true);

  let threw = null;
  try { await S.shareFromTap({ uri: "file:///x", Share: { share() { const e = new Error("must be triggered by a user gesture"); e.name = "NotAllowedError"; return Promise.reject(e); } } }); }
  catch (e) { threw = e; }
  check("NotAllowedError (share not called from the tap) is still a real error", threw && threw.name === "NotAllowedError");

  // Gesture: shareFromTap must invoke Share.share / navigator.share synchronously, before returning a Promise.
  let syncNative = false;
  const SyncShare = { share(opts) { syncNative = true; return new Promise(function () {}); } };
  const pNative = S.shareFromTap({ uri: "file:///cache/a.mp4", Share: SyncShare });
  check("native Share.share is called directly from the tap (no await first)", syncNative === true && pNative && typeof pNative.then === "function");

  let syncWeb = false;
  const syncNav = { canShare: () => true, share() { syncWeb = true; return new Promise(function () {}); } };
  const pWeb = S.shareFromTap({ file, nav: syncNav });
  check("navigator.share is called directly from the tap (no await first)", syncWeb === true && pWeb && typeof pWeb.then === "function");

  // ---- prepareNativeShare writes cache then returns the URI ----
  const writes = [];
  const Fs = {
    writeFile(opts) { writes.push(opts); return Promise.resolve(); },
    getUri(opts) { return Promise.resolve({ uri: "file:///data/cache/" + opts.path }); }
  };
  const uri = await S.prepareNativeShare({ type: "video/mp4" }, "zabbadat-clip.mp4", Fs, () => Promise.resolve("AAAA"));
  check("prepareNativeShare writes base64 to CACHE/share and returns the file URI", uri === "file:///data/cache/share/zabbadat-clip.mp4" && writes[0].directory === "CACHE" && writes[0].path === "share/zabbadat-clip.mp4" && writes[0].data === "AAAA" && writes[0].recursive === true);

  // ---- wirePreviewButtons: Share stays visible; native prepares before enabling ----
  function mkBox() {
    const els = {};
    const box = {
      querySelector(sel) {
        if (!els[sel]) {
          if (sel === '[data-a="save"]') els[sel] = { href: "", download: "", click() { this.clicked = true; } };
          else if (sel === '[data-a="share"]') els[sel] = { hidden: false, disabled: false, onclick: null };
          else els[sel] = null;
        }
        return els[sel];
      },
      _els: els
    };
    return box;
  }

  const boxWeb = mkBox();
  const w1 = S.wirePreviewButtons(boxWeb, file, "blob:1", "clip.mp4", { navigator: { canShare: () => true, share() { return Promise.resolve(); } } });
  const sh1 = boxWeb._els['[data-a="share"]'], sv1 = boxWeb._els['[data-a="save"]'];
  check("Share stays visible even when there is no canShare (button is never hidden)", sh1.hidden === false);
  check("Save still uses the blob URL and filename", sv1.href === "blob:1" && sv1.download === "clip.mp4");
  check("web preview: Share is enabled at once (file is already in memory)", sh1.disabled === false && typeof sh1.onclick === "function");

  const boxNoShare = mkBox();
  S.wirePreviewButtons(boxNoShare, file, "blob:2", "clip.webm", { navigator: { canShare: () => false } });
  check("without canShare or native plugins, Share stays visible and the tap falls back to Save/download", boxNoShare._els['[data-a="share"]'].hidden === false);
  const fb = await boxNoShare._els['[data-a="share"]'].onclick();
  check("tap fallback triggers the Save/download control", fb.via === "download" && boxNoShare._els['[data-a="save"]'].clicked === true);

  const prevB64 = S.blobToBase64;
  S.blobToBase64 = () => Promise.resolve("AAAA");
  let writeStarted = false, resolveWrite;
  const waitFs = {
    writeFile() { writeStarted = true; return new Promise((res) => { resolveWrite = res; }); },
    getUri() { return Promise.resolve({ uri: "file:///cache/share/clip.mp4" }); }
  };
  const cap = { isNativePlatform: () => true, Plugins: { Share: { share(opts) { return Promise.resolve(opts); } }, Filesystem: waitFs } };
  const boxNat = mkBox();
  const wN = S.wirePreviewButtons(boxNat, file, "blob:3", "clip.mp4", { Capacitor: cap, navigator: {} });
  const shN = boxNat._els['[data-a="share"]'];
  check("native preview: Share is disabled as soon as prepare starts (so the later tap can open the sheet at once)", shN.disabled === true && wN.state.uri == null);
  await Promise.resolve();
  await Promise.resolve();
  check("native preview: the video is written to cache after encode, before Share is enabled", writeStarted === true && typeof resolveWrite === "function" && shN.disabled === true);
  resolveWrite();
  await wN.ready;
  check("native preview: Share is enabled and the file URI is ready before the tap", shN.disabled === false && wN.state.uri === "file:///cache/share/clip.mp4");
  const tapped = await shN.onclick();
  check("native tap opens Capacitor Share with the cached file URI (system sheet)", tapped.via === "native");
  S.blobToBase64 = prevB64;

  // If prepare fails, Share is re-enabled and the tap can still fall back to download.
  const badFs = { writeFile() { return Promise.reject(new Error("disk")); }, getUri() { return Promise.resolve({ uri: "x" }); } };
  const boxBad = mkBox();
  const wBad = S.wirePreviewButtons(boxBad, file, "blob:4", "clip.webm", { Capacitor: { isNativePlatform: () => true, Plugins: { Share: { share() { return Promise.resolve(); } }, Filesystem: badFs } }, navigator: { canShare: () => false } });
  await wBad.ready;
  const shBad = boxBad._els['[data-a="share"]'];
  const rBad = await shBad.onclick();
  check("native prepare failure: Share is re-enabled and the tap falls back to download", shBad.disabled === false && rBad.via === "download");

  const ok = R.filter(Boolean).length;
  console.log(`\n${ok}/${R.length} passed`);
  if (ok !== R.length) process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
