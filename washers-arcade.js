/* Zabba Washer Battle arcade scoreboard: pure view model + HTML for #wbBoard / #wbPlayBoard (washers-battle.js decides
 * everything; this only maps the match to arcade language) plus quiet WebAudio cues. Same look on one shared screen or on
 * each phone. Names only: anything that looks like an email is never printed. All animation is CSS in index.html and is
 * switched off by prefers-reduced-motion. Browser: window.ZabbaArcade. Node: require("./washers-arcade.js").
 */
(function (root) {
  const req = (n, g) => (typeof module !== "undefined" && module.exports ? require(n) : root && root[g]);
  const WB = req("./washers-battle.js", "ZabbaWasherBattle");
  const TARGET = 21;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const EMAIL = /\S+@\S+/;
  const safeName = (n) => { const t = String(n == null ? "" : n).trim().slice(0, 40); return !t || EMAIL.test(t) ? "Player" : t; };
  const TIERS = { shaky: "SHAKY", steady: "STEADY", trusted: "TRUSTED" };
  // shared 5 s countdown -> Ready, Set, 3, 2, 1, GO
  function countdownLabel(cd) {
    if (!cd || cd.phase === "wait") return "READY";
    if (cd.phase === "go" || cd.phase === "live") return "GO!";
    return { 5: "READY", 4: "SET" }[cd.n] || String(Math.max(1, cd.n | 0));
  }
  // Match -> { key, title, sub }.  key: waiting ready countdown bariboshi live disputed finished cancelled
  function mode(r, ctx) {
    ctx = ctx || {}; const nowMs = ctx.nowMs, toMs = ctx.toMs, names = {};
    const st = WB.matchState(r, nowMs, toMs);
    if (!r || st === "cancelled") return { key: "cancelled", title: "GAME OVER", sub: "This room is closed" };
    Object.keys(r.players || {}).forEach((u) => { names[u] = safeName(r.players[u].name); });
    if (st === "waiting") return { key: "waiting", title: "INSERT COIN", sub: "Waiting for challenger" };
    if (st === "ready") { const both = Object.keys(r.players).every((u) => r.players[u].ready); return { key: "ready", title: "READY?", sub: both ? "Both ready" : "Tap I'm ready" }; }
    if (st === "countdown") return { key: "countdown", title: countdownLabel(ctx.cd), sub: "Get set to pitch" };
    const dec = WB.decide(r), an = WB.analyze(r);
    if (st === "finished" || dec.done) {
      if (dec.winner == null) return { key: "finished", title: dec.reason === "tie" ? "DRAW" : "GAME OVER", sub: dec.reason === "tie" ? "Level after the last round" : "Both players left", winner: null };
      return { key: "finished", title: "K.O.", sub: "WINNER: " + names[dec.winner] + (dec.reason === "forfeit" ? " (forfeit)" : ""), winner: dec.winner };
    }
    if (an.disputed.length) return { key: "disputed", title: "REFEREE CHECK", sub: names[an.disputed[0].ruler] + " (Bariboshi winner) rules round " + an.disputed[0].n };
    const bs = WB.boardStatus(r, nowMs, toMs);
    if (!an.order) return { key: "bariboshi", title: "OPENING PITCH", sub: bs.extra || "Bariboshi: closest to the cup goes first" };
    const c = an.current, n = c && c.kind === "r" ? c.n : an.partial ? an.partial.n : an.rounds.length + 1;
    return { key: "live", title: "ROUND " + n + (an.overtime ? " · OVERTIME" : ""), sub: bs.extra || "", round: n };
  }
  // players: ordered [{uid,...seat}] (battle-rooms orderedPlayers). ctx: { nowMs, toMs, cd, reps:{uid:0..100} , serverNow }
  function model(r, players, uid, ctx) {
    ctx = ctx || {}; const REP = ctx.REP || req("./reputation.js", "ZabbaReputation");
    const labels = {}, tiers = {};
    (players || []).forEach((p) => { if (ctx.reps && ctx.reps[p.uid] != null && REP) { const t = REP.tier(ctx.reps[p.uid]); tiers[p.uid] = t.key; labels[p.uid] = TIERS[t.key] + " " + REP.normalize(ctx.reps[p.uid]); } });
    const m = mode(r, ctx), rows = WB.boardRows(r, players, uid, labels), an = WB.analyze(r), dec = WB.decide(r);
    const round = m.round || (an.valid ? an.rounds.length + 1 : 1);
    return { mode: m, round, me: uid, rows: rows.map((x, i) => ({ uid: x.uid, tag: "P" + (i + 1), name: safeName((x.name || "").replace(/ \(you\)$/, "")), you: x.uid === uid, repText: x.repText, tier: tiers[x.uid] || "",
      total: x.total, pct: Math.min(100, Math.round((x.total / TARGET) * 100)), roundText: x.roundText, turnText: x.turnText, status: x.status, tallyText: x.tallyText, stepsText: x.stepsText,
      turn: m.key === "live" && /^Pitching/.test(x.turnText), win: m.key === "finished" && dec.winner === x.uid, disputed: m.key === "disputed" && x.status === "Disputed", out: x.state === "forfeit" || x.state === "left" })) };
  }
  // ---- Plank Battles / TUT Battles: same skin, game-specific rows. Rows carry big (static score text), unit, pct, extraLabel/extraText.
  const PB = () => req("./plank-battle.js", "ZabbaPlankBattle"), TB = () => req("./tut-battle.js", "ZabbaTutBattle");
  const clock = (ms) => { const t = Math.max(0, Math.floor((ms || 0) / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  // room -> { key, title, sub, winner? }; dec = { done, winner, reason } from the game module (null = undecided)
  function battleMode(game, r, ctx, dec, names) {
    ctx = ctx || {};
    if (!r || r.status === "abandoned") return { key: "cancelled", title: "GAME OVER", sub: "This room is closed" };
    const ids = Object.keys(r.players || {});
    if (r.status === "waiting" || (r.status !== "countdown" && r.status !== "live" && r.status !== "done")) {
      if (ids.length < 2) return { key: "waiting", title: "INSERT COIN", sub: "Waiting for challenger" };
      const both = ids.every((u) => r.players[u].ready);
      const st = r.stake ? " · wager " + r.stake + " ZAB each" : "";
      return { key: "ready", title: "READY?", sub: (both ? (r.stake ? "Waiting for both stakes" : "Both ready") : "Tap I'm ready") + st };
    }
    if (r.status === "countdown") return { key: "countdown", title: countdownLabel(ctx.cd), sub: "Get into position" };
    if (dec && dec.done) {
      if (dec.winner == null) return { key: "finished", title: dec.reason === "both-out" ? "GAME OVER" : "DRAW", sub: dec.reason === "both-out" ? "Both players left" : (r.stake ? "Level: stakes refunded" : "Level"), winner: null };
      return { key: "finished", title: "K.O.", sub: "WINNER: " + names[dec.winner] + (dec.reason === "forfeit" ? " (forfeit)" : ""), winner: dec.winner };
    }
    if (game === "plank") return { key: "live", title: "HOLD ON", sub: dec && dec.waiting ? "Checking: holds within 1 s draw" : "Longest hold wins" };
    const left = ctx.timeLeft;
    return { key: "live", title: "TUT BATTLE", sub: left == null ? "Most time under tension wins" : clock(left) + " left" };
  }
  // game: "plank" | "tut". ctx: { nowMs, cd, reps, draw (tut: time-up draw), timeLeft (tut ms) }
  function battleModel(game, r, players, uid, ctx) {
    ctx = ctx || {}; const REP = ctx.REP || req("./reputation.js", "ZabbaReputation");
    const P = PB(), T = TB(), names = {}, tiers = {}, labels = {};
    (players || []).forEach((p) => { names[p.uid] = safeName(p.name); if (ctx.reps && ctx.reps[p.uid] != null && REP) { const t = REP.tier(ctx.reps[p.uid]); tiers[p.uid] = t.key; labels[p.uid] = TIERS[t.key] + " " + REP.normalize(ctx.reps[p.uid]); } });
    let dec = null, fl = null;
    if (r && game === "plank" && P) dec = P.decide(r, ctx.nowMs);
    if (r && game === "tut" && T) {
      fl = T.forfeitLoser(r);
      if (r.status === "done" && r.winnerUid) dec = { done: true, winner: r.winnerUid, reason: r.loseReason === "left" ? "forfeit" : "loss" };
      else if (fl) dec = fl.both ? { done: true, winner: null, reason: "both-out" } : { done: true, winner: T.other(r, fl.loser), reason: "forfeit" };
      else if (ctx.draw) dec = { done: true, winner: null, reason: "draw" };
    }
    const m = battleMode(game, r, ctx, dec, names), live = m.key === "live" || m.key === "finished";
    const rows = (players || []).slice(0, 2).map((p, i) => {
      const seat = (r && r.players && r.players[p.uid]) || {}, res = seat.result;
      let big = "0:00", pct = 0, status = "", extraLabel = "", extraText = "", total = 0, turn = false, out = false;
      if (game === "plank") {
        const drop = !!(res && !res.forfeit && res.holdMs != null);
        const known = Math.max.apply(null, [0].concat(Object.keys(r && r.players || {}).map((u) => { const x = r.players[u].result; return x && !x.forfeit && x.holdMs != null ? x.holdMs : 0; })));
        const hold = drop ? res.holdMs : m.key === "finished" ? known : (r && r.startAt != null && m.key === "live" && ctx.nowMs != null ? Math.max(0, Math.min(P.MAX_MS, ctx.nowMs - r.startAt)) : 0);
        big = clock(hold); pct = Math.min(100, Math.round((hold / Math.max(60000, hold)) * 100));
        const isOut = P && r && r.players && P.outBy(r, p.uid);
        out = !!isOut; turn = m.key === "live" && !drop && !isOut;
        status = isOut ? (res && res.forfeit ? "FORFEIT" : seat.leftAt ? "LEFT" : "SILENT") : drop ? "DROPPED" : m.key === "live" ? "HOLDING" : (seat.ready ? "READY" : "");
        extraLabel = "HOLD"; extraText = drop ? clock(res.holdMs) + (res.verified === false ? " (unverified)" : "") : (m.key === "live" ? "on" : "-");
      } else {
        const reps = seat.reps | 0, tut = Math.round(seat.tutMs) || 0;
        const mineLive = ctx.mine && ctx.mine.uid === p.uid && m.key === "live" ? ctx.mine : null;
        const tm = mineLive ? mineLive.tutMs : tut, rp = mineLive ? mineLive.reps : reps;
        big = clock(tm); total = rp; pct = Math.min(100, Math.round((tm / ((T && T.RULES.durationMs) || 180000)) * 100));
        const isOut = fl && (fl.both || fl.loser === p.uid) || (r && r.status === "done" && r.loserUid === p.uid && r.loseReason === "left");
        out = !!isOut; turn = m.key === "live" && !isOut;
        status = isOut ? "LEFT" : r && r.status === "done" && r.loserUid === p.uid ? "OUT" : m.key === "live" ? "REPPING" : (seat.ready ? "READY" : "");
        extraLabel = "REPS"; extraText = String(rp);
      }
      return { uid: p.uid, tag: "P" + (i + 1), name: names[p.uid], you: p.uid === uid, repText: labels[p.uid] || "", tier: tiers[p.uid] || "", total, big, unit: game === "plank" ? "HOLD" : "TUT", pct,
        roundText: game === "plank" ? "LONGEST HOLD" : "TIME UNDER TENSION", turnText: "", status, tallyText: live && dec && dec.done ? (dec.winner === p.uid ? "WINNER" : dec.winner == null ? "LEVEL" : "") : "", extraLabel, extraText,
        turn, win: m.key === "finished" && dec && dec.winner === p.uid, disputed: false, out };
    });
    return { mode: m, round: 1, me: uid, game, rows };
  }
  // prev model -> cur model: which animations/sounds fire (nothing on the first paint)
  function fx(prev, cur) {
    const out = { flash: {}, shake: {}, banner: "", sound: [] };
    if (!prev || !cur) return out;
    cur.rows.forEach((row) => { const pr = prev.rows.find((x) => x.uid === row.uid); if (pr && row.total > pr.total) { out.flash[row.uid] = true; if (out.sound.indexOf("score") < 0) out.sound.push("score"); } });
    if (cur.mode.key === "disputed" && prev.mode.key !== "disputed") cur.rows.forEach((row) => { if (row.disputed) out.shake[row.uid] = true; });
    if (cur.mode.key === "live" && ((prev.mode.key !== "live" && prev.mode.key !== "disputed") || cur.round > prev.round)) { out.banner = cur.mode.title; out.sound.push("round"); }
    if (cur.mode.key === "finished" && prev.mode.key !== "finished") { out.banner = cur.mode.title; const w = cur.mode.winner; if (w == null || w === cur.me || !cur.rows.some((x) => x.uid === cur.me)) out.sound.push("win"); }
    return out;
  }
  function html(m, f, prev) {
    f = f || { flash: {}, shake: {} };
    const panel = (x, i) => {
      const from = prev ? (prev.rows.find((y) => y.uid === x.uid) || x).total : x.total;
      const cls = ["arc-panel", i ? "arc-p2" : "arc-p1", x.turn ? "arc-turn" : "", x.win ? "arc-win" : "", x.out ? "arc-out" : "", f.flash && f.flash[x.uid] ? "arc-flash" : "", f.shake && f.shake[x.uid] ? "arc-shake" : ""].filter(Boolean).join(" ");
      return '<section class="' + cls + '" aria-label="' + esc(x.name) + (x.big != null ? " " + esc(x.unit) + " " + esc(x.big) : " score " + x.total + " of " + TARGET) + '">'
        + '<header><span class="arc-tag">' + x.tag + '</span><span class="arc-name">' + esc(x.name) + (x.you ? ' <em>YOU</em>' : "") + '</span>'
        + (x.repText ? '<span class="arc-badge arc-rep-' + esc(x.tier) + '" title="Reputation">' + esc(x.repText) + "</span>" : "") + "</header>"
        + (x.big != null ? '<div class="arc-score arc-static"><span class="n">' + esc(x.big) + "</span><small>" + esc(x.unit) + "</small></div>"
          + '<div class="arc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + x.pct + '"><i style="width:' + x.pct + '%"></i></div>'
          : '<div class="arc-score"><span class="n">' + x.total + '</span><span class="c" aria-hidden="true" style="--from:' + from + ";--to:" + x.total + '"></span><small>/' + TARGET + "</small></div>"
          + '<div class="arc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + TARGET + '" aria-valuenow="' + Math.min(TARGET, x.total) + '"><i style="width:' + x.pct + '%"></i></div>')
        + '<div class="arc-meta"><span>' + esc((x.roundText || "").toUpperCase()) + '</span><span class="arc-turnline">' + (x.turn ? "&#9654; " : "") + esc((x.status || "").toUpperCase()) + "</span></div>"
        + '<div class="arc-tally">' + esc(x.tallyText) + "</div>"
        + '<div class="arc-steps">' + esc(x.extraLabel || "STEPS") + " <b>" + esc(x.extraLabel ? x.extraText : x.stepsText) + "</b></div></section>";
    };
    return '<div class="arc-top"><span class="arc-state arc-s-' + m.mode.key + '">' + esc(m.mode.title) + '</span><span class="arc-sub">' + esc(m.mode.sub) + "</span></div>"
      + '<div class="arc-panels">' + (m.rows[0] ? panel(m.rows[0], 0) : "") + '<div class="arc-vs">VS</div>' + (m.rows[1] ? panel(m.rows[1], 1) : '<section class="arc-panel arc-p2 arc-empty"><header><span class="arc-tag">P2</span><span class="arc-name">???</span></header><div class="arc-score"><span class="n">--</span></div></section>') + "</div>";
  }
  const bannerHtml = (text, win) => (text ? '<div class="arc-banner' + (win ? " arc-banner-win" : "") + '" role="status">' + esc(text) + "</div>" : "");
  // ---- sound: quiet WebAudio beeps, only after unlock() inside a user gesture, never if audio is unavailable ----
  const CUES = { score: [[880, 0.07], [1320, 0.09]], round: [[440, 0.08], [660, 0.08], [880, 0.12]], win: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.28]] };
  const VOLUME = 0.04;
  function makeSound(win) {
    const AC = win && (win.AudioContext || win.webkitAudioContext); let ctx = null, unlocked = false, muted = false;
    try { muted = !!(win && win.localStorage && win.localStorage.getItem("zdArcMute") === "1"); } catch (e) {}
    const api = {
      available: !!AC, cues: CUES,
      get muted() { return muted; }, get unlocked() { return unlocked; },
      setMuted(v) { muted = !!v; try { win.localStorage.setItem("zdArcMute", muted ? "1" : "0"); } catch (e) {} return muted; },
      unlock() { if (!AC) return false; try { ctx = ctx || new AC(); if (ctx.state === "suspended" && ctx.resume) ctx.resume(); unlocked = true; } catch (e) { return false; } return unlocked; },
      cue(name) {
        if (!AC || !unlocked || muted || !ctx || !CUES[name]) return false;
        try { let t = ctx.currentTime + 0.01;
          CUES[name].forEach(([f, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = f; g.gain.setValueAtTime(VOLUME, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + 0.02); t += d; });
        } catch (e) { return false; }
        return true;
      },
    };
    return api;
  }
  const api = { clock, battleMode, battleModel, TARGET, TIERS, VOLUME, CUES, safeName, countdownLabel, mode, model, fx, html, bannerHtml, makeSound, esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaArcade = api;
})(typeof window !== "undefined" ? window : null);
