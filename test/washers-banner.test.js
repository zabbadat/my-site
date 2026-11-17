// Home showcase banner for Zabba Washers: first in-flow content, plays via #play, session-dismissible.
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const navEnd = html.indexOf("</nav>");
const bannerAt = html.indexOf('id="washersBanner"');
const stripAt = html.indexOf('id="playEarn10k"');
const homeAt = html.indexOf('class="home-art"');
check("banner sits in page content just after the nav, before the 10K strip and home art", navEnd > 0 && bannerAt > navEnd && bannerAt < stripAt && stripAt < homeAt);

const start = html.lastIndexOf("<aside", bannerAt);
const end = html.indexOf("</aside>", bannerAt);
const banner = start >= 0 && end > start ? html.slice(start, end + 8) : "";
check("banner markup found as an aside region labeled Zabba Washers", /<aside class="washers-banner" id="washersBanner" role="region" aria-label="Zabba Washers">/.test(banner));
check("headline and one-line pitch match the real game (packs of 3, first to 21, 1 ZAB per win)", banner.includes('<p class="wbanner-headline">Walk. Pitch. First to 21.</p>') && banner.includes('<p class="wbanner-pitch">Zabba Washers, the step-counter arcade. Packs of 3, and 1 ZAB per win.</p>') && banner.includes('<p class="wbanner-kicker">Zabbadat</p>'));
check("Play Washers button uses the existing in-page #play game route", /<a class="btn" id="washersBannerPlay" href="#play">Play Washers<\/a>/.test(banner));
check("uses the stacked-washer mark from the home tile", /<ellipse cx="24" cy="34" rx="16" ry="6"\/>/.test(banner) && /<ellipse cx="24" cy="23" rx="16" ry="6"\/>/.test(banner) && /<ellipse cx="24" cy="12" rx="16" ry="6"\/>/.test(banner) && /fill="none" stroke="currentColor" stroke-width="2.5"/.test(banner));
check("spelling is Zabbadat and Zabba Washers, not Zabadat in the banner", /\bZabbadat\b/.test(banner) && /\bZabba Washers\b/.test(banner) && !/\bZabadat\b/.test(banner));
check("pitch does not invent step counts or other claims", !/\d{2,}\s*steps/i.test(banner) && !/unlock/i.test(banner) && /1 ZAB per win/.test(banner) && !/[2-9]\s*ZAB per win/.test(banner));

const cssStart = html.indexOf("#washersBanner.washers-banner");
const css = cssStart > 0 ? html.slice(cssStart, html.indexOf("</style>", cssStart)) : "";
check("banner is compact under the fixed nav, tighter on phones, and hidden when dismissed or during a live arcade game", /var\(--navh/.test(css) && /@media \(max-width:700px\)/.test(css) && /html\.washers-banner-off #washersBanner\{display:none!important\}/.test(css) && /body\.arcade-live #washersBanner\{display:none\}/.test(css) && /prefers-reduced-motion: reduce/.test(css) && /animation:none/.test(css) && !/position:\s*fixed/.test(css));
check("when the banner is showing, the 10K strip does not also add nav clearance", /html:not\(\.washers-banner-off\) #playEarn10k\.pe-10k\{margin-top:\.4rem\}/.test(css));

const dismissAt = html.indexOf("washersBannerDismiss");
const dismissJs = html.slice(dismissAt, html.indexOf("playEarn10k", dismissAt));
check("dismissible for the session via sessionStorage, with a head script that hides it before paint", /sessionStorage\.setItem\("zabbadat-washers-banner-off", "1"\)/.test(dismissJs) && /id="washersBannerDismiss"/.test(banner) && /aria-label="Dismiss Zabba Washers banner"/.test(banner) && /try \{ if \(sessionStorage\.getItem\("zabbadat-washers-banner-off"\) === "1"\) document\.documentElement\.classList\.add\("washers-banner-off"\); \}/.test(html));

check("Google and X sign-in buttons and same-tab startPhoneGoogle are unchanged", /<button class="btn" id="signInBtn" type="button">Sign in with Google<\/button>/.test(html) && /<button class="btn ghost" id="signInXBtn" type="button">Sign in with X<\/button>/.test(html) && /function startPhoneGoogle\(\) \{/.test(html) && /\$\("signInBtn"\)\.onclick = async \(\) => \{\s*try \{\s*startPhoneGoogle\(\);/.test(html));

const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
