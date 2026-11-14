// Boss-spawn "County Config" table (pure).
import { adfCellLines } from "../adf.js";

// ===== v3/v4 boss-spawn: "County Config (if Applicable)" table =====
// The table has version columns (v3 / v4) and label rows: "ID", "County Config
// (if Applicable)", "Shard Tag". Returns [{ver, coc, progId, shard}] per version col.
export function parseCountyConfig(doc) {
  const tables = [];
  (function w(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(w); })(doc);
  for (const tb of tables) {
    const rows = (tb.content || []).map(tr =>
      (tr.content || []).map(td => adfCellLines(td).join(" ").replace(/\s+/g, " ").trim()));
    // version header row: any cells that are exactly v3 / v4 / v5 ...
    let verCols = null;
    for (const r of rows) {
      const map = {};
      r.forEach((c, ci) => { const m = c.toLowerCase().match(/^v(\d+)$/); if (m) map[ci] = "v" + m[1]; });
      if (Object.keys(map).length) { verCols = map; break; }
    }
    if (!verCols) continue;
    const findRow = (needle) => rows.find(r => (r[0] || "").toLowerCase().indexOf(needle) >= 0);
    const cocRow = findRow("county config");
    if (!cocRow) continue; // not the county-config table
    const idRow = rows.find(r => /^id$/i.test((r[0] || "").trim()));
    const shardRow = findRow("shard tag");
    const out = [];
    Object.keys(verCols).forEach(ciStr => {
      const ci = +ciStr, ver = verCols[ciStr];
      // "has data" = the cell holds something shaped like a config id (word.word...),
      // e.g. coc.* / toc.* / any prefix. Empty / "N/A" / "-" / "TBD" (no dot) -> skip.
      const cocCell = (cocRow[ci] || "").trim();
      const cm = cocCell.match(/\b[a-z][a-z0-9]*\.[a-z0-9._-]+/i);
      if (!cm) return;
      const coc = cm[0];
      out.push({ ver, coc, progId: idRow ? (idRow[ci] || "").trim() : "", shard: shardRow ? (shardRow[ci] || "").trim() : "" });
    });
    if (out.length) return out;
  }
  return [];
}
