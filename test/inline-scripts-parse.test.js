// Every inline <script> in index.html must parse (classic via vm.Script, type=module via node --check on .mjs;
// JSON-LD via JSON.parse). Catches e.g. a "//" comment swallowing the rest of a one-line handler.
// Usage: node test/inline-scripts-parse.test.js [path-to-html]
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os"), cp = require("child_process");
const file = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");
let pass = 0, fail = 0; const check = (n, ok, why) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (ok || !why ? "" : " :: " + why)); };
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m, i = 0, modules = 0;
while ((m = re.exec(html))) {
  const attrs = m[1], body = m[2]; i++;
  if (/\bsrc=/.test(attrs) || !body.trim()) continue;
  const type = (attrs.match(/type="([^"]+)"/) || [])[1] || "text/javascript", lineNo = html.slice(0, m.index).split("\n").length;
  const name = `inline script #${i} (${type}, line ${lineNo}, ${body.length} chars)`;
  if (type === "module") {
    modules++;
    const tmp = path.join(os.tmpdir(), `inline-${process.pid}-${i}.mjs`); fs.writeFileSync(tmp, body);
    const r = cp.spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" }); fs.unlinkSync(tmp);
    check(name + " parses", r.status === 0, (r.stderr || "").split("\n").filter(Boolean).slice(0, 4).join(" | "));
  } else if (/json/.test(type)) { let ok = true, why = ""; try { JSON.parse(body); } catch (e) { ok = false; why = e.message; } check(name + " is valid JSON", ok, why); }
  else { let ok = true, why = ""; try { new vm.Script(body, { filename: name }); } catch (e) { ok = false; why = e.message; } check(name + " parses", ok, why); }
}
check("found the main module script", modules >= 1);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
