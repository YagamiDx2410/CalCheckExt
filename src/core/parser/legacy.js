// Older readers kept as fallbacks. parseTicketHtml needs DOMParser (browser only).
import { adfCellLines, adfTables } from "../adf.js";
import { firstDate } from "../dates.js";
import { classifyTags, splitTagTokens } from "../ids.js";

export function parseTicket(doc) {
  const warnings = [];
  if (!doc || !doc.content) return { cases: [], warnings };
  const tables = adfTables(doc);
  const col = (h, name) => h.indexOf(name);
  const isProgramTable = (t) => t.header.indexOf("program name") >= 0
    && (t.header.indexOf("start date") >= 0 || t.header.indexOf("duration") >= 0)
    && t.header.indexOf("id") < 0;
  const hasProgramTable = tables.some(isProgramTable);

  if (hasProgramTable) {
    const cases = [];
    let curCal = "", curFlag = "";
    tables.forEach(t => {
      if (t.header.indexOf("id") >= 0 && t.header.indexOf("program name") < 0) {
        const idC = col(t.header, "id"), flagC = col(t.header, "flag");
        for (let r = 1; r < t.rows.length; r++) {
          const d = t.rows[r].text;
          if (idC >= 0 && d[idC]) { curCal = d[idC]; if (flagC >= 0 && d[flagC]) curFlag = d[flagC]; break; }
        }
      }
      if (isProgramTable(t)) {
        const h = t.header;
        const pnC = col(h, "program name"), sdC = col(h, "start date"), todC = col(h, "time of day"),
          preC = col(h, "pre-duration"), durC = col(h, "duration"), postC = col(h, "post-duration"),
          tagC = col(h, "tags"), flagC = col(h, "flag");
        for (let r = 1; r < t.rows.length; r++) {
          const d = t.rows[r].text;
          const prog = (pnC >= 0 ? d[pnC] : "").trim();
          if (!prog) continue;
          const cls = classifyTags(tagC >= 0 ? d[tagC] : "");
          if (cls.glued && cls.glued.length) warnings.push("Glued tags in \"" + prog + "\": " + cls.glued.join(" | ") + " -> auto-split; re-check Event/Tags.");
          cases.push({
            calId: curCal, progId: prog,
            flag: (flagC >= 0 && d[flagC]) ? d[flagC] : curFlag,
            event: cls.ev.join(", "), tags: cls.tag.join(", "),
            date: firstDate(sdC >= 0 ? d[sdC] : ""), time: (todC >= 0 ? d[todC] : "").trim(),
            pre: (preC >= 0 ? d[preC] : "").trim(), dur: (durC >= 0 ? d[durC] : "").trim(), post: (postC >= 0 ? d[postC] : "").trim()
          });
        }
      }
    });
    if (!curCal) warnings.push("Shared Calendar ID (ID/Flag table) not found -- enter Cal ID manually if needed.");
    return { cases, warnings };
  }

  // single-program layout (fund/event): reuse parseAdf
  const one = parseAdf(doc);
  const has = Object.keys(one).some(k => k[0] !== "_" && one[k]);
  return { cases: has ? [one] : [], warnings: [], evProto: one._evProto, evTags: one._evTags };
}

export function parseAdf(doc) {
  const out = { calId: "", progId: "", tags: "", flag: "", event: "", date: "", time: "", pre: "", dur: "", post: "" };
  if (!doc || !doc.content) return out;
  const evProto = [];      // ev.* from Fund/Event Prototype
  let rawTagsText = "";     // raw content of Calendar "Tags" column (mixed ev.* + tag.*)
  const tables = [];
  (function find(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(find); })(doc);
  tables.forEach(tbl => {
    const rows = (tbl.content || []).filter(r => r.type === "tableRow")
      .map(r => (r.content || []).filter(c => c.type === "tableCell" || c.type === "tableHeader"));
    const rowLines = rows.map(cells => cells.map(adfCellLines));
    const rowText = rowLines.map(cells => cells.map(l => l.join(" ").trim()));
    // label|value rows
    rowText.forEach((cells, ri) => {
      if (cells.length >= 2) {
        const label = cells[0].toLowerCase();
        const valLines = rowLines[ri][1];
        if (label === "flag" && !out.flag) out.flag = valLines[0] || cells[1];
        if (label.indexOf("prototype") >= 0) {
          // collect ALL ev.* in the prototype value (may be several bullets)
          valLines.forEach(ln => { const mm = ln.match(/\bev\.[a-z0-9._-]+/ig); if (mm) mm.forEach(x => evProto.push(x)); });
        }
      }
    });
    // Calendar + time sub-tables (header row then data row)
    for (let ri = 0; ri < rowText.length; ri++) {
      const lc = rowText[ri].map(c => c.toLowerCase());
      const idIdx = lc.indexOf("id"), progIdx = lc.indexOf("program name");
      if (idIdx >= 0 && progIdx >= 0 && rowText[ri + 1]) {
        const d = rowText[ri + 1], tagsIdx = lc.indexOf("tags");
        if (!out.calId && d[idIdx]) out.calId = d[idIdx];
        if (!out.progId && d[progIdx]) out.progId = d[progIdx];
        if (tagsIdx >= 0 && !rawTagsText && d[tagsIdx]) rawTagsText = d[tagsIdx];
      }
      const sdIdx = lc.indexOf("start date"), durIdx = lc.indexOf("duration");
      if (sdIdx >= 0 && durIdx >= 0 && rowText[ri + 1]) {
        const d = rowText[ri + 1];
        const todIdx = lc.indexOf("time of day"), preIdx = lc.indexOf("pre-duration"), postIdx = lc.indexOf("post-duration");
        if (!out.date && d[sdIdx]) out.date = d[sdIdx];
        if (todIdx >= 0 && !out.time && d[todIdx]) out.time = d[todIdx];
        if (preIdx >= 0 && d[preIdx]) out.pre = d[preIdx];
        if (!out.dur && d[durIdx]) out.dur = d[durIdx];
        if (postIdx >= 0 && d[postIdx]) out.post = d[postIdx];
      }
    }
  });

  // classify the mixed Tags cell: ev.* -> Event IDs, tag.* -> Package Tags
  const _split = splitTagTokens(rawTagsText);
  const evTags = _split.tokens.filter(t => /^ev\./i.test(t));
  const tagTags = _split.tokens.filter(t => /^tag\./i.test(t));
  out._glued = _split.glued; // tokens we had to un-glue → surface as a warning
  const uniq = (arr) => arr.filter((v, i) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);

  const eventExpected = uniq(evProto.concat(evTags));
  out.event = eventExpected.join(", ");
  out.tags = uniq(tagTags).join(", ");

  // internal consistency: prototype ev.* vs ev.* found in Tags (same ticket)
  out._evProto = uniq(evProto);
  out._evTags = uniq(evTags);
  return out;
}

