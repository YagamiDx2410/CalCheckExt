// Table tickets read by column label (pure).
import { adfPlainText, allTableRows } from "../adf.js";
import { firstDate, timeOf } from "../dates.js";
import { durVal } from "../duration.js";
import { splitTagTokens } from "../ids.js";
import { parseAdf } from "./legacy.js";
import { pickShard, shardLetters } from "./shard.js";

// ===== v2.7 unified parser: read by COLUMN LABEL, not position =====
// Handles: Program Name in any table; N programs stacked in one cell OR one
// per row; column order/set changing between tickets. Emits a warning when the
// layout differs from the standard template (but still auto-reads).
export const KNOWN_COLS = ["id", "program name", "program id", "kind", "subkind", "tags", "content", "calendar type",
  "start date", "time of day", "repeat every", "repeat count",
  "pre-duration", "duration", "post-duration", "level range", "flag",
  "calendar id", "start time", "start date/time", "when", "shard tag", "shard tags", "program", "date", "time"];
// header aliases: different ticket types name the same field differently

export function normCol(raw) {
  if (raw === "program id") return "program name"; // KvK tickets
  if (raw === "content") return "tags";            // KvK "Content" = mixed ev./tag.
  if (raw === "calendar id") return "id";          // Onboarding-calendar tickets: nav calendar column
  if (raw === "start time" || raw === "when" || raw === "start date/time") return "start date";
  if (raw === "date") return "start date";         // AMS-style tickets: separate Date + Time cols
  if (raw === "time") return "time of day";
  if (raw === "shard tags") return "shard tag";
  if (raw === "program") return "program name";    // schedule tables headed just "Program"
  return raw;
}

export function rowKnownLabels(row) { return row.map(c => c.text.toLowerCase()).filter(t => KNOWN_COLS.indexOf(t) >= 0); }

export function isHeaderRow(row) { return rowKnownLabels(row).length >= 2; }

export function dash(v) { v = (v || "").trim(); return (v === "-" || v === "\u2013" || v === "\u2014") ? "" : v; }

export function progKey(name) {
  let k = (name || "").toLowerCase().trim();
  k = k.replace(/^\d+\./, "");            // "0.meta" -> "meta"
  k = k.replace(/^day\s*(\d+)$/, "d$1");  // "day1"  -> "d1"
  return k;
}

