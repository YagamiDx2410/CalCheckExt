// Ticket parser entry: picks the right reader for a ticket (pure).
import { adfPlainText, allTableRows } from "../adf.js";
import { parseOffer } from "./offer.js";
import { parseTicketTable } from "./table.js";
export { parseTicket, parseAdf, parseTicketHtml } from "./legacy.js";
export { parseCountyConfig } from "./boss.js";
export { parsePerRowExtras, labelValueScan, parseGlobal, parseRepeat } from "./extras.js";
export { parseTicketTable } from "./table.js";
export { parseOffer } from "./offer.js";

// Picks the reader(s) by scanning the WHOLE ticket instead of a single label:
//  - schedule sentences with "program id:/prototype id:", or an offer/LTO title,
//    or a Store Window row -> sentence (Offer) reader
//  - a program table (Program Name/ID column with values) -> table reader
//  - both -> both, merged (deduped by calendar + program)
export function parseTicketV2(doc, opts) {
  if (!doc || !doc.content) return { cases: [], warnings: [] };
  const rows = allTableRows(doc);
  const docText = adfPlainText(doc);
  const hasSW = rows.some(r => r.length >= 1 && r[0] && r[0].text.toLowerCase().replace(/:$/, "").trim() === "store window id");
  const hasSentences = /\b(program|prototype)\s*id:\s*[a-z0-9._-]+/i.test(docText);
  const offerTitle = /\b(offer|lto)\b/i.test((opts && opts.title) || "");
  const offerRes = (hasSentences || offerTitle || hasSW) ? parseOffer(rows, doc) : null;
  const tableRes = parseTicketTable(doc, opts, rows);
  const offerCases = (offerRes && offerRes.cases) || [];
  if (tableRes.noProgramTable) return offerCases.length ? offerRes : (offerRes || tableRes);
  if (!offerCases.length) {
    if (hasSW) tableRes.warnings = (tableRes.warnings || []).concat("Shop ticket: Store Window (sw.*), store.* prototypes, Max Purchase, prices, rewards, Level Range and Loot Table are out of scope \u2014 verify manually.");
    return tableRes;
  }
  const key = c => (c.calId || "") + "|" + (c.progId || "").toLowerCase();
  const seen = new Set(tableRes.cases.map(key));
  offerCases.forEach(c => { if (!seen.has(key(c))) { tableRes.cases.push(c); seen.add(key(c)); } });
  tableRes.warnings = (tableRes.warnings || []).concat(offerRes.warnings || []);
  return tableRes;
}
