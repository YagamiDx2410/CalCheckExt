// Extension version numbers such as "2.33.0" (pure).

// "2.33.0" -> [2, 33, 0]; anything that is not dot-separated digits -> null
export function parseVersion(v) {
  const s = String(v == null ? "" : v).trim();
  return /^\d+(\.\d+)*$/.test(s) ? s.split(".").map(Number) : null;
}

// -1 when a < b, 0 when equal, 1 when a > b ("2.9" < "2.10", "2.33" = "2.33.0"); null when either is not a version
export function cmpVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// version field of a manifest.json text; "" when the text is not a manifest with a valid version
export function manifestVersion(text) {
  try { const v = JSON.parse(text).version; return parseVersion(v) ? String(v).trim() : ""; } catch (e) { return ""; }
}
