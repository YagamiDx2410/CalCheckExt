// Text helpers shared by every module (pure).

// ---------- text helpers ----------
export function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }

export function lc(s) { return norm(s).toLowerCase(); }

export function splitCsv(s) { return (s || "").replace(/;/g, ",").split(",").map(norm).filter(Boolean); }

// Screenshot with escalating strategies: 0 = normal, 1 = normal after a fresh warm-up frame
// (re-warmed by the caller), 2 = briefly show the tab, capture, restore the user's tab.
export function errText(e) { return String((e && e.message) || e || "").slice(0, 160); }

export function safeName(x) { return String(x || "").replace(/[\/\\:*?"<>|]+/g, "_").trim(); }
