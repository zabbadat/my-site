// Camera-on indicator (Nov 17, owner): a "Camera on" pill with a pulsing red dot on every live camera view of this device,
// on all platforms, gone when the camera stops; never green (the face-cover proof's green test), never blocks taps.
const fs = require("fs"), path = require("path");
const CI = require("../cam-indicator.js"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); c ? pass++ : fail++; };
const track = (state = "live", enabled = true) => ({ readyState: state, enabled });
const stream = (...t) => ({ getVideoTracks: () => t, getTracks: () => t });
const vid = (o) => Object.assign({ isConnected: true, hidden: false, id: "camVid", clientWidth: 390, clientHeight: 520, srcObject: stream(track()) }, o);
check("live video track -> live", CI.liveVideo(stream(track())));
check("stopped track (ended) -> not live", !CI.liveVideo(stream(track("ended"))));
check("disabled track -> not live", !CI.liveVideo(stream(track("live", false))));
check("audio only / no stream -> not live", !CI.liveVideo(stream()) && !CI.liveVideo(null));
for (const id of ["camVid", "plankVid", "sqVid", "tbVid", "zlSelf", "zmCamVid"]) check(`pill on the live ${id} view`, CI.wants(vid({ id })));
check("no pill after the camera stops (track ended)", !CI.wants(vid({ srcObject: stream(track("ended")) })));
check("no pill when the stream is removed", !CI.wants(vid({ srcObject: null })));
check("no pill on a closed / hidden / zero-size view", !CI.wants(vid({ isConnected: false })) && !CI.wants(vid({ hidden: true })) && !CI.wants(vid({ clientWidth: 0 })));
check("a remote player's video (Live Match tile, not our getUserMedia) gets no pill", !CI.wants(vid({ id: "zlVid1" })));
const own = stream(track()); own._zabOwnCam = true;
check("any other view showing our own camera stream gets the pill", CI.wants(vid({ id: "someNewCam", srcObject: own })));
// colours: no face-proof green anywhere (G>180, R<90, B<90), red dot, high-contrast white on near-black
const cols = (CI.CSS.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/gi) || []).map((c) => c[0] === "#" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.replace(/[^\d.,]/g, "").split(",").slice(0, 3).map(Number));
check(`no colour trips the face-proof green (${cols.length} colours)`, cols.length > 3 && cols.every(([r, g, b]) => !(g > 180 && r < 90 && b < 90)));
check("red pulsing dot + 'Camera on' label, white on near-black", CI.LABEL === "Camera on" && /^#ff3b30$/i.test(CI.COLORS.dot) && /@keyframes camOnPulse/.test(CI.CSS) && /color:#ffffff/.test(CI.CSS) && /background:rgba\(12,12,16,\.86\)/.test(CI.CSS));
check("never blocks taps; above the face cover (z-index 6 > shield 1 / cover 2)", /pointer-events:none/.test(CI.CSS) && /z-index:6/.test(CI.CSS));
check("respects reduced motion", /prefers-reduced-motion:reduce\)\{\.cam-on-dot\{animation:none\}/.test(CI.CSS));
check("fallback fixed pill (camera live, no view on screen) respects the notch", /cam-on-fixed\{position:fixed;[^}]*safe-area-inset-top/.test(CI.CSS));
check("index.html loads cam-indicator.js on every page load (all platforms: the apps load this site)", /<script src="\/cam-indicator\.js"><\/script>/.test(html));
const src = fs.readFileSync(path.join(__dirname, "..", "cam-indicator.js"), "utf8");
check("goes away at once: track.stop(), track ended, stream emptied / inactive, view resize, orientation", /MT\.stop = function/.test(src) && /addEventListener\("ended", sync\)/.test(src) && /"emptied"/.test(src) && /"inactive"/.test(src) && /orientationchange/.test(src));
console.log(`${pass}/${pass + fail} passed`); if (fail) process.exitCode = 1;
