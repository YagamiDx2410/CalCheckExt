"use strict";

const DEFAULT_URL = "https://design.km.globalworldwide.com/design/calendars";
const $ = (id) => document.getElementById(id);
const FIELDS = ["url", "jiraLink", "calId", "progId", "flag", "event", "tags", "date", "time", "pre", "dur", "post"];
// ---- session memory: everything typed / read is saved as you go, so closing the popup never loses it ----
const SESSION_TTL = 12 * 3600 * 1000;   // a saved session is dropped after 12 hours
let baseStep = "url", sessionTicket = "", restoredSession = null;

// ===== save-folder module (File System Access API + IndexedDB) =====
let dirHandle = null; // in-memory handle for this popup session

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("calcheck", 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("kv")) open.result.createObjectStore("kv"); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const store = db.transaction("kv", mode).objectStore("kv");
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const idbGet = (k) => idb("readonly", s => s.get(k));
const idbSet = (k, v) => idb("readwrite", s => s.put(v, k));
const idbDel = (k) => idb("readwrite", s => s.delete(k));

function updateLocUI() {
  const name = dirHandle ? dirHandle.name : "";
  $("locName").textContent = dirHandle ? name : "Downloads/CalCheck (default)";
  $("resetDir").classList.toggle("hide", !dirHandle);
}
async function loadDir() {
  try { const h = await idbGet("saveDir"); if (h) { dirHandle = h; } } catch (e) {}
  updateLocUI();
}
async function ensureDirPermission() {
  if (!dirHandle) return false;
  try {
    const q = await dirHandle.queryPermission({ mode: "readwrite" });
    if (q === "granted") return true;
    const r = await dirHandle.requestPermission({ mode: "readwrite" }); // needs user gesture
    return r === "granted";
  } catch (e) { return false; }
}
async function writeToDir(handle, baseName, dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const safe = baseName.replace(/[\/\\:*?"<>|]+/g, "_");
  const dot = safe.lastIndexOf(".");
  const stem = dot >= 0 ? safe.slice(0, dot) : safe;
  const ext = dot >= 0 ? safe.slice(dot) : "";
  let name = safe, i = 1;
  while (true) {
    let exists = false;
    try { await handle.getFileHandle(name, { create: false }); exists = true; } catch (e) { exists = false; }
    if (!exists) break;
    name = stem + " (" + (i++) + ")" + ext;
  }
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return name;
}

$("pickDir").onclick = async () => {
  if (!window.showDirectoryPicker) { $("locHint").textContent = "This Chrome doesn't support folder picking. Screenshots will save to Downloads/CalCheck."; return; }
  try {
    const h = await window.showDirectoryPicker({ mode: "readwrite" });
    dirHandle = h;
    await idbSet("saveDir", h);
    updateLocUI();
    $("locHint").textContent = "\u2705 Screenshots will save to this folder. After a Chrome restart you may need to click Allow once.";
  } catch (e) { /* user cancelled */ }
};
$("resetDir").onclick = async () => {
  dirHandle = null;
  try { await idbDel("saveDir"); } catch (e) {}
  updateLocUI();
  $("locHint").textContent = "Reset to default: Downloads/CalCheck.";
};

function show(step) {
  if (step === "url" || step === "form") baseStep = step;
  $("stepUrl").classList.toggle("hide", step !== "url");
  $("stepForm").classList.toggle("hide", step !== "form");
  $("stepResult").classList.toggle("hide", step !== "result");
  $("stepBatch").classList.toggle("hide", step !== "batch");
  $("stepLabel").textContent = step === "url" ? "Step 1/2 \u2014 URL" : step === "form" ? "Step 2/2 \u2014 Values" : "Result";
  saveState();
}

// batch state
let batchCases = [];
let batchSel = null;      // Set of ticked case keys; null = all ticked
let lastSummary = [];     // latest result per case (re-checks replace only the rows they re-ran)
let singleExtras = {};
let lastLogText = "";
function ticketKey() { const m = ($("jiraLink").value || "").match(/[A-Z][A-Z0-9]+-\d+/); return m ? m[0] : ""; } // Global/Repeat carried into single-mode CHECK (no UI fields)
function enterSingleMode() {
  batchCases = []; batchSel = null; lastSummary = []; $("batchTags").value = "";
  $("batchBox").classList.add("hide");
  $("singleFields").classList.remove("hide");
  saveState();
}
// Package Tags typed by hand for the whole batch (checked in addition to what the ticket lists)
function manualTagList() { return Array.from(new Set(($("batchTags").value || "").split(/[,;\s]+/).map(x => x.trim()).filter(Boolean))); }
function updateTagsNote() {
  const prog = batchCases.filter(c => !c.calCheck && !c.boss), withTags = prog.filter(c => c.tags && c.tags.trim()).length;
  const n = $("batchTagsNote"), man = manualTagList();
  let txt;
  if (!prog.length) txt = "";
  else if (!withTags) txt = man.length ? "The ticket has no Package Tags for these programs. Your " + man.length + " tag(s) will be checked on every program that is ticked." : "\u26A0 The ticket has no Package Tags for these programs. Type them here to add a check; left empty, the report only shows a Note with the Package Tags found on KM.";
  else if (withTags === prog.length) txt = "Package Tags come from the ticket" + (man.length ? "; your " + man.length + " tag(s) are checked in addition." : ". Anything typed here is checked in addition.");
  else txt = "The ticket lists Package Tags for " + withTags + " of " + prog.length + " programs. Type tags here to check them on every program.";
  n.textContent = txt; n.style.color = (!withTags && !man.length && prog.length) ? "#b36b00" : "#7a7f92";
}
function caseKey(c) { return (c.calCheck ? "CAL|" : "") + (c.calId || "") + "|" + (c.progId || ""); }
function isSel(k) { return batchSel === null || batchSel.has(k); }
function enterBatchMode(cases, keep) {
  if (!keep) { batchSel = null; lastSummary = []; $("batchTags").value = ""; }
  batchCases = cases;
  $("singleFields").classList.add("hide");
  $("batchBox").classList.remove("hide");
  const list = $("batchList"); list.innerHTML = "";
  cases.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "batch-item";
    const calTag = c.calCheck ? ' <span style="background:#e3f2ff;color:#1565c0;border-radius:4px;padding:0 5px;font-size:10px;font-weight:700;">CAL</span>' : "";
    const tag = c.calCheck ? calTag : c.boss ? ' <span style="background:#ede7ff;color:#5b3ec8;border-radius:4px;padding:0 5px;font-size:10px;font-weight:700;">' + esc((c.ver || "boss").toUpperCase()) + '</span>' : "";
    let meta = c.calCheck
      ? "calendar page \u00B7 Tag " + esc(c.expTag || "-") + " \u00B7 " + esc(c.bracket || "") + ((c.evProgs || []).length ? " \u00B7 " + c.evProgs.length + " programs" : "")
      : c.boss
      ? esc(c.calId) + " \u00B7 coc " + esc(c.coc) + " \u00B7 shard " + esc(c.shard) + " \u00B7 dur " + esc(c.dur || "-")
      : esc(c.calId) + " \u00B7 " + esc(c.date || "?") + " \u00B7 dur " + esc(c.dur || "-") + (c.tags ? " \u00B7 " + esc(c.tags) : "") + (c.event ? " \u00B7 " + esc(c.event) : "");
    const k = caseKey(c), lr = lastSummary.find(r => caseKey(r) === k);
    if (c.calTag) meta += " \u00B7 cal tag " + esc(c.calTag);
    const lastTag = !lr ? "" : (lr.status === "DONE" && lr.overall === "PASS") ? ' <span class="cap-tag" style="background:#e5f6ea;color:#0a7d28;">last: PASS</span>'
      : ' <span class="cap-tag" style="background:#fdeaea;color:#c0392b;">last: ' + (lr.status !== "DONE" ? "ERR" : esc(lr.overall || "N/A")) + '</span>';
    d.innerHTML = '<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;"><input type="checkbox" class="bsel" data-k="' + esc(k) + '"' + (isSel(k) ? " checked" : "") + ' aria-label="Check this program">'
      + '<div style="flex:1;min-width:0;"><b>' + (i + 1) + ". " + esc(c.progId) + "</b>" + tag + lastTag
      + "<div class=\"meta\">" + meta + "</div></div></label>";
    list.appendChild(d);
  });
  updateBatchUi();
  updateTagsNote();
  saveState();
}
function selectedCases() { return batchCases.filter(c => isSel(caseKey(c))); }
function failedKeys() { return lastSummary.filter(r => r.status !== "DONE" || r.overall === "FAIL").map(caseKey); }
function updateBatchUi() {
  const n = batchCases.length, k = selectedCases().length, fk = failedKeys().filter(x => batchCases.some(c => caseKey(c) === x));
  $("selCount").textContent = k + " of " + n + " selected";
  const all = $("selAll"); all.checked = k === n; all.indeterminate = k > 0 && k < n;
  $("runBatch").textContent = k === n ? "CHECK ALL (" + n + ")" : "CHECK SELECTED (" + k + ")";
  const sf = $("selFailed"); sf.classList.toggle("hide", !fk.length); sf.textContent = "Select failed (" + fk.length + ")";
}
function esc(s) { return (s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }
function jiraMsgSnap() { const m = $("jiraMsg"); return m.classList.contains("hide") ? null : { cls: m.className, text: m.textContent }; }
function sessionHasData() { return batchCases.length > 0 || CLEARABLE.some(f => $(f).value.trim()); }
function saveState() {
  const data = {}; FIELDS.forEach(f => data[f] = $(f).value);
  chrome.storage.local.set({ form: data, session: { v: 1, savedAt: Date.now(), step: baseStep, ticket: sessionTicket, batch: batchCases, sel: batchSel ? Array.from(batchSel) : null, btags: $("batchTags").value, last: lastSummary.map(r => { const c = Object.assign({}, r); delete c.imageDataUrl; return c; }), extras: singleExtras, jmsg: jiraMsgSnap() } });
}
function loadState() {
  return chrome.storage.local.get(["form", "session"]).then(({ form, session }) => {
    form = form || {};
    FIELDS.forEach(f => { $(f).value = form[f] || ""; });
    if (!$("url").value) $("url").value = DEFAULT_URL;
    const fresh = session && session.v === 1 && (Date.now() - session.savedAt) < SESSION_TTL;
    if (session && !fresh) {                      // expired: drop the old ticket's values and list
      CLEARABLE.forEach(f => { $(f).value = ""; });
      chrome.storage.local.remove("session");
    }
    if (fresh) {
      restoredSession = session; sessionTicket = session.ticket || "";
      singleExtras = session.extras || {};
      if (session.jmsg) { const m = $("jiraMsg"); m.className = session.jmsg.cls; m.textContent = session.jmsg.text; m.classList.remove("hide"); }
      batchSel = session.sel ? new Set(session.sel) : null; lastSummary = session.last || []; $("batchTags").value = session.btags || "";
      if (session.batch && session.batch.length > 1) enterBatchMode(session.batch, true);
      const t = new Date(session.savedAt), hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
      const n = $("sessNote"); n.textContent = "Restored your last session" + (sessionTicket ? " (" + sessionTicket + ", saved " + hh + ")" : " (saved " + hh + ")") + ". Use Reset to start over."; n.classList.remove("hide");
    }
  });
}

// clear all comparison/nav fields (keep URL; jiraLink optional)
const CLEARABLE = ["calId", "progId", "flag", "event", "tags", "date", "time", "pre", "dur", "post"];
function clearData(alsoJiraLink) {
  CLEARABLE.forEach(f => { $(f).value = ""; });
  singleExtras = {};
  if (alsoJiraLink) $("jiraLink").value = "";
  $("formErr").classList.add("hide");
  saveState();
}

// ---------- steps ----------
$("toForm").onclick = () => { const u = $("url").value.trim(); if (!u) { $("url").focus(); return; } saveState(); show("form"); $("jiraLink").focus(); };
$("backUrl").onclick = () => show("url");
$("clearData").onclick = () => { clearRun(); clearData(true); const m = $("jiraMsg"); m.className = "jmsg info"; m.classList.remove("hide"); m.textContent = "Cleared (URL kept)."; saveState(); $("calId").focus(); };

// =================== JIRA AUTO-FILL ===================
function extractIssueKey(link) {
  const m = (link || "").match(/([A-Z][A-Z0-9]+-\d+)/);
  return m ? m[1] : "";
}
// ---- unified multi/single ticket parser: returns { cases:[...], warnings:[] } ----
// A ticket may write 03/11/2026 meaning 3 November (day first). When the text carries a weekday
// ("Tuesday, 03/11/2026") the weekday decides: if it only fits day/month, the date is swapped to
// month/day (11/3/2026, what KM shows). 25/11/2026 (first number > 12) can only be day/month.
const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
function slashDate(s) {
  s = String(s || "");
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return "";
  const a = +m[1], b = +m[2], yr = +m[3] < 100 ? 2000 + +m[3] : +m[3], swapped = +m[2] + "/" + +m[1] + "/" + m[3];
  if (a > 12 && b <= 12) return swapped;
  if (a <= 12 && b <= 12 && a !== b) {
    const wm = s.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thurs|thur|sun|mon|tue|wed|thu|fri|sat)\b/i);
    if (wm) {
      const wd = WEEKDAYS[wm[1].toLowerCase()];
      const mdy = new Date(Date.UTC(yr, a - 1, b)).getUTCDay(), dmy = new Date(Date.UTC(yr, b - 1, a)).getUTCDay();
      if (mdy !== wd && dmy === wd) return swapped;
    }
  }
  return m[0];
}
function firstDate(s) { return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s || "") ? slashDate(s) : (s || "").trim(); }
// Split a raw Tags-cell string into clean tokens.
// Jira sometimes stores two ids glued with NO separator, e.g.
//   "ev.fund.cb26.short.unittag.fund.cb26.short.unit"
// A plain comma/space split keeps that as one token → misclassified as Event,
// and the real tag.* is lost. Here we also break BEFORE any inner ev./tag.
// prefix and flag the token so the user re-checks (we never split silently).
function splitTagTokens(raw) {
  const rough = (raw || "").split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
  const tokens = [], glued = [];
  rough.forEach(tok => {
    // Split a GLUED token (two ids stuck together, e.g. "ev.Atag.B") but NOT a
    // single dotted id that merely contains ".ev."/".tag." (e.g. "coc.v5.ev.kvk"):
    // only break before ev./tag. when the preceding char is not a dot.
    const parts = tok.split(/(?<=[^.])(?=(?:ev|tag)\.)/i)
      .map(p => p.replace(/\.+$/, "").trim())
      .filter(Boolean);
    if (parts.length > 1) glued.push(tok);
    parts.forEach(p => tokens.push(p));
  });
  return { tokens, glued };
}
function classifyTags(raw) {
  const { tokens, glued } = splitTagTokens(raw);
  const uq = (a) => a.filter((v, i) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  return { ev: uq(tokens.filter(t => /^ev\./i.test(t))), tag: uq(tokens.filter(t => /^tag\./i.test(t))), glued };
}
function adfTables(doc) {
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
function parseTicket(doc) {
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

// ===== v2.7 unified parser: read by COLUMN LABEL, not position =====
// Handles: Program Name in any table; N programs stacked in one cell OR one
// per row; column order/set changing between tickets. Emits a warning when the
// layout differs from the standard template (but still auto-reads).
const KNOWN_COLS = ["id", "program name", "program id", "kind", "subkind", "tags", "content", "calendar type",
  "start date", "time of day", "repeat every", "repeat count",
  "pre-duration", "duration", "post-duration", "level range", "flag",
  "calendar id", "start time", "start date/time", "when", "shard tag", "shard tags", "program", "date", "time"];
// header aliases: different ticket types name the same field differently
function normCol(raw) {
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
function timeOf(s) { const m = (s || "").match(/\d{1,2}:\d{2}(:\d{2})?\s*UTC/i); return m ? m[0].trim() : ""; }
// Month lookup + date matchers (module-level so parseOffer can reuse them)
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const RE_SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const RE_DMY = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?/; // 25[th] September [2026]
const RE_MDY = /\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/; // September 25[, 2026]
function monNum(w) { w = (w || "").toLowerCase(); return MON[w.slice(0, 4)] || MON[w.slice(0, 3)] || 0; }
// Normalize any date to KM Design's M/D order (no leading zeros). Year kept when
// present, dropped when the ticket omits it ("25 Sept" -> "9/25", "9/25" is a
// substring of KM's "9/25/2026" so the contains-match still passes).
// ===== values labelled by shard keyword =====
// A schedule cell can hold several blocks, each followed by a label such as
// "(Fshards,Eshards,Dshards)". The calendar id says which shard letters a calendar belongs to
// (cal.kvk.nov26.f001.e003 -> F and E), so the right block is picked automatically.
function shardLetters(calId) {
  const out = [];
  String(calId || "").toLowerCase().split(".").forEach(t => { if (/^[a-z]\d{3}$/.test(t) && out.indexOf(t[0]) < 0) out.push(t[0]); });
  return out;
}
function shardKeys(txt) {
  const out = [], re = /\b([a-z])[\s-]?shards?\b/ig; let m;
  while ((m = re.exec(String(txt || "")))) { const k = m[1].toLowerCase(); if (out.indexOf(k) < 0) out.push(k); }
  return out;
}
function blocksOf(lines) {
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
function pickShard(lines, letters) {
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
function normDate(s) {
  s = (s || "").trim(); let m;
  if ((m = s.match(RE_SLASH))) { const mm = slashDate(s).match(RE_SLASH); return mm[1] + "/" + mm[2] + "/" + mm[3]; }
  if ((m = s.match(RE_DMY)) && monNum(m[2])) return monNum(m[2]) + "/" + parseInt(m[1], 10) + (m[3] ? "/" + m[3] : "");
  if ((m = s.match(RE_MDY)) && monNum(m[1])) return monNum(m[1]) + "/" + parseInt(m[2], 10) + (m[3] ? "/" + m[3] : "");
  return s;
}
function extractDate(line) {
  for (const re of [RE_SLASH, RE_DMY, RE_MDY]) {
    const m = (line || "").match(re);
    if (m) { const d = normDate(m[0]); if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(d)) return d; }
  }
  return "";
}
// Jira date lozenge stores an epoch-ms timestamp (UTC midnight of the date).
function fmtEpoch(ts) { const n = Number(ts); if (!n) return ""; const d = new Date(n); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear(); }
function adfPlainText(node) { let s = ""; (function w(n) { if (!n) return; if (n.type === "text") s += " " + n.text; else if (n.type === "date" && n.attrs) s += " " + fmtEpoch(n.attrs.timestamp); else if (n.type === "status" && n.attrs) s += " " + (n.attrs.text || ""); (n.content || []).forEach(w); })(node); return s; }

function allTableRows(doc) {
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
function rowKnownLabels(row) { return row.map(c => c.text.toLowerCase()).filter(t => KNOWN_COLS.indexOf(t) >= 0); }
function isHeaderRow(row) { return rowKnownLabels(row).length >= 2; }
// Pre/Dur/Post: only a real duration (digits + d/h/m, e.g. "4d", "23h 59m") counts;
// blanks, "-", "N/A", "TBD"... mean "no value".
function durVal(v) { v = (v || "").trim(); return /\d+\s*[dhm]/i.test(v) ? v : ""; }
function dash(v) { v = (v || "").trim(); return (v === "-" || v === "\u2013" || v === "\u2014") ? "" : v; }
function progKey(name) {
  let k = (name || "").toLowerCase().trim();
  k = k.replace(/^\d+\./, "");            // "0.meta" -> "meta"
  k = k.replace(/^day\s*(\d+)$/, "d$1");  // "day1"  -> "d1"
  return k;
}

// Picks the reader(s) by scanning the WHOLE ticket instead of a single label:
//  - schedule sentences with "program id:/prototype id:", or an offer/LTO title,
//    or a Store Window row -> sentence (Offer) reader
//  - a program table (Program Name/ID column with values) -> table reader
//  - both -> both, merged (deduped by calendar + program)
function parseTicketV2(doc, opts) {
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

function parseTicketTable(doc, opts, rows) {
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

// ===== v2.9 Offer / Store Window parser =====
// Label|value ticket where each program's date/duration/id is embedded as text:
//   "18 Aug 2025, duration 8d, prototype id: shop.valor"            (1 line)
//   "17 Sept 2026, duration 3d 23h 59m, program id: shop.gold.wk1"  (N lines)
//   Start Date="21 Sept 2026" / "Duration: 22d" / "Program ID: store.2.unlock" (split)
// Offer shops have no ev./tag. (store.* are offer items -> out of scope); Package
// Tags exist on KM Design but aren't given per-program in the ticket -> left blank.
const DUR_RE = /duration:?\s*([0-9]+d(?:\s*[0-9]+h)?(?:\s*[0-9]+m)?|[0-9]+h(?:\s*[0-9]+m)?|[0-9]+m)/i;
const PID_RE = /(?:program|prototype)\s*id:\s*([a-z0-9._-]+)/ig;

function parseOffer(rows, doc) {
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

// ===== v3/v4 boss-spawn: "County Config (if Applicable)" table =====
// The table has version columns (v3 / v4) and label rows: "ID", "County Config
// (if Applicable)", "Shard Tag". Returns [{ver, coc, progId, shard}] per version col.
function parseCountyConfig(doc) {
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

// Flatten all 2+ column table rows into a { label(lowercased) : value } map.
function labelValueScan(doc) {
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
function parseGlobal(lvMap, docText) {
  let g = lvMap["global"] || lvMap["global event"] || "";
  if (!g) { const m = (docText || "").match(/global(?:\s*event)?\s*[:\-]?\s*(yes|no)\b/i); if (m) g = m[1]; }
  g = (g || "").toLowerCase();
  if (g.indexOf("yes") >= 0) return "yes";
  if (g.indexOf("no") >= 0) return "no";
  return "";
}
// Repeat: parses both "repeat every X day(s), N occurrences" and "repeat daily for
// N days". Returns { repeatEvery, endsAfter } or null when there's no repeat data.
function parseRepeat(text) {
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
function parsePerRowExtras(doc) {
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

// ---- ADF parser (Jira stores the real data as ADF JSON, not rendered HTML) ----
function adfInlineText(node) {
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
function adfCellLines(cell) {
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
function parseAdf(doc) {
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
function parseTicketHtml(html) {
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

async function readJira() {
  const link = $("jiraLink").value.trim();
  const key = extractIssueKey(link);
  const msg = $("jiraMsg");
  msg.className = "jmsg info"; msg.classList.remove("hide"); msg.textContent = "Reading ticket\u2026";
  if (!key) { msg.className = "jmsg err"; msg.textContent = "Invalid Jira link (expected .../browse/KM-xxxxx)."; return; }
  let base; try { base = new URL(link).origin; } catch (e) { msg.className = "jmsg err"; msg.textContent = "Invalid Jira link."; return; }
  if (sessionTicket && sessionTicket !== key && sessionHasData()) {
    if (!confirm("Start a new session for " + key + "?\nThis clears the saved list and values from " + sessionTicket + ".")) {
      msg.className = "jmsg info"; msg.textContent = "Cancelled \u2014 kept your saved session for " + sessionTicket + "."; return;
    }
    clearData(false); enterSingleMode();
  }
  sessionTicket = key;

  $("jiraRead").disabled = true;
  try {
    const url = base + "/rest/api/3/issue/" + key + "?fields=description,summary&expand=renderedFields";
    const resp = await fetch(url, { credentials: "include", headers: { "Accept": "application/json" } });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("Not signed in to Jira or no access (HTTP " + resp.status + "). Open Jira, sign in, then retry.");
      throw new Error("HTTP " + resp.status);
    }
    const data = await resp.json();
    let parsed = null;
    // Primary: ADF JSON (fields.description) — Jira does NOT render tables to HTML
    if (data.fields && data.fields.description) {
      try { parsed = parseTicketV2(data.fields.description, { mission: /mission/i.test((data.fields && data.fields.summary) || ""), title: (data.fields && data.fields.summary) || "" }); } catch (e) { parsed = null; }
      if (!parsed || !parsed.cases || !parsed.cases.length) parsed = parseTicket(data.fields.description);
    }
    // Fallback: rendered HTML (single-layout only)
    if (!parsed || !parsed.cases || !parsed.cases.length) {
      const html = (data.renderedFields && data.renderedFields.description) ? data.renderedFields.description : "";
      if (html) { const g = parseTicketHtml(html); if (Object.values(g).some(Boolean)) parsed = { cases: [g], warnings: [] }; }
    }
    if (!parsed || !parsed.cases || !parsed.cases.length) throw new Error("Ticket read, but no program could be mapped. Send the ticket layout so it can be supported.");

    // ===== v3/v4 boss-spawn: County Config (if Applicable) table =====
    if (data.fields && data.fields.description) {
      try {
        const boss = parseCountyConfig(data.fields.description);
        if (boss.length) {
          const main = parsed.cases[0]; // inherit schedule/flag/cal from the main program
          boss.forEach(b => {
            parsed.cases.push({
              boss: true, ver: b.ver, coc: b.coc,
              calId: main.calId, progId: b.progId || b.coc, prefix: main.progId,
              mainEvent: (main.event || "").split(",")[0].trim(),
              flag: main.flag || "", date: main.date || "", time: main.time || "", dur: main.dur || "",
              shard: b.shard || (b.ver === "v3" ? "events-v3nux-spawn" : "events-v4-spawn"),
              event: "", tags: "", pre: "", post: ""
            });
          });
          parsed.warnings = (parsed.warnings || []).concat(
            "Boss-spawn: added " + boss.map(b => b.ver).join("/") + " (checks: config-id placement, Shard Tag, Date, Time, Duration; row picked by program name; KM Flag recorded but not scored). Shard Tag default used when the ticket omits it."
          );
        }
      } catch (e) { /* non-fatal */ }
    }

    // ===== Global + Repeat: bind PER PROGRAM (row), not doc-wide =====
    if (data.fields && data.fields.description) {
      try {
        const desc = data.fields.description;
        const perRow = parsePerRowExtras(desc);
        const docText = adfPlainText(desc);
        const dataFlag = (docText.match(/data\s*flag:?\s*([a-z0-9._-]+)/i) || [])[1] || "";
        const applied = [];
        parsed.cases.forEach(c => {
          if (c.boss) return;
          const ex = perRow[c.progId];
          if (ex) {
            if (ex.global) c.global = ex.global;
            if (ex.repeatEvery != null) { c.repeatEvery = ex.repeatEvery; c.endsAfter = ex.endsAfter; }
            if (ex.dur) c.dur = ex.dur; // strip the repeat clause out of Duration
            if (ex.global === "yes" || ex.repeatEvery != null) applied.push(c.progId + (ex.global === "yes" ? " [Global]" : "") + (ex.repeatEvery != null ? " [Repeat]" : ""));
          }
          if (dataFlag && !c.flag) c.flagNote = "Data Flag (ticket) = " + dataFlag + " \u2014 Flag not auto-checked for this ticket type; verify manually (some programs may use a different flag).";
        });
        if (applied.length) parsed.warnings = (parsed.warnings || []).concat("Per-row extra checks applied to: " + applied.join(", ") + ".");
      } catch (e) { /* non-fatal */ }
    }

    const cases = parsed.cases;

    if (cases.length > 1) {
      // ===== BATCH mode =====
      enterBatchMode(cases);
      const warn = (parsed.warnings && parsed.warnings.length) ? " ⚠ " + parsed.warnings.join(" ") : "";
      msg.className = warn ? "jmsg err" : "jmsg ok";
      msg.textContent = "\u2705 Read " + cases.length + " programs. Review the list, then click CHECK ALL." + warn;
      return;
    }

    // ===== SINGLE mode =====
    enterSingleMode();
    const got = cases[0];
    clearData(false);
    const map = { calId: "calId", progId: "progId", tags: "tags", flag: "flag", event: "event", date: "date", time: "time", pre: "pre", dur: "dur", post: "post" };
    const filled = [];
    Object.keys(map).forEach(k => { if (got[k]) { $(map[k]).value = got[k]; filled.push(k); } });
    saveState();
    singleExtras = { glued: got._glued || [], global: got.global || "", repeatEvery: got.repeatEvery, endsAfter: got.endsAfter, flagNote: got.flagNote || "", cocIds: got.cocIds || "", calIds: got.calIds || "", unknownContent: got.unknownContent || "", shard: got.shard || "", noteKmTags: !!got.noteKmTags, shardTokens: got.shardTokens || "" };

    if (filled.length) {
      let extra = "";
      const proto = got._evProto || [], evtags = got._evTags || [];
      if (proto.length && evtags.length) {
        const es = evtags.map(x => x.toLowerCase()), ps = proto.map(x => x.toLowerCase());
        const missInTags = proto.filter(x => es.indexOf(x.toLowerCase()) < 0);
        const missInProto = evtags.filter(x => ps.indexOf(x.toLowerCase()) < 0);
        if (missInTags.length || missInProto.length) extra = " \u26A0 Mismatch in ticket: Prototype [" + proto.join(", ") + "] vs Tags [" + evtags.join(", ") + "].";
      }
      const glued = got._glued || [];
      if (glued.length) extra += " \u26A0 Glued tags auto-split: " + glued.join(" | ") + " -- re-check Event IDs / Package Tags.";
      msg.className = extra ? "jmsg err" : "jmsg ok";
      msg.textContent = "\u2705 Auto-filled: " + filled.join(", ") + "." + extra + " Review, then click CHECK.";
    }
    else { msg.className = "jmsg err"; msg.textContent = "Ticket read, but no field could be mapped. Enter values manually and send the layout to support it."; }
  } catch (e) {
    msg.className = "jmsg err"; msg.textContent = "Couldn't read: " + (e.message || e) + " -- you can still enter values manually.";
  } finally {
    $("jiraRead").disabled = false;
    saveState();
  }
}
$("jiraRead").onclick = readJira;

// =================== RUN CHECK ===================
$("doCheck").onclick = async () => {
  const payload = {
    url: $("url").value.trim(),
    calId: $("calId").value.trim(),
    progId: $("progId").value.trim(),
    flag: $("flag").value.trim(),
    event: $("event").value.trim(),
    tags: $("tags").value.trim(),
    date: $("date").value.trim(),
    time: $("time").value.trim(),
    pre: $("pre").value.trim(),
    dur: $("dur").value.trim(),
    post: $("post").value.trim(),
    global: singleExtras.global || "",
    repeatEvery: singleExtras.repeatEvery,
    endsAfter: singleExtras.endsAfter,
    flagNote: singleExtras.flagNote || "",
    cocIds: singleExtras.cocIds || "",
    calIds: singleExtras.calIds || "",
    unknownContent: singleExtras.unknownContent || "",
    shard: singleExtras.shard || "",
    noteKmTags: !!singleExtras.noteKmTags,
    _glued: singleExtras.glued || [],
    shardTokens: singleExtras.shardTokens || "",
    ticket: ticketKey()
  };
  $("formErr").classList.add("hide");
  if (!payload.calId || !payload.progId) {
    $("formErr").textContent = "\u26A0 Calendar ID and Program ID are required."; $("formErr").classList.remove("hide"); return;
  }
  saveState();

  // decide save target while we still have the click gesture (needed for permission)
  let saveMode = "downloads", permNote = "";
  if (dirHandle) {
    const ok = await ensureDirPermission();
    if (ok) saveMode = "folder";
    else permNote = "No write permission for the chosen folder -- saved to Downloads/CalCheck.";
  }
  payload.saveMode = saveMode;

  $("doCheck").disabled = true; $("backUrl").disabled = true; $("jiraRead").disabled = true;
  $("running").classList.remove("hide");
  let res;
  try { res = await chrome.runtime.sendMessage({ action: "runCheck", payload }); }
  catch (e) { res = { status: "ERROR", message: "Lost connection to the tool: " + (e.message || e) }; }

  // if folder mode, write the returned image into the chosen folder
  if (res && res.status === "DONE" && saveMode === "folder" && res.imageDataUrl) {
    try {
      const nm = await writeToDir(dirHandle, (payload.progId || "calcheck") + ".png", res.imageDataUrl);
      res.savedAs = nm + "  ->  " + dirHandle.name + " (chosen folder)";
      res.shotErr = "";
    } catch (e) {
      res.savedAs = ""; res.shotErr = "Folder write failed: " + (e.message || e) + " -- try re-selecting the folder.";
    }
  }
  if (permNote && res && res.status === "DONE" && !res.shotErr) res.savedAs = (res.savedAs || "") + "  (" + permNote + ")";

  $("doCheck").disabled = false; $("backUrl").disabled = false; $("jiraRead").disabled = false;
  $("running").classList.add("hide");
  renderResult(res);
};

function renderResult(res) {
  if (!res) res = { status: "ERROR", message: "No response." };
  if (res.status !== "DONE") {
    $("formErr").textContent = res.message || (res.step ? ("Error at step " + res.step) : "An error occurred.");
    $("formErr").classList.remove("hide"); return;
  }
  const v = $("verdict"), overall = res.overall;
  v.className = "verdict " + (overall === "PASS" ? "v-pass" : overall === "FAIL" ? "v-fail" : "v-na");
  v.textContent = overall === "N/A" ? "N/A \u2014 screenshot only (no compare values entered)" : ("RESULT: " + overall + "  (" + res.passCount + " match, " + res.failCount + " fail)");

  const linesEl = $("lines");
  if (res.anyChecked && res.resultLines && res.resultLines.length) {
    linesEl.innerHTML = "";
    res.resultLines.forEach(l => { const d = document.createElement("div"); d.className = "ln " + (l.pass === false ? "no" : l.pass === true ? "ok" : ""); if (l.bold) d.style.fontWeight = "700"; d.textContent = l.line; linesEl.appendChild(d); });
    linesEl.classList.remove("hide");
  } else linesEl.classList.add("hide");

  const act = $("actual"); act.textContent = (res.actualLines || []).join("\n");
  act.classList.toggle("hide", !(res.actualLines && res.actualLines.length));

  const saved = $("saved");
  if (res.savedAs) { saved.className = "saved ok"; saved.textContent = "\u2705 Screenshot saved: " + res.savedAs + (res.savedFallback ? "  (folder not writable \u2014 saved to Downloads instead)" : ""); }
  else { saved.className = "saved err"; saved.textContent = "\u26A0 " + (res.shotErr || "Screenshot not saved."); }
  lastLogText = res.logText || "";
  if (res.logSaved) saved.textContent += "  \u26A0 Fails / capture issues \u2014 log saved: " + res.logSaved;
  show("result");
}

$("again").onclick = () => { clearRun(); show("form"); $("jiraLink").focus(); };
$("stop").onclick = async () => { clearRun(); try { await chrome.runtime.sendMessage({ action: "closeWorkTab" }); } catch (e) {} window.close(); };

FIELDS.forEach(f => $(f).addEventListener("input", saveState));
loadDir();

// ================= BATCH run =================
$("clearBatch").onclick = () => { clearRun(); enterSingleMode(); const m = $("jiraMsg"); m.className = "jmsg info"; m.classList.remove("hide"); m.textContent = "Batch list cleared."; saveState(); };
$("backUrlB").onclick = () => show("url");
$("batchStop").onclick = async () => { clearRun(); try { await chrome.runtime.sendMessage({ action: "closeWorkTab" }); } catch (e) {} window.close(); };
$("batchAgain").onclick = () => { clearRun(); show("form"); enterBatchMode(batchCases, true); };

// live progress + incremental folder-save
let batchFolderMode = false;
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "batchProgress") return;
  if (msg.phase === "running") {
    $("batchProg").textContent = "Running " + msg.i + "/" + msg.n + ": " + msg.progId + " \u2026" + (msg.note ? " (" + msg.note + ")" : "");
    const bar = $("batchBar"); if (bar) bar.style.width = Math.round(((msg.i - 1) / msg.n) * 100) + "%";
  } else if (msg.phase === "done") {
    $("batchProg").textContent = "Done " + msg.i + "/" + msg.n + ": " + msg.progId;
    const bar = $("batchBar"); if (bar) bar.style.width = Math.round((msg.i / msg.n) * 100) + "%";
    // folder mode: write this case's image immediately
    if (batchFolderMode && dirHandle && msg.row && msg.row.imageDataUrl) {
      writeToDir(dirHandle, ((msg.row.shotName || msg.row.progId) || "case") + ".png", msg.row.imageDataUrl)
        .then(nm => { msg.row.savedAs = nm; }).catch(() => {});
    }
  }
});

function withManualTags(list) {
  const man = manualTagList(); if (!man.length) return list;
  return list.map(c => {
    if (c.calCheck || c.boss) return c;
    const have = String(c.tags || "").split(/[,\s]+/).filter(Boolean), all = have.slice();
    man.forEach(t => { if (!all.some(x => x.toLowerCase() === t.toLowerCase())) all.push(t); });
    return Object.assign({}, c, { tags: all.join(", "), manualTags: man.slice(), noteKmTags: false });
  });
}
async function runSelected(restoreSel) {
  if (!batchCases.length) return;
  const toRun = selectedCases();
  if (!toRun.length) { $("batchErr").textContent = "Tick at least one program to check."; $("batchErr").classList.remove("hide"); return; }
  if (typeof restoreSel === "function") { restoreSel(); updateBatchUi(); saveState(); }   // a one-shot run (re-check failed) must not change your ticks
  const url = $("url").value.trim() || DEFAULT_URL;
  $("batchErr").classList.add("hide");

  // save target within the click gesture (for folder permission)
  let saveMode = "downloads";
  batchFolderMode = false;
  if (dirHandle) {
    const ok = await ensureDirPermission();
    if (ok) { saveMode = "folder"; batchFolderMode = true; }
  }

  $("runBatch").disabled = true; $("clearBatch").disabled = true; $("backUrlB").disabled = true;
  $("batchRunning").classList.remove("hide");
  $("batchProg").textContent = "Starting\u2026";
  { const bar = $("batchBar"); if (bar) bar.style.width = "0%"; }

  let res;
  try { res = await chrome.runtime.sendMessage({ action: "runBatch", payload: { url, saveMode, ticket: ticketKey(), cases: withManualTags(toRun) } }); }
  catch (e) { res = { status: "ERROR", message: "Lost connection to the tool: " + (e.message || e) }; }

  $("runBatch").disabled = false; $("clearBatch").disabled = false; $("backUrlB").disabled = false;
  $("batchRunning").classList.add("hide");

  if (!res || res.status !== "BATCH_DONE") {
    $("batchErr").textContent = (res && res.message) ? res.message : "Batch error.";
    $("batchErr").classList.remove("hide");
    return;
  }
  showBatchResult(res, saveMode);
}
$("runBatch").onclick = () => runSelected();

function showBatchResult(res, saveMode) {
  const rows = (res.summary || []).map(r => { const c = Object.assign({}, r); delete c.imageDataUrl; return c; });
  const ran = new Set(rows.map(caseKey));
  const order = {}; batchCases.forEach((c, i) => { order[caseKey(c)] = i; });
  lastSummary = lastSummary.filter(r => !ran.has(caseKey(r))).concat(rows).sort((a, b) => (order[caseKey(a)] === undefined ? 999 : order[caseKey(a)]) - (order[caseKey(b)] === undefined ? 999 : order[caseKey(b)]));
  const m = lastSummary;
  const merged = Object.assign({}, res, {
    summary: m, ranKeys: Array.from(ran), ranNow: rows.length,
    total: batchCases.length || m.length,
    pass: m.filter(r => r.status === "DONE" && r.overall === "PASS").length,
    fail: m.filter(r => r.status === "DONE" && r.overall === "FAIL").length,
    err: m.filter(r => r.status !== "DONE").length,
    notChecked: Math.max(0, (batchCases.length || m.length) - m.length)
  });
  renderBatch(merged, saveMode);
  saveState();
}
function renderBatch(res, saveMode) {
  const v = $("batchVerdict");
  const allPass = res.fail === 0 && res.err === 0;
  v.className = "verdict " + (allPass ? "v-pass" : "v-fail");
  v.textContent = "BATCH: " + res.pass + " PASS \u00B7 " + res.fail + " FAIL" + (res.err ? " \u00B7 " + res.err + " err" : "") + "  (total " + res.total + (res.notChecked ? ", " + res.notChecked + " not checked" : "") + ")";

  const box = $("batchSummary"); box.innerHTML = "";
  (res.summary || []).forEach(r => {
    const row = document.createElement("div");
    row.className = "bs-row";
    let badgeCls = "bs-na", badgeTxt = r.overall || "N/A";
    if (r.status !== "DONE") { badgeCls = "bs-err"; badgeTxt = "ERR"; }
    else if (r.overall === "PASS") badgeCls = "bs-pass";
    else if (r.overall === "FAIL") badgeCls = "bs-fail";
    const cnt = r.status === "DONE" ? (r.passCount + "✓ " + r.failCount + "✗") : "";
    const detail = r.status !== "DONE" ? (r.message || "").split("\n")[0] : "";
    // why it failed: the failed check lines (max 4) right under the program
    const failLines = (r.status === "DONE" && r.overall === "FAIL") ? (r.resultLines || []).filter(l => l.pass === false) : [];
    const failHtml = failLines.slice(0, 4).map(l => "<div class=\"meta\" style=\"color:#c0392b\">" + esc(l.line) + "</div>").join("")
      + (failLines.length > 4 ? "<div class=\"meta\" style=\"color:#c0392b\">\u2026 +" + (failLines.length - 4) + " more (see screenshot / log)</div>" : "");
    const d = r.capDiag || {};
    let capTag = "";
    if (r.status === "DONE" && !r.savedAs && !r.imageDataUrl) capTag = " <span class=\"cap-tag cap-bad\">\u2716 no image</span>";
    else if (r.savedFallback) capTag = " <span class=\"cap-tag cap-warn\">\u2193 Downloads</span>";
    else if (d.method && d.method !== "debugger") capTag = " <span class=\"cap-tag cap-warn\">\u26A0 fallback</span>";
    else if ((d.tries || 0) > 1) capTag = " <span class=\"cap-tag cap-info\">\u27F3 retried</span>";
    const older = res.ranKeys && res.ranNow < (res.summary || []).length && res.ranKeys.indexOf(caseKey(r)) < 0 ? ' <span class="cap-tag" style="background:#eef0f6;color:#555;">earlier run</span>' : "";
    row.innerHTML = "<span class=\"bs-badge " + badgeCls + "\">" + badgeTxt + "</span>"
      + "<span class=\"bs-name\"><b>" + esc(r.progId) + "</b>" + (r.calCheck ? " <span class=\"cap-tag cap-info\">CAL</span>" : "") + older + capTag + (detail ? "<div class=\"meta\">" + esc(detail) + "</div>" : "") + failHtml + "</span>"
      + "<span class=\"bs-cnt\">" + cnt + "</span>";
    box.appendChild(row);
  });

  const saved = $("batchSaved");
  if (saveMode === "folder") {
    saved.className = "saved ok";
    const fb = (res.summary || []).filter(r => r.savedFallback).length;
    saved.textContent = "\u2705 Per-program screenshots saved to folder: " + (dirHandle ? dirHandle.name : "")
      + (fb ? "  \u26A0 " + fb + " saved to Downloads/CalCheck instead (folder not writable)" : "");
  } else {
    saved.className = "saved ok";
    saved.textContent = "\u2705 Per-program screenshots saved to Downloads/CalCheck (named by Program).";
  }
  lastLogText = res.logText || "";
  if (res.logSaved) saved.textContent += "  \u26A0 Fails / capture issues \u2014 log saved: " + res.logSaved;
  const nf = (res.summary || []).filter(r => r.status !== "DONE" || r.overall === "FAIL").length;
  const rb = $("recheckFailed"); rb.classList.toggle("hide", !nf); rb.textContent = "Re-check failed (" + nf + ")";
  const bn = $("batchNote");
  bn.textContent = (res.ranNow && res.ranNow < (res.summary || []).length) ? "Re-checked now: " + res.ranNow + ". The other rows keep the result of their last check." : "";
  show("batch");
}

// ---- resume a background run after the popup was closed ----
function bgProgressText(pr) { return "Running " + (pr.i || 0) + "/" + (pr.n || "?") + (pr.progId ? ": " + pr.progId : "") + " \u2026" + (pr.note ? " (" + pr.note + ")" : ""); }
function resumeRunning(RUN) {
  show("form");
  if (RUN.mode === "batch") {
    $("singleFields").classList.add("hide");
    $("batchBox").classList.remove("hide");
    $("batchList").innerHTML = "<div class=\"batch-item\"><b>Running in the background\u2026</b><div class=\"meta\">You can switch windows or close this popup \u2014 reopen anytime to see progress/result.</div></div>";
    $("batchRunning").classList.remove("hide");
    if (RUN.progress) { $("batchProg").textContent = bgProgressText(RUN.progress); const bar = $("batchBar"); if (bar && RUN.progress.n) bar.style.width = Math.round(((RUN.progress.i || 0) / RUN.progress.n) * 100) + "%"; }
  } else {
    $("running").classList.remove("hide");
  }
  startPoll();
}
function resumeResult(RUN) {
  if (!RUN || !RUN.result) return;
  if (RUN.mode === "batch") { $("batchRunning").classList.add("hide"); if (RUN.result.status === "BATCH_DONE") showBatchResult(RUN.result, RUN.saveMode || "downloads"); }
  else { $("running").classList.add("hide"); renderResult(RUN.result); }
}
let _pollTimer = null;
function startPoll() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    let RUN; try { RUN = await chrome.runtime.sendMessage({ action: "getRunState" }); } catch (e) { return; }
    if (!RUN) return;
    if (RUN.active) {
      if (RUN.mode === "batch" && RUN.progress) { $("batchProg").textContent = bgProgressText(RUN.progress); const bar = $("batchBar"); if (bar && RUN.progress.n) bar.style.width = Math.round(((RUN.progress.i || 0) / RUN.progress.n) * 100) + "%"; }
    } else { clearInterval(_pollTimer); _pollTimer = null; resumeResult(RUN); }
  }, 1200);
}
function clearRun() { try { chrome.runtime.sendMessage({ action: "clearRunState" }); } catch (e) {} }

loadState().then(async () => {
  let restored = false;
  try {
    const RUN = await chrome.runtime.sendMessage({ action: "getRunState" });
    if (RUN && RUN.active) { resumeRunning(RUN); restored = true; }
    else if (RUN && RUN.result && (Date.now() - RUN.at) < 10 * 60 * 1000) { resumeResult(RUN); restored = true; }
  } catch (e) {}
  if (!restored) {
    if (restoredSession && restoredSession.step === "form") show("form");
    else { show("url"); $("url").focus(); }
  }
});

// ---- Copy log (last run) ----
async function copyLog(btn) {
  if (!lastLogText) { btn.textContent = "No log"; setTimeout(() => { btn.textContent = "\uD83D\uDCCB Copy log"; }, 1200); return; }
  try { await navigator.clipboard.writeText(lastLogText); btn.textContent = "\u2705 Copied"; }
  catch (e) { btn.textContent = "Copy failed"; }
  setTimeout(() => { btn.textContent = "\uD83D\uDCCB Copy log"; }, 1500);
}
if ($("copyLog")) $("copyLog").onclick = () => copyLog($("copyLog"));
if ($("copyLogS")) $("copyLogS").onclick = () => copyLog($("copyLogS"));

// ---- session memory: save on every edit and when the popup closes; Reset ----
FIELDS.forEach(f => { const el = $(f); if (el) el.addEventListener("input", saveState); });
window.addEventListener("pagehide", saveState);
$("resetSession").onclick = async () => {
  if (!confirm("Reset the session?\nThis clears the saved link, values and ticket list.")) return;
  clearRun();
  FIELDS.forEach(f => { if (f !== "url") $(f).value = ""; });
  singleExtras = {}; batchCases = []; sessionTicket = ""; restoredSession = null; $("batchTags").value = "";
  enterSingleMode();
  const m = $("jiraMsg"); m.classList.add("hide"); m.textContent = "";
  $("sessNote").classList.add("hide");
  $("formErr").classList.add("hide");
  show("url"); saveState();
};

// ---- tick programs / re-check only the failed ones ----
$("batchList").addEventListener("change", e => {
  const el = e.target; if (!el.classList || !el.classList.contains("bsel")) return;
  const keys = batchCases.map(caseKey);
  const cur = batchSel === null ? new Set(keys) : new Set(batchSel);
  if (el.checked) cur.add(el.dataset.k); else cur.delete(el.dataset.k);
  batchSel = cur.size === keys.length ? null : cur;
  updateBatchUi(); saveState();
});
$("selAll").addEventListener("change", e => { batchSel = e.target.checked ? null : new Set(); enterBatchMode(batchCases, true); });
$("selFailed").addEventListener("click", () => { batchSel = new Set(failedKeys().filter(x => batchCases.some(c => caseKey(c) === x))); enterBatchMode(batchCases, true); });
$("recheckFailed").onclick = () => {
  const fk = failedKeys().filter(x => batchCases.some(c => caseKey(c) === x));
  if (!fk.length) return;
  const prevSel = batchSel;
  batchSel = new Set(fk); clearRun(); show("form"); enterBatchMode(batchCases, true);
  runSelected(() => { batchSel = prevSel; });
};

$("batchTags").addEventListener("input", () => { updateTagsNote(); saveState(); });
