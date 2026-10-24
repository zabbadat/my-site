// Shared sign-in gate for every Start button. requireSignIn(feature, startFn, { practice }) returns true when the
// caller may start right now (signed in, or a remembered Practice choice for that feature). Otherwise it shows the
// "Please sign in" dialog and returns false; the caller must not start.
// Practice memory: per feature, in sessionStorage ("zd-practice:<feature>"), so a signed-out solo player is asked
// once per feature per tab session. Battles never get a Practice option (they need an account).
// Practice runs startFn synchronously inside the Practice click, so it is a fresh user gesture (wake lock, iOS
// motion permission, camera).
(function (root) {
  const KEY = "zd-practice:";
  function createSignInGate(o) {
    const doc = o.document, store = o.storage || null;
    let open = null; // { feature, el, prevFocus }
    const remembered = (f) => { try { return !!store && store.getItem(KEY + f) === "1"; } catch (e) { return false; } };
    const remember = (f) => { try { if (store) store.setItem(KEY + f, "1"); } catch (e) {} };
    function close() {
      if (!open) return;
      const { el, prevFocus, onKey } = open; open = null;
      if (doc.removeEventListener) doc.removeEventListener("keydown", onKey);
      if (el.parentNode) el.parentNode.removeChild(el);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
    }
    function btn(cls, id, text, fn) {
      const b = doc.createElement("button"); b.type = "button"; b.className = cls; b.id = id; b.textContent = text;
      b.onclick = fn; return b;
    }
    function show(feature, startFn, practice) {
      close();
      const back = doc.createElement("div"); back.id = "signGate"; back.className = "sign-gate";
      const box = doc.createElement("div"); box.className = "sign-gate-box";
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", "signGateTitle"); box.setAttribute("aria-describedby", "signGateText");
      const h = doc.createElement("h2"); h.id = "signGateTitle"; h.textContent = "Please sign in";
      const p = doc.createElement("p"); p.id = "signGateText";
      p.textContent = practice ? "Sign in to save your sets, steps and ZAB." : "Sign in to play a battle. Battles need an account so both players see each other.";
      if (doc.defaultView && doc.defaultView.ZabCurrency) doc.defaultView.ZabCurrency.ring(p);
      const row = doc.createElement("div"); row.className = "row";
      const sign = btn("btn", "signGateSignIn", "Sign in", () => { close(); if (o.onSignIn) o.onSignIn(feature); });
      row.appendChild(sign);
      if (practice) row.appendChild(btn("btn ghost", "signGatePractice", "Practice without signing in", () => { remember(feature); close(); startFn(); }));
      row.appendChild(btn("btn ghost", "signGateCancel", "Cancel", close));
      box.appendChild(h); box.appendChild(p); box.appendChild(row); back.appendChild(box);
      back.onclick = (ev) => { if (ev && ev.target === back) close(); };
      const onKey = (ev) => { if (ev && (ev.key === "Escape" || ev.key === "Esc")) close(); };
      if (doc.addEventListener) doc.addEventListener("keydown", onKey);
      open = { feature, el: back, prevFocus: doc.activeElement, onKey };
      doc.body.appendChild(back);
      if (sign.focus) try { sign.focus(); } catch (e) {}
    }
    function requireSignIn(feature, startFn, opts) {
      const practice = !!(opts && opts.practice) && typeof startFn === "function";
      if (o.isSignedIn()) return true;
      if (practice && remembered(feature)) return true;
      show(feature, startFn, practice);
      return false;
    }
    return { requireSignIn, close, isOpen: () => !!open, openFeature: () => (open ? open.feature : null), remembered };
  }
  const api = { createSignInGate, KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SignInGate = api;
})(typeof window !== "undefined" ? window : null);
