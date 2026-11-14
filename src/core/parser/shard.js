// Values labelled by shard keyword inside a cell (pure).

// Normalize any date to KM Design's M/D order (no leading zeros). Year kept when
// present, dropped when the ticket omits it ("25 Sept" -> "9/25", "9/25" is a
// substring of KM's "9/25/2026" so the contains-match still passes).
// ===== values labelled by shard keyword =====
// A schedule cell can hold several blocks, each followed by a label such as
// "(Fshards,Eshards,Dshards)". The calendar id says which shard letters a calendar belongs to
// (cal.kvk.nov26.f001.e003 -> F and E), so the right block is picked automatically.
export function shardLetters(calId) {
  const out = [];
  String(calId || "").toLowerCase().split(".").forEach(t => { if (/^[a-z]\d{3}$/.test(t) && out.indexOf(t[0]) < 0) out.push(t[0]); });
  return out;
}

export function shardKeys(txt) {
  const out = [], re = /\b([a-z])[\s-]?shards?\b/ig; let m;
  while ((m = re.exec(String(txt || "")))) { const k = m[1].toLowerCase(); if (out.indexOf(k) < 0) out.push(k); }
  return out;
}

export function blocksOf(lines) {
  const blocks = []; let cur = null;
  (lines || []).forEach(l => {
    const t = String(l).trim(); if (!t) return;
    if (/^\(.*\)$/.test(t)) {                                   // a label on its own line, for the block above
      if (cur) { cur.keys = cur.keys.concat(shardKeys(t)); if (!shardKeys(t).length) cur.unknown = t; }
      return;
    }
    const inl = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/);            // "Friday, 06/11/2026 (Cshards)"
    if (inl && inl[1].trim()) { cur = { text: inl[1].trim(), keys: shardKeys(inl[2]) }; if (!cur.keys.length) cur.unknown = inl[2]; blocks.push(cur); return; }
    cur = { text: t, keys: [] }; blocks.push(cur);
  });
  return blocks;
}

export function pickShard(lines, letters) {
  const blocks = blocksOf(lines), labeled = blocks.filter(b => b.keys.length || b.unknown);
  if (!labeled.length) return { value: blocks.map(b => b.text).join(" ") };
  const hit = labeled.filter(b => b.keys.some(k => letters.indexOf(k) >= 0));
  if (hit.length === 1) return { value: hit[0].text };
  const shown = letters.length ? letters.map(x => x.toUpperCase()).join("/") : "(no shard letter in the calendar id)";
  if (hit.length > 1) return { value: hit[0].text, err: "more than one value is labeled for " + shown + " shards \u2014 please check the ticket data" };
  const plain = blocks.filter(b => !b.keys.length && !b.unknown);
  if (plain.length) return { value: plain.map(b => b.text).join(" ") };
  const seen = []; labeled.forEach(b => b.keys.forEach(k => { if (seen.indexOf(k.toUpperCase()) < 0) seen.push(k.toUpperCase()); }));
  return { value: "", err: "no value labeled for " + shown + " shards (ticket labels: " + (seen.join(", ") || labeled.map(b => b.unknown).join(", ")) + ") \u2014 please check the ticket data" };
}
