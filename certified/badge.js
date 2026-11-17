/* Zabbadat Zero Face Exposure badge. Optional hostname check only.
   Anyone can remove or spoof this script; the signed report on zabbadat.com is the source of truth. */
(function () {
  var SCRIPT = document.currentScript;
  var ORIGIN = "https://www.zabbadat.com";
  function hostOk(domain) {
    var h = String(location.hostname || "").toLowerCase().replace(/^www\./, "");
    var d = String(domain || "").toLowerCase().replace(/^www\./, "");
    return !!d && h === d;
  }
  function paint(el) {
    var domain = (el.getAttribute("data-domain") || "").toLowerCase();
    var variant = el.getAttribute("data-variant") === "square" ? "square" : "wide";
    var report = ORIGIN + "/certified/" + domain;
    el.innerHTML = "";
    if (!hostOk(domain)) {
      el.setAttribute("data-state", "unverified");
      var box = document.createElement("div");
      box.textContent = "Unverified";
      box.setAttribute("title", "This Zero Face Exposure badge is not valid on this domain.");
      box.style.cssText = "display:inline-block;font:700 12px/1.2 system-ui,sans-serif;background:#2a1616;color:#ffd6d6;border:1px solid #8b1e1e;border-radius:8px;padding:10px 12px;";
      el.appendChild(box);
      return;
    }
    var a = document.createElement("a");
    a.href = report;
    a.rel = "noopener noreferrer";
    var img = document.createElement("img");
    img.src = ORIGIN + "/certified/badge/" + domain + (variant === "square" ? "-square.svg" : ".svg");
    img.alt = "Zero Face Exposure Verified";
    if (variant === "square") { img.width = 72; img.height = 72; }
    else { img.width = 160; img.height = 56; }
    a.appendChild(img);
    el.appendChild(a);
    el.setAttribute("data-state", "verified-host");
  }
  function run() {
    var nodes = document.querySelectorAll(".zab-zfe-badge[data-domain]");
    for (var i = 0; i < nodes.length; i++) paint(nodes[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
