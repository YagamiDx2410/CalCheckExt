// Offer / Store Window tickets (pure).
import { adfPlainText } from "../adf.js";
import { extractDate, timeOf } from "../dates.js";
import { parseRepeat } from "./extras.js";

// ===== v2.9 Offer / Store Window parser =====
// Label|value ticket where each program's date/duration/id is embedded as text:
//   "18 Aug 2025, duration 8d, prototype id: shop.valor"            (1 line)
//   "17 Sept 2026, duration 3d 23h 59m, program id: shop.gold.wk1"  (N lines)
//   Start Date="21 Sept 2026" / "Duration: 22d" / "Program ID: store.2.unlock" (split)
// Offer shops have no ev./tag. (store.* are offer items -> out of scope); Package
// Tags exist on KM Design but aren't given per-program in the ticket -> left blank.
export const DUR_RE = /duration:?\s*([0-9]+d(?:\s*[0-9]+h)?(?:\s*[0-9]+m)?|[0-9]+h(?:\s*[0-9]+m)?|[0-9]+m)/i;

export const PID_RE = /(?:program|prototype)\s*id:\s*([a-z0-9._-]+)/ig;

export function parseOffer(rows, doc) {
  const warnings = ["Offer / Store Window ticket: checks Flag, Date, Time, Duration, Repeat / Ends after (per program line) and Package Tags (when the ticket lists them). store.* items, Store Window (sw.*), prices and brackets are out of scope \u2014 verify manually."];
  let flag = "", calId = "", swId = "";
  const startLines = [], calCellLines = [], durCellLines = [], tagCellLines = [];
  rows.forEach(row => {
    if (row.length < 2) return;
    const label = row[0].text.toLowerCase().replace(/:$/, "").trim();
    const cell = row[1];
    if (label === "flag" && !flag) flag = (cell.lines[0] || "").trim();
    else if (label === "store window id" && !swId) swId = (cell.lines[0] || "").trim();
    else if (label === "calendar id") { const m = cell.lines.join(" ").match(/\bcal\.[a-z0-9._-]+/i); if (m && !calId) calId = m[0]; calCellLines.push(...cell.lines); }
    else if (label === "start date") startLines.push(...cell.lines);
    else if (label === "duration") durCellLines.push(...cell.lines);
    else if (/^(package\s*)?tags?$/.test(label)) tagCellLines.push(...cell.lines);
  });

  const schedLines = startLines.concat(calCellLines).concat(durCellLines);
  const allText = schedLines.join(" \n ");
  let globalDate = ""; for (const ln of schedLines) { const d = extractDate(ln); if (d) { globalDate = d; break; } }
  if (!globalDate) globalDate = extractDate(adfPlainText(doc)); // last-resort: scan whole ticket
  let globalDur = ""; { const m = allText.match(DUR_RE); if (m) globalDur = m[1].trim(); }
  if (!globalDur && durCellLines.length) { const m = durCellLines.join(" ").match(/([0-9]+d(?:\s*[0-9]+h)?(?:\s*[0-9]+m)?|[0-9]+h(?:\s*[0-9]+m)?|[0-9]+m)/i); if (m) globalDur = m[1].trim(); }

  let globalTime = ""; for (const ln of schedLines) { const t = timeOf(ln); if (t) { globalTime = t; break; } }
  const tagRe = /\btag\.[a-z0-9._-]+/gi;
  const sharedTags = (tagCellLines.join(" ").match(tagRe) || []);
  const cases = [];
  schedLines.forEach(line => {
    let m; const re = new RegExp(PID_RE.source, "ig");
    while ((m = re.exec(line))) {
      const progId = m[1];
      let date = extractDate(line) || globalDate;
      const time = timeOf(line) || globalTime;
      let dur = ""; const um = line.match(DUR_RE); if (um) dur = um[1].trim();
      if (!dur) dur = globalDur;
      // repeat belongs to THIS program line only (other lines are not repeat-checked)
      const rep = parseRepeat(line);
      // package tags: this line's own tag.* ids, else a shared "Package Tags" row;
      // none in the ticket -> report KM's value as a Note (not checked)
      const lineTags = line.match(tagRe) || [];
      const tags = Array.from(new Set(lineTags.length ? lineTags : sharedTags)).join(", ");
      cases.push({ calId, progId, flag, event: "", tags, date, time, pre: "", dur, post: "",
        repeatEvery: rep ? rep.repeatEvery : null, endsAfter: rep ? rep.endsAfter : null,
        noteKmTags: !tags, _glued: [], _evProto: [], _evTags: [] });
    }
  });

  if (!cases.length) warnings.push("No 'program id:' / 'prototype id:' found in the ticket \u2014 enter Program ID manually.");
  else if (!cases.some(c => c.date)) warnings.push("Could not read a date from the ticket \u2014 enter Date manually.");
  if (!calId) warnings.push("Calendar ID not found \u2014 enter it manually.");
  return { cases, warnings, evProto: [] };
}