// Turn description HTML into ordered "lines" + parsed tables. (fallback only)
export function parseTicketHtml(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const out = { calId: "", progId: "", tags: "", flag: "", event: "", date: "", time: "", pre: "", dur: "", post: "" };

  // -- table parsing: map header cells -> data cells by column index --
  const tables = Array.from(doc.querySelectorAll("table"));
  function rowsOf(tbl) {
    return Array.from(tbl.querySelectorAll("tr")).map(tr =>
      Array.from(tr.querySelectorAll("th,td")).map(c => (c.textContent || "").replace(/\s+/g, " ").trim()));
  }
  function findCol(header, names) {
    for (let i = 0; i < header.length; i++) {
      const h = header[i].toLowerCase();
      for (const n of names) if (h === n.toLowerCase()) return i;
    }
    return -1;
  }
  tables.forEach(tbl => {
    const rows = rowsOf(tbl);
    if (rows.length < 2) return;
    const header = rows[0];
    // Calendar table
    const cID = findCol(header, ["ID"]);
    const cProg = findCol(header, ["Program Name"]);
    const cTags = findCol(header, ["Tags"]);
    if (cID >= 0 && cProg >= 0) {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row[cID] && !out.calId) out.calId = row[cID];
        if (row[cProg] && !out.progId) out.progId = row[cProg];
        if (cTags >= 0 && row[cTags] && !out.tags) out.tags = row[cTags];
        if (out.calId) break;
      }
    }
    // Time table
    const cDate = findCol(header, ["Start Date"]);
    const cTime = findCol(header, ["Time of Day"]);
    const cDur = findCol(header, ["Duration"]);
    const cPre = findCol(header, ["Pre-Duration", "Pre Duration"]);
    const cPost = findCol(header, ["Post-Duration", "Post Duration"]);
    if (cDate >= 0 && cDur >= 0) {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row[cDate] && !out.date) out.date = row[cDate];
        if (cTime >= 0 && row[cTime] && !out.time) out.time = row[cTime];
        if (cPre >= 0 && row[cPre] && !out.pre) out.pre = row[cPre];
        if (row[cDur] && !out.dur) out.dur = row[cDur];
        if (cPost >= 0 && row[cPost] && !out.post) out.post = row[cPost];
        if (out.date || out.dur) break;
      }
    }
  });

  // -- ordered lines (block elements) for label:value + patterns --
  const blocks = Array.from(doc.querySelectorAll("p,li,td,th,h1,h2,h3,h4,h5,h6,div"));
  const lines = [];
  blocks.forEach(el => {
    if (el.querySelector("p,li,table,div,h1,h2,h3,h4,h5,h6")) return; // leaf-ish only
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t) lines.push(t);
  });
  function valueAfter(labelLc) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase() === labelLc) {
        for (let j = i + 1; j < lines.length; j++) { if (lines[j]) return lines[j]; }
      }
    }
    return "";
  }
  if (!out.flag) out.flag = valueAfter("flag");
  // Event: first token starting ev.  (per rule: ev.xxx in a *Prototype field)
  if (!out.event) {
    for (const l of lines) { const m = l.match(/\bev\.[a-z0-9._-]+/i); if (m) { out.event = m[0]; break; } }
  }
  if (!out.tags) {
    for (const l of lines) { const m = l.match(/\btag\.[a-z0-9._,\s-]+/i); if (m) { out.tags = m[0].trim(); break; } }
  }
  return out;
}
