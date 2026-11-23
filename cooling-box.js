/* Cooling box: a 16-second 4-count cycle (inhale 4, hold 4, exhale 4, hold empty 4).
 * Each completed cycle adds one to the all-time localStorage counter zabbadat-breath-cycles.
 * No network and no Firestore writes. Browser: window.ZabbadatCoolingBox. Node: module.exports. */
(function (root) {
  "use strict";
  var KEY = "zabbadat-breath-cycles";
  var CYCLE_MS = 16000;
  var SIDE_MS = 4000;
  var SIDES = ["Inhale", "Hold full", "Exhale", "Hold empty"];

  function storeOf(store) {
    if (store) return store;
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) {}
    return { getItem: function () { return null; }, setItem: function () {} };
  }
  function getCycles(store) {
    var n = parseInt(storeOf(store).getItem(KEY), 10);
    return n > 0 ? n : 0;
  }
  function setCycles(store, n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    storeOf(store).setItem(KEY, String(n));
    return n;
  }
  function addCycle(store, k) {
    k = k == null ? 1 : Math.floor(Number(k) || 0);
    if (k < 1) return getCycles(store);
    return setCycles(store, getCycles(store) + k);
  }

  // now() should be monotonic ms. onTick({ side, sideIndex, count, cycleMs, running }).
  // onCycle(total) fires once per completed 16 s cycle. Returns a controller { start, stop, running, state }.
  function createBox(opts) {
    opts = opts || {};
    var store = storeOf(opts.store);
    var nowFn = opts.now || function () { return Date.now(); };
    var onTick = opts.onTick || function () {};
    var onCycle = opts.onCycle || function () {};
    var timer = null, startedAt = 0, running = false, cycleBase = 0;

    function emit(t) {
      var elapsed = running ? Math.max(0, t - cycleBase) : 0;
      var inCycle = elapsed % CYCLE_MS;
      var sideIndex = Math.min(3, Math.floor(inCycle / SIDE_MS));
      var count = Math.min(4, Math.floor((inCycle % SIDE_MS) / 1000) + 1);
      onTick({ side: SIDES[sideIndex], sideIndex: sideIndex, count: count, cycleMs: inCycle, running: running, total: getCycles(store) });
    }
    function step() {
      if (!running) return;
      var t = nowFn();
      var elapsed = t - cycleBase;
      var done = Math.floor(elapsed / CYCLE_MS);
      if (done > 0) {
        cycleBase += done * CYCLE_MS;
        var total = addCycle(store, done);
        onCycle(total);
      }
      emit(t);
    }
    function start() {
      if (running) return;
      running = true;
      startedAt = nowFn();
      cycleBase = startedAt;
      emit(startedAt);
      if (typeof setInterval === "function") timer = setInterval(step, 200);
    }
    function stop() {
      if (!running) return;
      step();
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      emit(nowFn());
    }
    function tick(t) { if (t != null && opts.now == null) { /* test clock */ } if (running) step(); }
    return { start: start, stop: stop, running: function () { return running; }, tick: step, getCycles: function () { return getCycles(store); } };
  }

  function mount(doc, store) {
    if (!doc || !doc.getElementById) return null;
    var btn = doc.getElementById("coolingStartBtn");
    var status = doc.getElementById("coolingStatus");
    var countEl = doc.getElementById("coolingCycles");
    if (!btn) return null;
    var box = null;
    function paint(state) {
      var n = state && state.total != null ? state.total : getCycles(store);
      if (countEl) countEl.textContent = String(n);
      if (status) {
        if (state && state.running) status.textContent = state.side + " " + state.count;
        else status.textContent = n ? (n + " breath cycle" + (n === 1 ? "" : "s") + " on this phone.") : "Start a 16-second 4-count cycle.";
      }
      btn.textContent = state && state.running ? "Stop cooling box" : "Start cooling box";
      if (typeof doc.dispatchEvent === "function") {
        try { doc.dispatchEvent(new (root.Event || Event)("zabbadat-breath-cycles")); } catch (e) {}
      }
    }
    function ensure() {
      if (box) return box;
      box = createBox({
        store: store,
        onTick: paint,
        onCycle: function (total) { paint({ running: true, total: total, side: "Inhale", sideIndex: 0, count: 1 }); }
      });
      return box;
    }
    paint({ running: false, total: getCycles(store) });
    btn.onclick = function () {
      var b = ensure();
      if (b.running()) b.stop();
      else b.start();
    };
    return { box: function () { return box; }, paint: paint };
  }

  var api = { KEY: KEY, CYCLE_MS: CYCLE_MS, SIDE_MS: SIDE_MS, SIDES: SIDES, getCycles: getCycles, setCycles: setCycles, addCycle: addCycle, createBox: createBox, mount: mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatCoolingBox = api;
})(typeof window !== "undefined" ? window : this);
