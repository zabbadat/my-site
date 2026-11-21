const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pfp = fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8");
const rec = fs.readFileSync(path.join(__dirname, "..", "rec.js"), "utf8");
const fsJs = fs.readFileSync(path.join(__dirname, "..", "washers-fs.js"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

check("solo live camera fills the full-screen wrap (absolute inset 0)", /#zmGame\.cam-fs \.zl-self-wrap,#zmLiveSlot\.cam-fs \.zl-self-wrap,#zmCamBox\.cam-fs #zmCamWrap\{[^}]*position:absolute[^}]*inset:0/.test(html));
check("solo live video is contain, full size, not a leftover column sliver", /#zmGame\.cam-fs #zlSelf[\s\S]{0,200}width:100%;height:100%[\s\S]{0,80}object-fit:contain/.test(html));
check("solo full screen hides the score/time strip (no top band)", /#zmGame\.cam-fs \.washers-fs-strip,#zmLiveSlot\.cam-fs \.washers-fs-strip\{display:none!important\}/.test(html));
check("solo full screen hides names, scoring pad, End, More and all live controls (not deleted)", /#zmGame\.cam-fs #zmPad/.test(html) && /#zmGame\.cam-fs #zlLiveControls,#zmLiveSlot\.cam-fs #zlLiveControls/.test(html) && /#zmGame\.cam-fs \.zm-seats/.test(html) && /display:none!important/.test(html.slice(html.indexOf("#zmGame.cam-fs .zm-code-row"), html.indexOf("#zmGame.cam-fs .zm-code-row") + 900)));
check("scoring keys stay in the markup (Bank 5, Shoot 3, Box-bound 2, Out 0, Undo, Submit pack)", /data-zm="5">Bank 5</.test(html) && /data-zm="3">Shoot 3</.test(html) && /data-zm="2">Box-bound 2</.test(html) && /data-zm="0">Out 0</.test(html) && /id="zmUndo"/.test(html) && /id="zmSubmit"/.test(html));
check("live control ids are kept (hidden, not deleted)", ["zlGoLive","zmRecBtn","zlMute","zlFlip","zlStop","zlWatchBoth","zlYtBtn","zlFsBtn","zlEndBtn","zlMoreBtn"].every((id) => html.includes('id="' + id + '"')));
check("phone back / browser back (popstate) and Escape leave the solo camera the same way End does", /history\.pushState\(\{ zabWashersCamFs: 1 \}/.test(html) && /addEventListener\("popstate"/.test(html) && /e\.key !== "Escape"/.test(html) && /leaveSolo/.test(html) && /zlCastStop/.test(html));
check("More toggle and exit() clear remain for later (handlers kept)", /zlMoreBtn"\)\.onclick/.test(html) && /classList\.remove\("cam-fs-more"\)/.test(fsJs));
check("push/TUT camera video also fills cam-fs; Exit full screen is hidden while already full screen", /#camWrap\.cam-fs video\{[^}]*position:absolute[^}]*inset:0[^}]*height:100%/.test(html) && /#camWrap\.cam-fs #camFsBtn\{display:none!important\}/.test(html));
check("End set stays on the push/TUT camera", /id="camEndBtn"/.test(html) && /class="btn cam-end-btn"/.test(html));
check("production OPEN_IDS is unchanged", /var OPEN_IDS = \{ camVid: 1, plankVid: 1, tbVid: 1, sqVid: 1, zlSelf: 1, zmCamVid: 1 \};/.test(pfp));
check("never reintroduce openMask, coverBack, or a rec.js dark cover", !/\bopenMask\b/.test(html + pfp + rec) && !/coverBack blanket/.test(pfp) && !/full-frame dark/.test(rec));
check("viewport-fit=cover so the camera can extend into the notch / status-bar inset", /name="viewport"[^>]*viewport-fit=cover/.test(html));
check("solo cam-fs is 100dvh, 100vh fallback, z-index above headers, no padding-top gap", /#zmGame\.cam-fs,#zmLiveSlot\.cam-fs,#zmCamBox\.cam-fs,#zlStage\.cam-fs\{[^}]*z-index:2147483000[^}]*height:100vh;height:100dvh[^}]*padding:0!important/.test(html));
check("body scroll and site chrome are hidden while solo cam-fs is open, and restored on exit", /zab-solo-cam-fs/.test(html) && /html\.zab-solo-cam-fs,html\.zab-solo-cam-fs body\{overflow:hidden/.test(html) && /html\.zab-solo-cam-fs nav/.test(html) && /unlockPage/.test(html) && /lockPage/.test(html));
check("opening gesture requests Fullscreen API on the cast container (webkit fallback; not on #zlSelf alone)", /requestNativeFs/.test(html) && /requestFullscreen \|\| node\.webkitRequestFullscreen/.test(html) && /navigationUI: "hide"/.test(html) && /WashersFs\.enterCast\(\); if \(window\.WashersFs\.requestNativeFs\)/.test(html) && !/zlSelf\)[^;]{0,80}webkitEnterFullscreen/.test(html));
check("leaving native fullscreen, Back, or Escape all run leaveSolo once (no double-fire)", /fullscreenchange/.test(html) && /webkitfullscreenchange/.test(html) && /if \(leaving\) return/.test(html) && /exitNativeFs/.test(html) && /addEventListener\("popstate"/.test(html) && /e\.key !== "Escape"/.test(html));

const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
