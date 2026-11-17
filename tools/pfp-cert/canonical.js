"use strict";
// Canonical JSON for Ed25519 cert signatures: sorted keys, no whitespace, `signature` omitted at every level.
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).filter((k) => k !== "signature").sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
module.exports = { canonical };
