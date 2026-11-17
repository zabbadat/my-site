// Tiny static server for the repo root (no Netlify): GET only, path-safe, common MIME types. Usage: start(root, port) -> {port, close}.
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".mp4": "video/mp4", ".bin": "application/octet-stream",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml", ".woff2": "font/woff2" };
function start(root, port = 0) {
  root = path.resolve(root);
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.resolve(root, "." + p);
    if (!f.startsWith(root + path.sep) || /[\\/]\.(git|cache)|node_modules/.test(f)) { res.writeHead(403); return res.end(); }
    fs.stat(f, (e, st) => {
      if (e || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-cache" });
      fs.createReadStream(f).pipe(res);
    });
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) })));
}
module.exports = start;
