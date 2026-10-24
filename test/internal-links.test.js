// Every internal link in every top-level .html page must resolve: the page exists (extensionless URLs map to <name>.html)
// and any #fragment matches an id on the target page. Also: every page is in sitemap.xml with a matching canonical.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const pages = fs.readdirSync(root).filter((f) => /\.html$/.test(f) && !/^google/.test(f));
const html = {}; pages.forEach((f) => { html[f] = fs.readFileSync(path.join(root, f), "utf8"); });
const R = []; const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !why ? "" : " :: " + why}`); R.push(!!ok); };
const target = (p) => (p === "/" || p === "" ? "index.html" : p.replace(/^\//, "").replace(/\.html$/, "") + ".html");
const ids = (h) => new Set([...h.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const bad = []; let n = 0;
pages.forEach((f) => {
  const h = html[f].replace(/<script[\s\S]*?<\/script>/g, "");
  [...h.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].forEach((m) => {
    const href = m[1]; if (/^(https?:|mailto:|tel:|javascript:)/.test(href) || !href) return; n++;
    const [p, frag] = href.split("#"), tf = p ? target(p) : f;
    if (!html[tf]) { bad.push(f + " -> " + href + " (no such page)"); return; }
    if (frag && !ids(html[tf]).has(frag)) bad.push(f + " -> " + href + " (no id #" + frag + ")");
  });
});
check("internal links resolve on " + pages.length + " pages (" + n + " links checked)", bad.length === 0, bad.join("; "));
const dup = []; pages.forEach((f) => { const seen = {}; [...html[f].replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/\sid="([^"]+)"/g)].forEach((m) => { seen[m[1]] = (seen[m[1]] || 0) + 1; }); Object.keys(seen).filter((k) => seen[k] > 1).forEach((k) => dup.push(f + "#" + k)); });
check("no duplicate element ids (index.html steps / tbBoardBody fixed)", dup.length === 0, dup.join(", "));
const sm = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8"), locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const want = pages.map((f) => "https://www.zabbadat.com/" + (f === "index.html" ? "" : f.replace(/\.html$/, "")));
check("sitemap lists every page: " + want.length, want.every((u) => locs.includes(u)) && locs.length === want.length, "sitemap: " + locs.join(", "));
check("every page's canonical equals its sitemap URL", pages.every((f, i) => (html[f].match(/rel="canonical" href="([^"]+)"/) || [])[1] === want[i]));
const pages2 = pages.filter((f) => !["index.html", "rules.html"].includes(f));
check("new pages: title <= 60, description 120-158, one H1, og/twitter image, canonical", pages2.every((f) => { const h = html[f], t = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "", d = (h.match(/name="description" content="([^"]*)"/) || [])[1] || "";
  return t.length <= 60 && d.length >= 120 && d.length <= 158 && (h.match(/<h1>/g) || []).length === 1 && /og:image" content="https:\/\/www\.zabbadat\.com\/og-zd-v2\.png"/.test(h) && /twitter:image" content="https:\/\/www\.zabbadat\.com\/og-zd-v2\.png"/.test(h); }));
const titles = pages.map((f) => (html[f].match(/<title>([^<]*)<\/title>/) || [])[1]); check("titles are unique", new Set(titles).size === titles.length);
check("new pages carry no street address / location text and no LocalBusiness", pages2.every((f) => !/streetAddress|addressLocality|South Jersey|LocalBusiness/.test(html[f])));
const jl = [...html["index.html"].matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))[0];
const lb = jl.find((x) => x["@type"] === "LocalBusiness");
check("home JSON-LD: alternateName Zabadat on WebSite/Organization/LocalBusiness, 5 social sameAs, no address added", ["WebSite", "Organization", "LocalBusiness"].every((t) => jl.find((x) => x["@type"] === t).alternateName === "Zabadat") && ["Organization", "LocalBusiness"].every((t) => jl.find((x) => x["@type"] === t).sameAs.length === 5) && !lb.address);
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);
