// Per-ticket / per-row extras: Global, Repeat, label|value scan (pure).
import { adfCellLines } from "../adf.js";

// Flatten all 2+ column table rows into a { label(lowercased) : value } map.
export function labelValueScan(doc) {
  const out = {};
  const tables = [];
  (function w(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(w); })(doc);
  tables.forEach(tb => (tb.content || []).forEach(tr => {
    const cells = (tr.content || []).map(td => adfCellLines(td).join(" ").replace(/\s+/g, " ").trim());
    if (cells.length >= 2 && cells[0]) {
      const key = cells[0].toLowerCase().replace(/[:\s]+$/, "").trim();
      if (!(key in out)) out[key] = cells.slice(1).filter(Boolean).join(" | ");
    }
  }));
  return out;
}

// Global: "yes" only when the ticket explicitly says yes; empty/"no"/absent -> "".
export function parseGlobal(lvMap, docText) {
  let g = lvMap["global"] || lvMap["global event"] || "";
  if (!g) { const m = (docText || "").match(/global(?:\s*event)?\s*[:\-]?\s*(yes|no)\b/i); if (m) g = m[1]; }
  g = (g || "").toLowerCase();
  if (g.indexOf("yes") >= 0) return "yes";
  if (g.indexOf("no") >= 0) return "no";
  return "";
}

// Repeat: parses both "repeat every X day(s), N occurrences" and "repeat daily for
// N days". Returns { repeatEvery, endsAfter } or null when there's no repeat data.
export function parseRepeat(text) {
  const t = (text || "").toLowerCase();
  if (t.indexOf("repeat") < 0 && t.indexOf("daily") < 0) return null;
  let every = null, occ = null, m;
  if ((m = t.match(/every\s+(\d+)\s*days?/))) every = +m[1];
  if (every == null && /\bdaily\b/.test(t)) every = 1;
  if ((m = t.match(/(\d+)\s*occurr?ences?/))) occ = +m[1]; // also accepts the common typo "occurences"
  if (occ == null && (m = t.match(/for\s+(\d+)\s*days?/))) occ = +m[1];
  if (every == null && occ == null) return null;
  if (every == null && occ != null) every = 1; // "for N days" implies daily
  return { repeatEvery: every, endsAfter: occ };
}

// Per-row schedule extras for program-per-row tables: reads the row's OWN
// Global Event column and Repeat (embedded in the Duration cell), keyed by
// Program ID, so each program is checked with its own data only.
export function parsePerRowExtras(doc) {
  const map = {};
  const tables = [];
  (function w(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(w); })(doc);
  for (const tb of tables) {
    const rows = (tb.content || []).map(tr => (tr.content || []).map(td => adfCellLines(td).join(" ").replace(/\s+/g, " ").trim()));
    if (rows.length < 2) continue;
    const header = rows[0].map(h => h.toLowerCase());
    const findCol = (names) => { for (const nm of names) { const i = header.findIndex(h => h.indexOf(nm) >= 0); if (i >= 0) return i; } return -1; };
    const pIdx = findCol(["program id", "program name"]);
    const dIdx = header.findIndex(h => /(^|[^a-z])duration/.test(h) && !/pre|post/.test(h));
    const gIdx = findCol(["global"]);
    if (pIdx < 0 || (dIdx < 0 && gIdx < 0)) continue; // not the per-row schedule table
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const progId = (row[pIdx] || "").trim();
      if (!progId) continue;
      const durCell = dIdx >= 0 ? (row[dIdx] || "") : "";
      const globalVal = gIdx >= 0 ? (row[gIdx] || "").trim() : "";
      const rep = parseRepeat(durCell);
      const durClean = rep ? durCell.replace(/[,;]?\s*repeat\b.*$/i, "").trim() : null;
      const gnorm = /\byes\b/i.test(globalVal) ? "yes" : (/\bno\b/i.test(globalVal) ? "no" : "");
      if (gnorm || rep) map[progId] = { global: gnorm, repeatEvery: rep ? rep.repeatEvery : null, endsAfter: rep ? rep.endsAfter : null, dur: durClean };
    }
    if (Object.keys(map).length) return map;
  }
  return map;
}
