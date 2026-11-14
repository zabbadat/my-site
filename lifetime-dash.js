/* Per-user lifetime dashboard. Pure helpers (no DOM, no Firestore).
 * Browser: window.ZabbadatDash. Node: require("./lifetime-dash.js").
 *
 * Sources (each kind counted once; never add the matching zabLedger earn on top of the session doc):
 *   steps     dailySteps/{uid}_{YYYY-MM-DD}.steps  (days posted while signed in)
 *   push-ups  sum of pushups/{id}.reps for this uid (solo sets, TUT, 3:00 challenge)
 *   TUT       ZabbadatSession.tutLifetime (reuse; 1:20 + 10 push-ups, minimums not a cap)
 *   planks    planks/{id} holds; oneMinutePlanks: 1 per continuous hold >= 60,000 ms
 *   holds     zabLedger source "hold" (plank push press, 0.5 ZAB each)
 *   10K       zabLedger source "steps10k" (id steps10k-YYYY-MM-DD, +4 ZAB)
 *   washers   solo games/{id} verified 21s; washersBattleSeason wins/losses (all seasons);
 *             Live Match matches/{code} finished games (W/L/T). Ledger source "washers" = solo-win ZAB only.
 */
(function (root) {
  "use strict";
  var BONUS = 4, SOURCE = "steps10k", ONE_MINUTE_MS = 60000, GOAL_STEPS = 10000, HOLD_ZAB = 0.5;
  var ET = typeof module !== "undefined" && module.exports ? (function () { try { return require("./et-day.js"); } catch (e) { return null; } })() : (root && root.ZabbadatEtDay);

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function shiftDay(key, delta) {
    var p = String(key || "").split("-");
    if (p.length !== 3) return "";
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + Number(delta) || 0));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function etOf(s) { return (s && s.et) || ET; }
  function dayKeyAt(ms, s) {
    var et = etOf(s), t = ms || 0;
    if (et && typeof et.key === "function") return et.key(t || Date.now());
    var d = new Date(t || Date.now());
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number" && isFinite(v)) return v;
    if (v instanceof Date) return v.getTime();
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.toDate === "function") return v.toDate().getTime();
    if (typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds || 0) / 1e6;
    return 0;
  }
  function dayKeyOf(tx) {
    var sid = tx && tx.setId != null ? String(tx.setId) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(sid)) return sid;
    var id = String((tx && tx.id) || "");
    var m = /(?:^|steps10k-)(\d{4}-\d{2}-\d{2})$/.exec(id);
    return m ? m[1] : "";
  }
  function formatDay(key) {
    var p = String(key || "").split("-");
    if (p.length !== 3) return String(key || "");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
    return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }
  // Same shape as the page formatTut: m:ss, or h:mm:ss when needed.
  function formatHold(ms) {
    var t = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = pad(t % 60);
    return h ? h + ":" + pad(m) + ":" + sec : m + ":" + sec;
  }
  function weekStart(todayKey) {
    var p = String(todayKey || "").split("-");
    if (p.length !== 3) return "";
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)), dow = d.getUTCDay(), back = dow === 0 ? 6 : dow - 1;
    return shiftDay(todayKey, -back);
  }
  function inWeek(day, todayKey) {
    var start = weekStart(todayKey), end = shiftDay(start, 6);
    return !!day && day >= start && day <= end;
  }

  function fromLedger(docs) {
    var by = {};
    (docs || []).forEach(function (t) {
      if (!t || t.source !== SOURCE) return;
      var d = dayKeyOf(t);
      if (!d) return;
      var steps = Math.floor(Number(t.qty) || 0);
      if (steps < 10000) steps = 10000;
      var zab = Number(t.amount);
      if (!(zab > 0)) zab = BONUS;
      if (!by[d] || steps > by[d].steps) by[d] = { date: d, steps: steps, zab: zab };
    });
    return Object.keys(by).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; }).map(function (k) { return by[k]; });
  }
  function streaks(days, todayKey) {
    var set = {}, i, d, n, current = 0, best = 0, run = 0, prev = "";
    (days || []).forEach(function (x) {
      d = typeof x === "string" ? x : (x && x.date);
      if (d) set[d] = 1;
    });
    var keys = Object.keys(set).sort();
    for (i = 0; i < keys.length; i++) {
      d = keys[i];
      run = (prev && d === shiftDay(prev, 1)) ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    }
    d = todayKey;
    if (d && !set[d]) d = shiftDay(d, -1);
    if (d && set[d]) { n = d; while (set[n]) { current += 1; n = shiftDay(n, -1); } }
    return { current: current, best: best };
  }
  function summarize10k(docs, todayKey) {
    var list = fromLedger(docs), st = streaks(list, todayKey), zab = 0, i;
    for (i = 0; i < list.length; i++) zab += Number(list[i].zab) || 0;
    return { count: list.length, zab: zab, currentStreak: st.current, bestStreak: st.best, milestones: list };
  }
  function lifetimeSteps(rows, uid) {
    var by = {}, total = 0, d, n;
    (rows || []).forEach(function (r) {
      if (!r || (uid && r.uid && r.uid !== uid)) return;
      d = r.date; n = Math.floor(Number(r.steps) || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "") || n <= 0) return;
      if (!by[d] || n > by[d]) by[d] = n;
    });
    Object.keys(by).forEach(function (k) { total += by[k]; });
    return total;
  }
  function bestDaySteps(rows, uid) {
    var best = 0, day = "";
    var by = {};
    (rows || []).forEach(function (r) {
      if (!r || (uid && r.uid && r.uid !== uid)) return;
      var d = r.date, n = Math.floor(Number(r.steps) || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "") || n <= 0) return;
      if (!by[d] || n > by[d]) by[d] = n;
    });
    Object.keys(by).forEach(function (k) { if (by[k] > best) { best = by[k]; day = k; } });
    return { steps: best, date: day };
  }
  function todaySteps(rows, uid, today) {
    var n = 0;
    (rows || []).forEach(function (r) {
      if (!r || r.date !== today || (uid && r.uid && r.uid !== uid)) return;
      var v = Math.floor(Number(r.steps) || 0);
      if (v > n) n = v;
    });
    return n;
  }
  function pushupStats(rows, uid) {
    var n = 0, best = 0;
    (rows || []).forEach(function (r) {
      if (!r || (uid && r.uid && r.uid !== uid)) return;
      var reps = Math.floor(Number(r.reps) || 0);
      if (reps > 0) n += reps;
      if (reps > best) best = reps;
    });
    return { total: n, best: best };
  }
  function lifetimePushups(rows, uid) { return pushupStats(rows, uid).total; }
  function lifetimeTut(rows, uid, session) {
    if (session && typeof session.tutLifetime === "function") return session.tutLifetime(rows, uid);
    return 0;
  }
  function bestTutMs(rows, uid, session) {
    var best = 0;
    (rows || []).forEach(function (r) {
      if (!r || (uid && r.uid && r.uid !== uid)) return;
      if (session && session.isTutSetDoc && !session.isTutSetDoc(r)) return;
      var ms = Number(r.ms) || 0;
      if (ms > best) best = ms;
    });
    return best;
  }
  function plankHoldMs(set) {
    if (!set) return 0;
    var ms = Number(set.ms);
    if (ms > 0) return ms;
    var s = Number(set.holdSec);
    return s > 0 ? s * 1000 : 0;
  }
  // ONE per set whose continuous valid hold is >= 60,000 ms. A 3-minute hold counts as 1, not 3.
  // A set that breaks form before 60 s counts 0. To switch to "one per full minute", change the
  // increment below to Math.floor(plankHoldMs(s) / ONE_MINUTE_MS).
  function isOneMinutePlank(set) { return plankHoldMs(set) >= ONE_MINUTE_MS; }
  function oneMinutePlanks(sets, uid) {
    var n = 0;
    (sets || []).forEach(function (s) {
      if (!s || (uid && s.uid && s.uid !== uid)) return;
      if (isOneMinutePlank(s)) n += 1;
    });
    return n;
  }
  function ledgerSum(docs, source, uid) {
    var zab = 0, qty = 0, list = [];
    (docs || []).forEach(function (t) {
      if (!t || t.source !== source) return;
      if (uid && t.uid && t.uid !== uid) return;
      var q = Math.floor(Number(t.qty) || 0), amt = Number(t.amount);
      if (q < 1 && amt > 0 && source === "hold") q = Math.round(amt / HOLD_ZAB) || 1;
      if (!(amt > 0)) amt = source === "hold" ? q * HOLD_ZAB : 0;
      if (q < 0) q = 0;
      qty += q;
      zab += amt;
      list.push({ qty: q, zab: amt, createdAt: t.createdAt, atMs: toMs(t.createdAt) });
    });
    list.sort(function (a, b) { return (b.atMs || 0) - (a.atMs || 0); });
    return { zab: zab, qty: qty, list: list };
  }
  function plankDay(set, s) {
    var ms = toMs(set && (set.createdAt || set.sessionStartedAt || set.at));
    return set && set.date && /^\d{4}-\d{2}-\d{2}$/.test(set.date) ? set.date : dayKeyAt(ms, s);
  }
  function plankStats(sets, ledger, uid, todayKey, s) {
    var completed = 0, totalMs = 0, longestMs = 0, today = 0, week = 0, recent = [];
    (sets || []).forEach(function (set) {
      if (!set || (uid && set.uid && set.uid !== uid)) return;
      var ms = plankHoldMs(set), day = plankDay(set, s), ok = ms >= ONE_MINUTE_MS;
      if (ms > 0) totalMs += ms;
      if (ms > longestMs) longestMs = ms;
      if (ok) {
        completed += 1;
        if (day === todayKey) today += 1;
        if (inWeek(day, todayKey)) week += 1;
        recent.push({ date: day, ms: ms, label: "plank set complete", atMs: toMs(set.createdAt || set.sessionStartedAt || set.at) });
      }
    });
    recent.sort(function (a, b) { return (b.atMs || 0) - (a.atMs || 0) || (a.date < b.date ? 1 : -1); });
    var holds = ledgerSum(ledger, "hold", uid);
    return {
      setsCompleted: completed, totalMs: totalMs, longestMs: longestMs, today: today, week: week,
      zab: ledgerSum(ledger, "plank", uid).zab, recent: recent.slice(0, 10),
      holds: { count: holds.qty || holds.list.length, zab: holds.zab }
    };
  }

  // ---- Zabba washer record ----
  function fromSoloGames(rows, uid, s) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || (uid && r.uid && r.uid !== uid)) return;
      if (r.verified === false || Number(r.score) !== 21) return;
      var at = toMs(r.createdAt || r.at);
      out.push({ atMs: at, date: dayKeyAt(at, s), opponent: "", score: "21", mode: "Solo", result: "W" });
    });
    return out;
  }
  function fromLiveMatches(docs, uid, s) {
    var out = [];
    (docs || []).forEach(function (m) {
      if (!m || m.status !== "finished" || !m.uids || m.uids.indexOf(uid) < 0) return;
      var i = m.uids.indexOf(uid), opp = "", scores = m.scores || [0, 0];
      var players = m.players || [];
      var other = players[1 - i] || (players.filter ? players.filter(function (p) { return p && p.uid !== uid; })[0] : null);
      opp = (other && other.name) || "";
      var result = (!m.winner || m.reason === "tie") ? "T" : (m.winner === uid ? "W" : "L");
      var at = toMs(m.updatedAt || m.createdAt);
      out.push({ atMs: at, date: dayKeyAt(at, s), opponent: opp, score: (scores[i] || 0) + "\u2013" + (scores[1 - i] || 0), mode: "Live Match", result: result, code: m.code || "" });
    });
    return out;
  }
  function seasonRecord(rows, uid) {
    var wins = 0, losses = 0, battles = 0;
    (rows || []).forEach(function (r) {
      if (!r || (uid && r.uid && r.uid !== uid)) return;
      wins += r.wins | 0; losses += r.losses | 0; battles += r.battles | 0;
    });
    return { wins: wins, losses: losses, battles: battles };
  }
  function resultStreaks(games) {
    var list = (games || []).slice().sort(function (a, b) { return (a.atMs || 0) - (b.atMs || 0); });
    var best = 0, run = 0, current = 0, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].result === "W") { run += 1; if (run > best) best = run; } else run = 0;
    }
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i].result === "W") current += 1; else break;
    }
    return { current: current, best: best };
  }
  function winPct(w, l, t) {
    var g = (w || 0) + (l || 0) + (t || 0);
    return g ? Math.round((w / g) * 1000) / 10 : 0;
  }
  function washerRecord(s) {
    s = s || {};
    var uid = s.uid, solo = fromSoloGames(s.games, uid, s), live = fromLiveMatches(s.matches, uid, s);
    var season = seasonRecord(s.seasons, uid);
    var listed = solo.concat(live).sort(function (a, b) { return (b.atMs || 0) - (a.atMs || 0); });
    var liveW = 0, liveL = 0, liveT = 0;
    live.forEach(function (g) { if (g.result === "W") liveW += 1; else if (g.result === "L") liveL += 1; else liveT += 1; });
    var wins = solo.length + season.wins + liveW;
    var losses = season.losses + liveL;
    var ties = liveT;
    var st = resultStreaks(listed);
    return {
      wins: wins, losses: losses, ties: ties, winPct: winPct(wins, losses, ties),
      currentStreak: st.current, bestStreak: st.best,
      soloWins: solo.length, battleWins: season.wins, battleLosses: season.losses, battleBattles: season.battles,
      liveWins: liveW, liveLosses: liveL, liveTies: liveT,
      zab: ledgerSum(s.ledger, "washers", uid).zab,
      recent: listed.slice(0, 10)
    };
  }

  function activityDays(s) {
    var set = {}, uid = s && s.uid;
    function add(k) { if (/^\d{4}-\d{2}-\d{2}$/.test(k || "")) set[k] = 1; }
    (s.daily || []).forEach(function (r) { if (!r || (uid && r.uid && r.uid !== uid)) return; add(r.date); });
    fromLedger(s.ledger).forEach(function (m) { add(m.date); });
    (s.pushups || []).forEach(function (r) { if (!r || (uid && r.uid && r.uid !== uid)) return; add(plankDay(r, s)); });
    (s.planks || []).forEach(function (r) { if (!r || (uid && r.uid && r.uid !== uid)) return; add(plankDay(r, s)); });
    fromSoloGames(s.games, uid, s).forEach(function (g) { add(g.date); });
    fromLiveMatches(s.matches, uid, s).forEach(function (g) { add(g.date); });
    (s.ledger || []).forEach(function (t) { var ms = toMs(t && t.createdAt); if (ms) add(dayKeyAt(ms, s)); });
    return Object.keys(set);
  }

  function nudge(sum) {
    var left = GOAL_STEPS - (sum.todaySteps || 0);
    if (left > 0) return fmt(left) + " steps to your next 10K";
    if (sum.plank && !sum.plank.today) return "Hold 60 seconds for a plank set complete";
    if (sum.tenK && sum.tenK.currentStreak) return "10K is in the bag today. Keep the " + sum.tenK.currentStreak + "-day streak going.";
    return "10K is in the bag today. Nice work.";
  }

  function summarize(s) {
    s = s || {};
    var session = s.session || (typeof root !== "undefined" ? root.ZabbadatSession : null);
    var today = s.today || dayKeyAt(Date.now(), s);
    var ten = summarize10k(s.ledger, today);
    var pu = pushupStats(s.pushups, s.uid);
    var plank = plankStats(s.planks, s.ledger, s.uid, today, s);
    var wash = washerRecord(s);
    var act = streaks(activityDays(s), today);
    var bestDay = bestDaySteps(s.daily, s.uid);
    var out = {
      signedIn: !!s.signedIn,
      today: today,
      zabBalance: s.zabBalance == null ? null : Number(s.zabBalance),
      steps: lifetimeSteps(s.daily, s.uid),
      todaySteps: todaySteps(s.daily, s.uid, today),
      pushups: pu.total,
      bestPushups: pu.best,
      tutSets: lifetimeTut(s.pushups, s.uid, session),
      bestTutMs: bestTutMs(s.pushups, s.uid, session),
      plank: plank,
      planks: plank.setsCompleted,
      tenK: ten,
      washers: wash,
      activityStreak: act.current,
      activityBest: act.best,
      bests: {
        steps: bestDay,
        pushups: pu.best,
        tutMs: bestTutMs(s.pushups, s.uid, session),
        plankMs: plank.longestMs,
        washerStreak: wash.bestStreak
      }
    };
    out.nudge = nudge(out);
    return out;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function fmtZab(n) { var x = Number(n) || 0, r = Math.round(x * 10) / 10; return r % 1 === 0 ? String(r) : r.toFixed(1); }

  function list10kHtml(milestones, escapeFn) {
    var e = escapeFn || esc;
    if (!milestones || !milestones.length) {
      return '<p class="note dash-empty" id="dash10kEmpty">No 10K days yet. Hit 10,000 steps in a day to earn 4 ZAB and start your streak.</p>';
    }
    return '<ul class="dash-list dash-10k-list">' + milestones.map(function (m) {
      return "<li><span>" + e(formatDay(m.date)) + " \u00b7 " + e(fmt(m.steps)) + " steps</span><span>+" + e(String(m.zab)) + " ZAB</span></li>";
    }).join("") + "</ul>";
  }
  function plankListHtml(recent, escapeFn) {
    var e = escapeFn || esc;
    if (!recent || !recent.length) {
      return '<p class="note dash-empty">No plank set complete yet. Hold a continuous 60 seconds to complete a plank set.</p>';
    }
    return '<ul class="dash-list">' + recent.map(function (m) {
      return "<li><span>" + e(formatDay(m.date)) + " \u00b7 " + e(formatHold(m.ms)) + "</span><span>" + e(m.label || "plank set complete") + "</span></li>";
    }).join("") + "</ul>";
  }
  function washerListHtml(recent, escapeFn) {
    var e = escapeFn || esc;
    if (!recent || !recent.length) {
      return '<p class="note dash-empty">No Zabba washer games posted yet. A verified solo 21, a Washer Battle, or a Live Match will show up here.</p>';
    }
    return '<ul class="dash-list">' + recent.map(function (g) {
      var who = g.opponent ? e(g.opponent) : "Solo";
      return "<li><span>" + e(formatDay(g.date)) + " \u00b7 " + who + " \u00b7 " + e(g.score) + " \u00b7 " + e(g.mode) + "</span><span class=\"dash-wl\">" + e(g.result) + "</span></li>";
    }).join("") + "</ul>";
  }
  function stat(e, value, label) {
    return '<div class="stat"><b>' + e(String(value)) + "</b><span>" + e(label) + "</span></div>";
  }

  function cardBodyHtml(sum, escapeFn) {
    var e = escapeFn || esc, t = sum && sum.tenK ? sum.tenK : summarize10k([]), p = sum.plank || plankStats([], [], "", "", {}), w = sum.washers || washerRecord({});
    var zab = sum.zabBalance == null ? "\u2014" : fmtZab(sum.zabBalance);
    var toward = Math.min(GOAL_STEPS, sum.todaySteps || 0);
    var washLine = w.wins + "\u2013" + w.losses + (w.ties ? "\u2013" + w.ties : "");
    return '<p class="dash-nudge" id="dashNudge">' + e(sum.nudge || "") + "</p>" +
      '<div class="dash-stats dash-summary">' +
        stat(e, zab, "ZAB balance") +
        stat(e, sum.activityStreak || 0, "Activity streak") +
        stat(e, fmt(toward) + " / " + fmt(GOAL_STEPS), "Steps today") +
        stat(e, washLine, "Zabba washer record") +
      "</div>" +
      "<h3>Zabba washer</h3>" +
      '<div class="dash-stats">' +
        stat(e, w.wins, "Wins") +
        stat(e, w.losses, "Losses") +
        stat(e, w.ties, "Ties") +
        stat(e, (w.winPct || 0) + "%", "Win pct") +
        stat(e, w.currentStreak, "Win streak") +
        stat(e, w.bestStreak, "Best win streak") +
      "</div>" +
      '<p class="note">+' + e(fmtZab(w.zab)) + " ZAB from verified solo wins. Recent games (solo and Live Match):</p>" +
      washerListHtml(w.recent, e) +
      '<p class="fine dash-foot">Washer Battle wins and losses come from the seasonal board (all seasons you have a row in). Live Match ties and losses are stored on the match. Solo games only post a verified 21, so they have no opponent and no loss record. Washer Battle ties are not recorded on the board, and recent Washer Battle games are not listed here (rooms are not queryable by player without a new index).</p>' +
      "<h3>Steps</h3>" +
      '<div class="dash-stats">' +
        stat(e, fmt(sum.steps), "Lifetime steps") +
        stat(e, fmt(t.count), "10K days") +
        stat(e, "+" + t.zab, "10K ZAB") +
        stat(e, t.currentStreak, "10K streak") +
      "</div>" +
      "<h3>10K Milestones</h3>" +
      '<p class="note" id="dash10kSummary">+' + e(String(t.zab)) + " ZAB from 10K bonuses \u00b7 Streak " + e(String(t.currentStreak)) +
        " \u00b7 Best " + e(String(t.bestStreak)) + "</p>" +
      list10kHtml(t.milestones, e) +
      "<h3>Push-ups</h3>" +
      '<div class="dash-stats">' +
        stat(e, fmt(sum.pushups), "Lifetime push-ups") +
        stat(e, fmt(sum.bestPushups || 0), "Best set") +
      "</div>" +
      "<h3>TUT</h3>" +
      '<div class="dash-stats">' +
        stat(e, fmt(sum.tutSets), "TUT sets completed") +
        stat(e, formatHold(sum.bestTutMs || 0), "Longest TUT set") +
      "</div>" +
      "<h3>Planks</h3>" +
      '<div class="dash-stats">' +
        stat(e, p.setsCompleted, "Plank sets completed") +
        stat(e, formatHold(p.totalMs), "Lifetime time held") +
        stat(e, formatHold(p.longestMs), "Longest hold") +
        stat(e, p.today, "Sets today") +
        stat(e, p.week, "Sets this week") +
        stat(e, "+" + fmtZab(p.zab), "ZAB from planks") +
      "</div>" +
      '<p class="note">Recent sets</p>' +
      plankListHtml(p.recent, e) +
      "<h3>Plank push press</h3>" +
      '<p class="note">' + e(String(p.holds.count)) + " plank push press holds \u00b7 +" + e(fmtZab(p.holds.zab)) + " ZAB (0.5 ZAB each). Listed separately from regular planks.</p>" +
      "<h3>Personal bests</h3>" +
      '<ul class="dash-list">' +
        "<li><span>Most steps in a day</span><span>" + e(sum.bests && sum.bests.steps && sum.bests.steps.steps ? fmt(sum.bests.steps.steps) + (sum.bests.steps.date ? " \u00b7 " + formatDay(sum.bests.steps.date) : "") : "\u2014") + "</span></li>" +
        "<li><span>Most push-ups in a set</span><span>" + e(fmt(sum.bests && sum.bests.pushups || 0)) + "</span></li>" +
        "<li><span>Longest TUT set</span><span>" + e(formatHold(sum.bests && sum.bests.tutMs || 0)) + "</span></li>" +
        "<li><span>Longest plank</span><span>" + e(formatHold(sum.bests && sum.bests.plankMs || 0)) + "</span></li>" +
        "<li><span>Best Zabba washer win streak</span><span>" + e(String(sum.bests && sum.bests.washerStreak || 0)) + "</span></li>" +
      "</ul>" +
      '<p class="fine dash-foot">Steps count days posted while signed in. Push-ups and TUT sets come from posted camera sets (the Nov 8\u201313 posts that the category/holdMs rule refused are not in Firestore). A plank set complete is one continuous hold of 60 seconds or more. Activity streak counts any posted day (steps, sets, planks, or Zabba washer games).</p>';
  }

  function cardHtml(sum, escapeFn) {
    if (!sum || !sum.signedIn) {
      return '<div class="card" id="userDash"><h3>Your dashboard</h3><p class="note" id="userDashSignIn">Sign in to track your 10K days</p></div>';
    }
    return '<div class="card" id="userDash"><h3>Your dashboard</h3>' + cardBodyHtml(sum, escapeFn) + "</div>";
  }

  var api = {
    BONUS: BONUS, SOURCE: SOURCE, ONE_MINUTE_MS: ONE_MINUTE_MS, GOAL_STEPS: GOAL_STEPS,
    shiftDay: shiftDay, formatDay: formatDay, formatHold: formatHold, weekStart: weekStart,
    fromLedger: fromLedger, streaks: streaks, summarize10k: summarize10k,
    lifetimeSteps: lifetimeSteps, todaySteps: todaySteps, pushupStats: pushupStats, lifetimePushups: lifetimePushups, lifetimeTut: lifetimeTut,
    plankHoldMs: plankHoldMs, isOneMinutePlank: isOneMinutePlank, oneMinutePlanks: oneMinutePlanks, plankStats: plankStats,
    ledgerSum: ledgerSum, washerRecord: washerRecord, winPct: winPct, resultStreaks: resultStreaks,
    activityDays: activityDays, nudge: nudge, summarize: summarize,
    listHtml: list10kHtml, cardBodyHtml: cardBodyHtml, cardHtml: cardHtml
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatDash = api;
})(typeof window !== "undefined" ? window : this);
