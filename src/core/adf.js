// Jira ADF (Atlassian Document Format) readers (pure).

export function adfTables(doc) {
  const tables = [];
  (function find(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(find); })(doc);
  return tables.map(tbl => {
    const trows = (tbl.content || []).filter(r => r.type === "tableRow")
      .map(r => (r.content || []).filter(c => c.type === "tableCell" || c.type === "tableHeader"));
    const rows = trows.map(cells => ({ lines: cells.map(adfCellLines), text: cells.map(c => adfCellLines(c).join(" ").trim()) }));
    const header = rows.length ? rows[0].text.map(t => t.toLowerCase()) : [];
    return { header, rows };
  });
}

// Jira date lozenge stores an epoch-ms timestamp (UTC midnight of the date).
export function fmtEpoch(ts) { const n = Number(ts); if (!n) return ""; const d = new Date(n); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear(); }

export function adfPlainText(node) { let s = ""; (function w(n) { if (!n) return; if (n.type === "text") s += " " + n.text; else if (n.type === "date" && n.attrs) s += " " + fmtEpoch(n.attrs.timestamp); else if (n.type === "status" && n.attrs) s += " " + (n.attrs.text || ""); (n.content || []).forEach(w); })(node); return s; }

export function allTableRows(doc) {
  const tables = [];
  (function find(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(find); })(doc);
  const rows = [];
  tables.forEach(tbl => {
    const carry = [];     // logical column -> { cell, left, span }  (a cell merged over several rows)
    (tbl.content || []).filter(r => r.type === "tableRow").forEach(r => {
      const raw = (r.content || []).filter(c => c.type === "tableCell" || c.type === "tableHeader");
      const cells = []; let col = 0, k = 0;
      while (true) {
        if (carry[col] && carry[col].left > 0) {       // the cell above is merged down into this row
          cells.push(carry[col].cell); carry[col].left--; col += carry[col].span; continue;
        }
        if (k >= raw.length) break;
        const c = raw[k++], at = c.attrs || {}, span = Math.max(1, +at.colspan || 1), rs = +at.rowspan || 1;
        const lines = adfCellLines(c), cell = { lines, text: lines.join(" ").trim() };
        cells.push(cell);
        if (rs > 1) carry[col] = { cell, left: rs - 1, span };
        col += span;
      }
      rows.push(cells);
    });
  });
  return rows;
}

// ---- ADF parser (Jira stores the real data as ADF JSON, not rendered HTML) ----
export function adfInlineText(node) {
  let s = "";
  (node.content || []).forEach(n => {
    if (n.type === "text") s += n.text;
    else if (n.type === "hardBreak") s += "\n";
    else if (n.type === "date" && n.attrs) s += fmtEpoch(n.attrs.timestamp); // Jira date lozenge -> M/D/YYYY
    else if (n.type === "status" && n.attrs) s += (n.attrs.text || "");       // status lozenge -> its label
    else if (n.type === "mention" && n.attrs) s += (n.attrs.text || "");
    else if (n.content) s += adfInlineText(n);
  });
  return s;
}

export function adfCellLines(cell) {
  const lines = [];
  (function walk(node) {
    if (!node) return;
    if (node.type === "paragraph" || node.type === "heading") {
      adfInlineText(node).split("\n").forEach(t => { t = t.trim(); if (t) lines.push(t); });
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      (node.content || []).forEach(li => (li.content || []).forEach(walk));
    } else if (node.content) {
      node.content.forEach(walk);
    }
  })({ content: cell.content });
  return lines;
}