export function parseTicketTable(doc, opts, rows) {
  const isMission = !!(opts && opts.mission); // ticket title contains "mission"
  const warnings = [];

  // 1) scalars from label|value rows (flag stays empty for KvK 'Data flag:' paragraphs)
  let flag = ""; const evProto = []; const evSections = []; let tGlobal = "";
  const scalarShard = [], swIds = [];     // "Shard Tag" label row (one value cell) and "Store Windows" label row
  const evByVer = {}; let verCols = null;   // Event Prototype split per version column: { v3: [...], v4: [...] }
  rows.forEach(row => {
    if (row.length >= 3 && row.filter((c, i) => i > 0 && /^v\d+$/i.test(c.text.trim())).length >= 2) verCols = row.map(c => /^v\d+$/i.test(c.text.trim()) ? c.text.trim().toLowerCase() : "");
    if (row.length >= 2) {
      const label = row[0].text.toLowerCase().replace(/:$/, "").trim();
      if (label === "flag" && !flag) flag = (row[1].lines[0] || row[1].text || "").trim();
      // "Shard Tag | titans-elf-bb": a Shard Tag every program must carry (a row with several value cells, like the
      // v3 | v4 County Config table, is read elsewhere)
      if (label === "shard tag" && row.length === 2) row[1].lines.join(" ").split(/[,;\s]+/).forEach(x => { x = x.trim(); if (/^[a-z0-9][a-z0-9._-]*$/i.test(x) && scalarShard.indexOf(x) < 0) scalarShard.push(x); });
      if (/^store\s*windows?(\s*ids?)?$/.test(label) && row.length === 2) row[1].lines.join(" ").split(/[,;\s]+/).forEach(x => { x = x.trim().replace(/[.,;]+$/, ""); if (/^sw\.[a-z0-9._-]+$/i.test(x) && swIds.indexOf(x) < 0) swIds.push(x); });
      if ((label === "global event" || label === "global") && !tGlobal) { const gv = (row[1].text || "").toLowerCase(); tGlobal = /\byes\b/.test(gv) ? "yes" : (/\bno\b/.test(gv) ? "no" : ""); }
      if (label.indexOf("prototype") >= 0) {
        // An event id is "ev.xxx" with NO prefix before it ("lb.ev.xxx", "q.ev.xxx",
        // "coc.v5.ev.xxx" are other kinds of ids). Headings like "B072/B073" or
        // "C033 (SOLO)" start a section whose events belong to that bracket only.
        // extra value columns (v4, v5 ...) are read too; the version label comes from the header row above
        for (let k = 2; k < row.length; k++) {
          const ver = verCols && verCols.length === row.length ? verCols[k] : "";
          row[k].lines.forEach(ln => { const mm = ln.match(/(?<![A-Za-z0-9._-])ev\.[a-z0-9._-]+/ig); if (mm) mm.forEach(x => { x = x.replace(/[._-]+$/, ""); evProto.push(x); if (ver) (evByVer[ver] = evByVer[ver] || []).push(x); }); });
        }
        const ver1 = verCols && verCols.length === row.length ? verCols[1] : "";
        let cur = null;
        row[1].lines.forEach(ln => {
          const hm = ln.trim().match(/^([a-z]\d{3}(?:\s*[\/,&+]\s*[a-z]\d{3})*)\s*(?:\(.*\))?\s*:?$/i);
          if (hm) { const groups = hm[1].toLowerCase().split(/\s*[,;]\s*/).map(g => g.split(/[\/&+\s]+/).filter(Boolean)).filter(g => g.length); cur = { br: [].concat.apply([], groups), groups, events: [] }; evSections.push(cur); return; }
          const mm = ln.match(/(?<![A-Za-z0-9._-])ev\.[a-z0-9._-]+/ig);
          if (mm) mm.forEach(x => { x = x.replace(/[._-]+$/, ""); evProto.push(x); if (cur) cur.events.push(x); if (ver1) (evByVer[ver1] = evByVer[ver1] || []).push(x); });
        });
      }
    }
  });

  // 2) collect header/data blocks (keep data rows intact — do NOT flatten cells)
  const blocks = []; let calId = "";
  for (let r = 0; r < rows.length; r++) {
    if (!isHeaderRow(rows[r])) continue;
    const header = rows[r], C = header.length, idx = {};
    header.forEach((cell, i) => { const raw = cell.text.toLowerCase(); if (KNOWN_COLS.indexOf(raw) >= 0) { const t = normCol(raw); if (!(t in idx)) idx[t] = i; } });
    const dataRows = []; let rr = r + 1;
    while (rr < rows.length && rows[rr].length === C && !isHeaderRow(rows[rr])) { dataRows.push(rows[rr]); rr++; }
    if (("id" in idx) && !calId) {
      for (const dr of dataRows) { const c = dr[idx["id"]]; const v = c ? c.lines.filter(Boolean)[0] : ""; if (v) { calId = v.trim(); break; } }
    }
    blocks.push({ idx, dataRows });
    r = rr - 1;
  }

  // fallback: no ID column anywhere → take a cal.* token from the whole ticket
  let calFromPattern = false;
  if (!calId) { const m = adfPlainText(doc).match(/\bcal\.[a-z0-9._-]+/i); if (m) { calId = m[0]; calFromPattern = true; } }

  // 3) the program block = the one carrying real Program Name / Program ID values
  // (skip a header-only block whose Program Name column is empty, e.g. the calendar
  // ID table that also has a blank "Program Name" column).
  const hasNames = (b) => { const ci = b.idx["program name"]; return b.dataRows.some(dr => dr[ci] && dr[ci].lines.filter(Boolean).length); };
  const PB = blocks.find(b => ("program name" in b.idx) && hasNames(b)) || blocks.find(b => "program name" in b.idx);
  if (!PB) { // no program column at all → legacy single parser
    const one = parseAdf(doc);
    const has = Object.keys(one).some(k => k[0] !== "_" && one[k]);
    return { cases: has ? [one] : [], warnings, evProto: one._evProto, evTags: one._evTags, noProgramTable: true };
  }
  const nameCi = PB.idx["program name"];
  const multiRow = PB.dataRows.length > 1;      // KvK / classic batch: one program per row
  // Clean program-name lines: drop a leading "<Label>:" prefix (e.g. "Titans:",
  // "Pre-titans:") and merge a bare-label line with the value line that follows
  // it (labels split from their id by a hardBreak/empty paragraph).
  const stripLabel = (s) => (s || "").replace(/^\s*[A-Za-z][A-Za-z0-9 _\-]*:\s*/, "").trim();
  const cleanProgLines = (raw) => {
    // flatten paragraph/hardBreak lines AND comma-separated names in one cell
    const lines = [];
    (raw || []).forEach(x => (x || "").split(",").forEach(p => { p = (p || "").trim(); if (p) lines.push(p); }));
    const out = [];
    for (let k = 0; k < lines.length; k++) {
      let ln = lines[k];
      if (/:\s*$/.test(ln) && !/[a-z]+\.[a-z0-9]/i.test(ln)) { const nxt = (lines[k + 1] || "").trim(); if (nxt) { ln = ln + " " + nxt; k++; } }
      const cleaned = stripLabel(ln);
      if (cleaned) out.push(cleaned);
    }
    return out;
  };
  let progNames;
  if (multiRow) progNames = PB.dataRows.map(r => cleanProgLines(r[nameCi] ? r[nameCi].lines : []).join(" ").trim());
  else progNames = cleanProgLines(PB.dataRows[0] && PB.dataRows[0][nameCi] ? PB.dataRows[0][nameCi].lines : []);
  const N = progNames.length;
  if (!N) { if (!calId) warnings.push("Calendar ID not found -- enter it manually."); return { cases: [], warnings, evProto }; }

  const blockFor = (label) => { if (label in PB.idx) return PB; for (const b of blocks) if (label in b.idx) return b; return null; };
  // return program i's value list for a column in a block (row-mode OR stacked-cell mode)
  const valuesFor = (block, label, i) => {
    if (!block) return [];
    const ci = block.idx[label]; if (ci == null) return [];
    const rws = block.dataRows;
    if (rws.length > 1) { const cell = rws[i] ? rws[i][ci] : null; return cell ? cell.lines.slice() : []; }
    const lines = (rws[0] && rws[0][ci]) ? rws[0][ci].lines : [];
    if (lines.length <= 1) return lines.slice();      // single value → shared
    if (lines.length >= N) return [lines[i]];         // stacked → per index
    return [lines[i] !== undefined ? lines[i] : lines[0]];
  };
  const uq = a => a.filter((v, j) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === j);

  const sdB = blockFor("start date"), todB = blockFor("time of day"), tagsB = blockFor("tags"),
    preB = blockFor("pre-duration"), durB = blockFor("duration"), postB = blockFor("post-duration"),
    shardB = blockFor("shard tag"), flagB = blockFor("flag");
  let idProgTogether = false; blocks.forEach(b => { if (("id" in b.idx) && ("program name" in b.idx)) idProgTogether = true; });

  // Mission tickets: program list in the ID table (PB) + a SEPARATE schedule table
  // with its own "Program Name" column (one row per program). Join by NAME, not by
  // row order; shared event ids; blank Pre/Dur/Post cell = KM must be blank too.
  // Calendar ID per program row (one table can list programs of several calendars)
  const cellFirst = (b, r, col) => { const ci = b.idx[col]; if (ci == null || !b.dataRows[r]) return ""; const c = b.dataRows[r][ci]; return c ? (c.lines.filter(Boolean)[0] || "").trim() : ""; };
  const rowCal = (i) => { if (multiRow && ("id" in PB.idx)) { const v = cellFirst(PB, i, "id"); if (/^cal\./i.test(v)) return v; } return calId; };
  // A 2nd table with its own Program Name column (e.g. Tags in one table, Start
  // Date in another): join it to the program table by (Calendar ID, program name).
  const joinB = blocks.find(b => b !== PB && ("program name" in b.idx) && (("start date" in b.idx) || ("duration" in b.idx) || ("time of day" in b.idx)));
  const missionB = isMission ? joinB : null;
  const joinRow = {};
  if (joinB && !missionB) {
    const jci = joinB.idx["program name"];
    joinB.dataRows.forEach((dr, r) => {
      const nm = stripLabel(dr[jci] ? dr[jci].lines.join(" ") : "").toLowerCase(); if (!nm) return;
      const jc = cellFirst(joinB, r, "id");
      if (/^cal\./i.test(jc)) joinRow[jc + "|" + nm] = r;
      if (!(("|" + nm) in joinRow)) joinRow["|" + nm] = r; else joinRow["|" + nm] = -1; // name-only, -1 = ambiguous
    });
  }
  const missionRow = {};
  if (missionB) {
    const mci = missionB.idx["program name"];
    missionB.dataRows.forEach((dr, r) => { const nm = stripLabel(dr[mci] ? dr[mci].lines.join(" ") : ""); if (nm) missionRow[nm.toLowerCase()] = { r, nm }; });
    const listed = progNames.map(n => n.toLowerCase());
    Object.keys(missionRow).forEach(k => { if (listed.indexOf(k) < 0) warnings.push("Schedule table has \"" + missionRow[k].nm + "\" which is not in the Program Name list \u2014 not checked."); });
  }
  const mCell = (label, r) => { const MB = missionB || joinB; if (!MB) return ""; const ci = MB.idx[label]; if (ci == null) return ""; const c = MB.dataRows[r] ? MB.dataRows[r][ci] : null; return c ? c.lines.join(" ").trim() : ""; };

  // ===== Calendar-grouped tickets (KvK): each calendar row lists SEVERAL programs =====
  // Programs are joined to the schedule table by NAME. The calendar id's bracket labels
  // (b072, c033 ...) choose the matching "(B072/B073)" / "(C033)" values and the matching
  // Event Prototype section. Flag + Tag are checked on the calendar page, not per program.
  const grpNames = (r) => cleanProgLines(PB.dataRows[r][nameCi] ? PB.dataRows[r][nameCi].lines : []);
  const calGroupMode = multiRow && !!joinB && ("id" in PB.idx)
    && PB.dataRows.every((dr, r) => /^cal\./i.test(cellFirst(PB, r, "id")))
    && PB.dataRows.some((dr, r) => grpNames(r).length > 1);
  if (calGroupMode) {
    const bracketsOf = (id) => (String(id || "").toLowerCase().match(/(?<![a-z0-9])[a-z]\d{3}(?![a-z0-9])/g) || []);
    const sameSet = (a, b) => a.length === b.length && a.every(x => b.indexOf(x) >= 0);
    // a label is one or more groups separated by a comma: "(B072/B073)" = one calendar, "(E004/D012, D013/D014)" = two
    const parseBr = (txt) => {
      const groups = String(txt || "").toLowerCase().split(/\s*[,;]\s*/).map(g => g.split(/[\/&+\s]+/).filter(Boolean)).filter(g => g.length);
      return (groups.length && groups.every(g => g.every(x => /^[a-z]\d{3}$/.test(x)))) ? groups : null;
    };
    const grpTxt = (groups) => groups.map(g => g.join("/").toUpperCase()).join(", ");
    const hasGroup = (groups, calBr) => (groups || []).some(g => sameSet(g, calBr));
    // pick the value labeled for this calendar's brackets: "1d 23h 45m (B072/B073)," / "2d 23h 45m (C033)"
    const pickBr = (lines, calBr) => {
      const items = (lines || []).map(l => {
        const m = String(l).match(/^(.*?)\s*\(([^)]*)\)\s*[,;]?\s*$/);
        if (m) { const br = parseBr(m[2]); if (br) return { v: m[1].trim().replace(/[,;]$/, ""), br }; }
        return { v: String(l).trim().replace(/[,;]$/, ""), br: null };
      }).filter(x => x.v);
      const labeled = items.filter(x => x.br), plain = items.filter(x => !x.br);
      if (!labeled.length) return { value: plain.map(x => x.v).join(" ") };
      const hit = labeled.find(x => hasGroup(x.br, calBr));
      if (hit) return { value: hit.v };
      if (plain.length) return { value: plain.map(x => x.v).join(" ") };
      return { value: "", err: labeled.map(x => grpTxt(x.br)) };
    };
    const gCases = [], gWarn = warnings.slice();
    gWarn.push("KvK calendar-grouped ticket: Flag + Tag are checked on the calendar page; each program is checked for Date / Time / Pre / Duration / Post, Global (when it has events) and event placement.");
    PB.dataRows.forEach((dr, r) => {
      const cal = cellFirst(PB, r, "id");
      const calBr = bracketsOf(cal);
      const brTxt = calBr.length ? calBr.map(x => x.toUpperCase()).join("/") : "(no bracket label in the calendar id)";
      const tags = splitTagTokens(valuesFor(PB, "tags", r).join(" ")).tokens.filter(t => /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(t));
      const names = grpNames(r);
      const sec = (evSections.length && calBr.length) ? evSections.find(sc => hasGroup(sc.groups || [sc.br], calBr)) : null;
      const calErr = [];
      if (evSections.length && calBr.length && !sec)
        calErr.push("Event Prototype has no section labeled for " + brTxt + " (ticket sections: " + evSections.map(sc => grpTxt(sc.groups || [sc.br])).join(" | ") + ") \u2014 please check the ticket data");
      const strict = !!(sec && sec.events.length); // the ticket's own section is the whitelist (works for bcshards / cshard / c033 ...)
      const evOthers = evSections.filter(sc => sc !== sec).map(sc => ({ name: grpTxt(sc.groups || [sc.br]), events: sc.events.slice() }));
      gCases.push({ calCheck: true, flagCmp: !!flag, calId: cal, progId: cal, flag, expTag: tags.join(", "), bracket: brTxt,
        evExpected: sec ? sec.events.slice() : [], evStrict: strict, evOthers, evProgs: names.slice(), dataErrors: calErr,
        event: "", tags: "", date: "", time: "", pre: "", dur: "", post: "", strictEmpty: [], _glued: [], _evProto: [], _evTags: [] });
      names.forEach(nm => {
        const key = nm.toLowerCase();
        let jr = joinRow[cal + "|" + key];
        if (jr == null) { const r2 = joinRow["|" + key]; if (r2 != null && r2 >= 0) jr = r2; }
        const perr = []; let date = "", time = "", pre = "", dur = "", post = "", schedNote = "";
        if (jr != null && jr >= 0) {
          const lines = (label) => { const ci = joinB.idx[label]; const c = (ci == null) ? null : (joinB.dataRows[jr] ? joinB.dataRows[jr][ci] : null); return c ? c.lines : []; };
          const val = (label, shown) => {
            const pk = pickBr(lines(label), calBr);
            if (pk.err) perr.push(shown + ": no value labeled for " + brTxt + " (ticket labels: " + pk.err.join(", ") + ") \u2014 please check the ticket data");
            return pk.value || "";
          };
          const sd = val("start date", "Start Date"); date = firstDate(sd);
          time = ("time of day" in joinB.idx) ? (val("time of day", "Time of Day") || timeOf(sd)) : timeOf(sd);
          pre = durVal(val("pre-duration", "Pre-Duration")); dur = durVal(val("duration", "Duration")); post = durVal(val("post-duration", "Post-Duration"));
        } else {
          schedNote = "Schedule for \"" + nm + "\" is missing in the ticket \u2014 date/time/durations not checked (KM values recorded only).";
          gWarn.push("No schedule row for \"" + nm + "\" in the ticket \u2014 its schedule is not checked.");
        }
        gCases.push({ flagCmp: !!flag, bracket: brTxt, calId: cal, progId: nm, flag, event: "", tags: "", cocIds: "", calIds: "", unknownContent: "", shardTokens: "", noteKmTags: false, shard: "",
          date, time, pre, dur, post, strictEmpty: [], schedNote, evNote: "", dataErrors: perr,
          kvk: true, evWatch: sec ? sec.events.slice() : [], evOthers, noteEvents: true, globalIfEvents: tGlobal === "yes",
          _glued: [], _evProto: evProto, _evTags: [] });
      });
    });
    return { cases: gCases, warnings: gWarn, evProto };
  }

  // ===== One calendar per row; the Tags column is the CALENDAR's Tag (KM-63232) =====
  // The same program is listed under several calendars, each row with a tag such as
  // kvk-f001-e003. That tag is what the calendars list shows in its Tag column, so it is checked
  // on the calendar page (a CAL row per calendar); it is NOT compared with the program's Shard Tag
  // or Package Tags. Event / flag / duration are shared; a labelled schedule cell is resolved per
  // calendar from the shard letters in its id.
  const hyTok = (r) => { const ci = PB.idx["tags"]; const c = ci == null || !PB.dataRows[r] ? null : PB.dataRows[r][ci]; return c ? splitTagTokens(c.lines.join(" ")).tokens : []; };
  const hyOnly = (r) => hyTok(r).filter(t => /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(t) && !/^tag\./i.test(t));
  const tailMatch = (cal, tag) => { const t = tag.toLowerCase().replace(/^[a-z]+-/, "").split("-"), parts = cal.toLowerCase().split("."); return t.length > 0 && parts.slice(-t.length).join(".") === t.join("."); };
  const sameProg = multiRow && PB.dataRows.length > 1 && PB.dataRows.every((dr, r) => grpNames(r).length === 1 && grpNames(r)[0].toLowerCase() === grpNames(0)[0].toLowerCase());
  const calTagMode = !calGroupMode && multiRow && ("id" in PB.idx) && ("tags" in PB.idx) && sdB
    && PB.dataRows.every((dr, r) => /^cal\./i.test(cellFirst(PB, r, "id")) && grpNames(r).length === 1 && hyOnly(r).length === 1)
    && (sameProg || PB.dataRows.filter((dr, r) => tailMatch(cellFirst(PB, r, "id"), hyOnly(r)[0])).length * 2 >= PB.dataRows.length);
  if (calTagMode) {
    const tCases = [], tWarn = warnings.slice();
    tWarn.push("Calendar-tag layout: the Tags column is each calendar's Tag, checked on the calendars list (picture 1 of the report) inside the program's row. Program Shard Tag / Package Tags are not compared with it. A schedule value labelled \"(Fshards, \u2026)\" is matched to a calendar by the shard letters in its id.");
    const cellLines = (b, label) => { if (!b || !(label in b.idx) || !b.dataRows[0]) return []; const c = b.dataRows[0][b.idx[label]]; return c ? c.lines : []; };
    PB.dataRows.forEach((dr, r) => {
      const cal = cellFirst(PB, r, "id"), name = grpNames(r)[0], letters = shardLetters(cal), errs = [];
      const pick = (b, label, shown) => { const pk = pickShard(cellLines(b, label), letters); if (pk.err) errs.push(shown + ": " + pk.err); return pk.value || ""; };
      const sd = pick(sdB, "start date", "Start Date");
      const date = firstDate(sd);
      const time = todB ? (pick(todB, "time of day", "Time of Day") || timeOf(sd)) : timeOf(sd);
      const pre = preB ? durVal(pick(preB, "pre-duration", "Pre-Duration")) : "";
      const dur = durB ? durVal(pick(durB, "duration", "Duration")) : "";
      const post = postB ? durVal(pick(postB, "post-duration", "Post-Duration")) : "";
      const pkg = hyTok(r).filter(t => /^tag\./i.test(t));
      tCases.push({ calTag: hyOnly(r)[0], flagCmp: !!flag, bracket: (cal.toLowerCase().match(/(?<![a-z0-9])[a-z]\d{3}(?![a-z0-9])/g) || []).map(x => x.toUpperCase()).join("/"), calId: cal, progId: name, flag, event: uq(evProto).join(", "), tags: uq(pkg).join(", "), cocIds: "", calIds: "", unknownContent: "", shardTokens: "", shard: "", noteKmTags: !pkg.length,
        date, time, pre, dur, post, strictEmpty: [], schedNote: "", evNote: "", dataErrors: errs, _glued: [], _evProto: evProto, _evTags: [] });
    });
    return { cases: tCases, warnings: tWarn, evProto };
  }

  // program kind from its name: "store" programs carry package tags (no event), "event" programs carry the event
  const progKind = (nm) => { const t = String(nm).toLowerCase().split(/[.\-_\s]+/); return (t.indexOf("store") >= 0 || t.indexOf("shop") >= 0) ? "store" : ((t.indexOf("event") >= 0 || t.indexOf("events") >= 0) ? "event" : ""); };
  // a schedule table with fewer rows than programs and NO program column: map the rows by the week token in the
  // program names (wk1, wk3 ...): the smallest week uses the first row, the next week the second row, and so on
  const wkOf = (nm) => { const m = String(nm).toLowerCase().match(/(?<![a-z0-9])wk(\d+)(?![a-z0-9])/); return m ? +m[1] : null; };
  let wkWeeks = null;
  if (sdB && sdB.dataRows.length > 1 && sdB.dataRows.length !== N && !joinB && !missionB) {
    const weeks = Array.from(new Set(progNames.map(wkOf).filter(w => w != null))).sort((a, b) => a - b);
    if (weeks.length === sdB.dataRows.length && progNames.every(n => wkOf(n) != null)) wkWeeks = weeks;
    else warnings.push("The schedule table has " + sdB.dataRows.length + " rows but the program names do not give " + sdB.dataRows.length + " week tokens (wk1, wk3 ...) -- schedule not mapped to programs.");
  }

  const cases = [];
  for (let i = 0; i < N; i++) {
    const name = (progNames[i] || "").trim();
    if (!name) continue;
    const sIdx = wkWeeks ? wkWeeks.indexOf(wkOf(name)) : -1, si = sIdx >= 0 ? sIdx : i;   // row of the schedule table

    let sdStr = valuesFor(sdB, "start date", si).join(" ").trim();
    let date = firstDate(sdStr);
    let time = todB ? valuesFor(todB, "time of day", si).join(" ").trim() : timeOf(sdStr); // split combined "Thu, 9/10, 02:15 UTC"
    // safeguard: if no date column matched by name, detect a date-time value by CONTENT
    if (!date && multiRow && PB.dataRows[i]) {
      for (const c of PB.dataRows[i]) {
        const txt = c ? c.lines.join(" ") : "";
        const d = firstDate(txt);
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(d)) { date = d; sdStr = txt; if (!time) time = timeOf(txt); break; }
      }
    }

    // classify the Content cell by prefix -> the KM field each token must live in
    let rawContent = valuesFor(tagsB, "tags", i).join(" ");
    // a note such as "(required shard tag: kvk-winner)" is a Shard Tag the program must have
    const reqShard = [];
    rawContent = rawContent.replace(/\(?\s*required\s+shard\s+tags?\s*:?\s*([A-Za-z0-9][A-Za-z0-9,\s-]*?)\s*\)/ig, (m0, tg) => { String(tg).split(/[,\s]+/).filter(Boolean).forEach(x => reqShard.push(x)); return " "; });
    const split = splitTagTokens(rawContent);
    const evInTags = [], tagInTags = [], cocInTags = [], calInTags = [], unkInTags = [], shardInTags = reqShard.slice();
    split.tokens.forEach(tk => {
      if (/^ev\./i.test(tk)) evInTags.push(tk);
      else if (/^tag\./i.test(tk)) tagInTags.push(tk);
      else if (/^coc\./i.test(tk)) cocInTags.push(tk);
      else if (/^(cal|missions?)\./i.test(tk)) calInTags.push(tk);
      else if (tk.indexOf(".") >= 0) unkInTags.push(tk); // id-shaped but unknown prefix
      else if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(tk)) shardInTags.push(tk); // e.g. valor-shop, kvk-winner -> Shard Tag
    });
    if (split.glued.length) warnings.push("Glued tags in \"" + name + "\": " + split.glued.join(" | ") + " -> auto-split.");

    let ev, evNote = "";
    const verKeys = Object.keys(evByVer);
    const verTok = verKeys.length ? name.toLowerCase().split(/[.\-_\s]+/).reverse().find(t => evByVer[t]) : "";
    if (verTok) ev = evByVer[verTok].slice();      // Event Prototype column of this program's version
    else if (isMission && N > 1) {
      // mission: use the ticket's own event for this program if listed; otherwise
      // derive it from the .meta prototype (0.meta -> .meta, day1 -> .d1, ...)
      const key = progKey(name), last = x => x.toLowerCase().split(".").pop();
      ev = evProto.filter(p => last(p) === key || p.toLowerCase().indexOf("." + name.toLowerCase()) >= 0);
      if (!ev.length) {
        const metaP = evProto.find(p => /\.meta$/i.test(p));
        if (metaP) { ev = [metaP.replace(/\.meta$/i, "." + key)]; evNote = "Event ID derived from the .meta prototype (" + metaP + "): " + ev[0]; }
        else evNote = "No event for \"" + name + "\" in the ticket and no .meta prototype to derive from \u2014 event not checked.";
      }
    }
    else if (N === 1) ev = evProto.slice();
    else if (evProto.length) {
      // prefer an event prototype that contains the full program id (ev.<name>)
      ev = evProto.filter(p => p.toLowerCase().indexOf(name.toLowerCase()) >= 0);
      if (!ev.length) { // fallback: match by last token (0.meta -> d1 style)
        const key = progKey(name), last = x => x.toLowerCase().split(".").pop();
        ev = evProto.filter(p => last(p) === key);
      }
      if (!ev.length && !evInTags.length) {
        const kind = progKind(name);
        if (kind === "store") ev = [];                                  // store programs carry package tags, no event
        else if (kind === "event" && evProto.length === 1) ev = evProto.slice();   // the one event of the ticket
        else warnings.push("Could not map Event for \"" + name + "\" -- enter manually.");
      }
    } else ev = []; // no prototype list → events come from the Content/Tags cell itself

    let pre = durVal(valuesFor(preB, "pre-duration", si).join(" "));
    let dur = durVal(valuesFor(durB, "duration", si).join(" "));
    let post = durVal(valuesFor(postB, "post-duration", si).join(" "));
    let strictEmpty = [], schedNote = "";
    if (sIdx >= 0) schedNote = "Schedule row " + (sIdx + 1) + " of " + wkWeeks.length + " assigned by the week in the program name (wk" + wkOf(name) + ") \u2014 the ticket's schedule table has no program column.";
    const cal_i = rowCal(i);
    let joinFlag = "";
    if (joinB && !missionB) {
      const nm = name.toLowerCase();
      let r = joinRow[cal_i + "|" + nm];
      if (r == null) { const r2 = joinRow["|" + nm]; if (r2 != null && r2 >= 0) r = r2; }
      if (r != null && r >= 0) {
        const sd = mCell("start date", r); if (sd) { sdStr = sd; date = firstDate(sd); time = ("time of day" in joinB.idx) ? (mCell("time of day", r) || timeOf(sd)) : timeOf(sd); }
        else if ("time of day" in joinB.idx) { const tod = mCell("time of day", r); if (tod) time = tod; }
        if ("pre-duration" in joinB.idx) pre = durVal(mCell("pre-duration", r));
        if ("duration" in joinB.idx) dur = durVal(mCell("duration", r));
        if ("post-duration" in joinB.idx) post = durVal(mCell("post-duration", r));
        if ("flag" in joinB.idx) joinFlag = mCell("flag", r);
      }
    }
    if (missionB) {
      const hit = missionRow[name.toLowerCase()];
      if (hit) {
        const r = hit.r;
        sdStr = mCell("start date", r); date = firstDate(sdStr);
        time = ("time of day" in missionB.idx) ? mCell("time of day", r) : timeOf(sdStr);
        pre = durVal(mCell("pre-duration", r)); dur = durVal(mCell("duration", r)); post = durVal(mCell("post-duration", r));
        // blank cell in a column that EXISTS = KM must be blank too (Pre/Dur/Post only)
        if ("pre-duration" in missionB.idx) strictEmpty.push("pre");
        if ("duration" in missionB.idx) strictEmpty.push("dur");
        if ("post-duration" in missionB.idx) strictEmpty.push("post");
      } else {
        date = ""; time = ""; pre = ""; dur = ""; post = "";
        schedNote = "Schedule for \"" + name + "\" is missing in the ticket \u2014 date/time/durations not checked (KM values recorded only).";
        warnings.push("No schedule row for \"" + name + "\" in the ticket \u2014 its schedule is not checked.");
      }
    }

    // store programs: Package Tags from the ticket's Store Windows (sw.titanshop.elf.v2 -> tag.titanshop.elf.v2)
    let storeTags = [];
    if (progKind(name) === "store" && swIds.length && !tagInTags.length) {
      storeTags = swIds.map(x => x.replace(/^sw\./i, "tag."));
      evNote = (evNote ? evNote + " " : "") + "Package Tags derived from the ticket's Store Windows (" + swIds.map((x, k) => x + " \u2192 " + storeTags[k]).join(", ") + ").";
    }

    // calendars listed in this program's ID cell (several cal-ids stacked in one cell = same program in each)
    const calList = (() => { if (!("id" in PB.idx)) return null; const c0 = PB.dataRows[multiRow ? i : 0] ? PB.dataRows[multiRow ? i : 0][PB.idx["id"]] : null; const l = c0 ? c0.lines.map(x => x.trim()).filter(x => /^cal\./i.test(x)) : []; return l.length > 1 ? l : null; })();
    cases.push({
      calList,
      calId: cal_i, progId: name, flag: (flagB ? valuesFor(flagB, "flag", i).join(" ").trim() : "") || joinFlag || flag,
      event: uq(ev.concat(evInTags)).join(", "), tags: uq(tagInTags.concat(storeTags)).join(", "),
      cocIds: uq(cocInTags).join(", "), calIds: uq(calInTags).join(", "), unknownContent: uq(unkInTags).join(", "),
      shardTokens: uq(shardInTags.concat(scalarShard)).join(", "), noteKmTags: !uq(tagInTags.concat(storeTags)).length,
      shard: shardB ? valuesFor(shardB, "shard tag", i).join(" ").trim() : "",
      date, time, pre, dur, post, strictEmpty, schedNote, evNote,
      _glued: split.glued, _evProto: evProto, _evTags: evInTags
    });
  }

  // Calendars listed in a small table of their own (cal-id [+ its Tag] per row; no ID column in the program
  // table): every program applies to EVERY listed calendar. Each calendar also gets a CAL row for its Tag.
  let calHeader = null;
  if (calFromPattern) {
    const found = [];
    allTableRows(doc).forEach(row => {
      const texts = row.map(c => c.text.trim());
      const cal = texts.find(t => /^cal\.[a-z0-9._-]+$/i.test(t));
      if (!cal || found.some(x => x.calId.toLowerCase() === cal.toLowerCase())) return;
      found.push({ calId: cal, tag: texts.find(t => /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(t) && !/^cal\./i.test(t)) || "" });
    });
    if (found.length > 1) {
      calHeader = found;
      cases.forEach(c => { c.calList = found.map(x => x.calId); c.showCal = true; });
    }
  }

  // Calendar fan-out: a program listed under several cal-ids is checked once per calendar,
  // all sharing the ticket's event / tag / flag / schedule. Order: by calendar, then program
  // (the batch re-uses an already opened calendar).
  if (cases.some(c => c.calList)) {
    const order = [];
    cases.forEach(c => (c.calList || [c.calId]).forEach(k => { if (order.indexOf(k) < 0) order.push(k); }));
    const out = [];
    order.forEach(k => cases.forEach(c => { const l = c.calList || [c.calId]; if (l.indexOf(k) >= 0) { const cc = Object.assign({}, c, { calId: k }); delete cc.calList; out.push(cc); } }));
    const nProg = new Set(cases.map(c => c.progId.toLowerCase())).size;
    cases.length = 0; out.forEach(x => cases.push(x));
    warnings.push("Calendar fan-out: " + order.length + " calendars \u00D7 " + nProg + " program" + (nProg === 1 ? "" : "s") + " = " + out.length + " checks (same event / tag / flag / schedule in every calendar).");
  } else cases.forEach(c => { delete c.calList; });
  if (calHeader) {
    const brOf = (cal) => (cal.toLowerCase().match(/(?<![a-z0-9])[a-z]\d{3}(?![a-z0-9])/g) || []).map(x => x.toUpperCase()).join("/");
    const out = [];
    calHeader.forEach(h => {
      out.push({ calCheck: true, flagCmp: false, calId: h.calId, progId: h.calId, flag: "", expTag: h.tag, bracket: brOf(h.calId),
        evExpected: [], evStrict: false, evProgs: [], dataErrors: [], event: "", tags: "", date: "", time: "", pre: "", dur: "", post: "", strictEmpty: [], _glued: [], _evProto: [], _evTags: [] });
      cases.filter(c => c.calId.toLowerCase() === h.calId.toLowerCase()).forEach(c => { c.bracket = brOf(h.calId); out.push(c); });
    });
    cases.length = 0; out.forEach(x => cases.push(x));
    warnings.push("Calendars listed in the ticket: " + calHeader.map(h => h.calId + (h.tag ? " (Tag " + h.tag + ")" : " (no Tag listed)")).join(", ") + " -- every program is checked in each calendar, and each calendar's Tag is checked on its own row.");
  }

  // 4) warnings
  if (!idProgTogether)
    warnings.unshift("Non-standard layout: 'Program Name/ID' is not in the same table as 'ID'. Read by column label -- please double-check.");
  if (calFromPattern && !calHeader) warnings.push("Calendar ID taken by cal.* pattern (no ID column in ticket): " + calId + " -- please double-check.");
  if (!calId) warnings.push("Calendar ID not found -- enter it manually.");
  return { cases, warnings, evProto };
}
