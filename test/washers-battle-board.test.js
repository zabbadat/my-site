// Tests for the Zabba Washer Battle live board: clock formatting, elapsed from shared startAt, frozen/forfeit/left rows.
const W = require("../washers-battle.js");
const fs = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("fmtClock mm:ss", W.fmtClock(0) === "00:00" && W.fmtClock(65999) === "01:05" && W.fmtClock(-5) === "00:00");
check("fmtClock h:mm:ss past an hour", W.fmtClock(3723000) === "1:02:03");
const room = { status: "live", startAt: 100000, players: {} };
check("elapsed from shared startAt", W.elapsedMs(room, { name: "A" }, 165000) === 65000);
check("elapsed 0 before GO / no startAt", W.elapsedMs(room, {}, 90000) === 0 && W.elapsedMs({ startAt: null }, {}, 5) === 0);
check("elapsed frozen at result.ms once finished", W.elapsedMs(room, { result: { score: 21, steps: 9, ms: 42000, verified: true, reasons: [], at: 1 } }, 999999) === 42000);
const ps = [
  { uid: "a", name: "Zab", score: 7, steps: 40 },
  { uid: "b", name: "Pal", score: 21, steps: 88, result: { score: 21, steps: 90, ms: 61000, verified: true, reasons: [], at: 1 } },
];
let rows = W.boardRows(room, ps, "a", 130000, { score: 9, steps: 55 });
check("my row uses local live values + (you)", rows[0].name === "Zab (you)" && rows[0].scoreText === "9/21" && rows[0].stepsText === "55" && rows[0].timeText === "00:30" && rows[0].ticking);
check("finished row frozen: 21/21, result steps, final time ✓", rows[1].scoreText === "21/21" && rows[1].steps === 90 && rows[1].timeText === "01:01 ✓" && !rows[1].ticking && rows[1].state === "finished");
rows = W.boardRows(room, ps, "b", 200000, null);
check("opponent row from room doc, ticking", rows[0].scoreText === "7/21" && rows[0].stepsText === "40" && rows[0].timeText === "01:40" && rows[0].ticking);
rows = W.boardRows(room, [{ uid: "a", name: "A", score: 4, steps: 3, result: { forfeit: true, at: 1 } }, { uid: "b", name: "B", score: 2, leftAt: 5 }], "z", 200000);
check("forfeit and left shown, not ticking", rows[0].timeText === "Forfeit" && rows[1].timeText === "Left" && !rows[0].ticking && !rows[1].ticking);
check("steps thousands separator", W.boardRows(room, [{ uid: "a", steps: 12345 }], "z", 100000)[0].stepsText === "12,345");
check("score clamped to 21", W.boardRows(room, [{ uid: "a", score: 30 }], "z", 100000)[0].scoreText === "21/21");
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
check("board on both screens: lobby + game controls", html.includes('id="wbBoard"') && html.includes('id="wbPlayBoard"') && html.indexOf('id="wbPlayBoard"') > html.indexOf('<section id="play">') && html.indexOf('id="wbPlayBoard"') < html.indexOf('id="startBtn"'));
check("board separate from result line (wbStatus)", html.indexOf('id="wbBoard"') !== html.indexOf('id="wbStatus"') && /function wbBoardPaint\(/.test(html));
check("no new Firestore fields: board writes nothing", !/wbBoardPaint[\s\S]{0,1200}(update|submitResult|publishLive)\(/.test(html.slice(html.indexOf("function wbBoardPaint("), html.indexOf("function wbBoardPaint(") + 1200)));
const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
