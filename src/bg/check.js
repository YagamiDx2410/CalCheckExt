// One case end to end: navigate -> read KM -> compare -> capture -> save.
import { captureShot, dbgAttach, dbgStable, dbgTitle, debuggerShotCalendar, debuggerShotList } from "./capture.js";
import { inj_closeModal, inj_findRowsByContent, inj_readCalendarPage, inj_readListRow, inj_readModal } from "./injected.js";
import { exec, openCalendar, openProgram, sleep, waitTabComplete } from "./navigate.js";
import { composeReport } from "./report.js";
import { saveImage } from "./save.js";
import { CAP, capReset } from "./state.js";
import { adaptGlued, calendarChecks, cmpDuration, cmpDurField, cmpEndsAfter, cmpExact, cmpGlobal, cmpInField, cmpInFieldMulti, cmpRepeatEvery, cmpTagExact, cmpWhen, failLabels, failPrefix, flagRuleChecks, kvkProgramChecks, packageTagChecks, programHeader } from "../core/compare.js";
import { idMatch } from "../core/ids.js";
import { listUrlFor } from "../core/layout.js";
import { lc, norm } from "../core/text.js";

// "could not find" (calendar / program): FAIL + screenshot of the current page as evidence
async function notFoundResult(tabId, p, what, detail) {
  const ts = new Date().toLocaleString();
  const resultLines = [{ line: "\u274C FAILED \u2014 could not find " + what + ": " + detail + (what === "calendar" ? " (searched the calendars list by this id)" : ""), pass: false }];
  const actualLines = ["\u2500\u2500 ACTUAL \u2500\u2500", "Calendar: " + (p.calId || "") + "  |  Program: " + (p.progId || "")];
  capReset(); CAP.method = "debugger";
  let savedAs = "", shotErr = "", savedFallback = false;
  try {
    let page = "";
    if (await dbgAttach(tabId)) {
      const T = { tabId }; await dbgTitle(T); await dbgStable(T, 2000);
      const sh = await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png" });
      if (sh && sh.data) page = "data:image/png;base64," + sh.data;
    }
    if (page) {
      CAP.tries = 1; CAP.notes.push("not-found evidence: page screenshot");
      const composed = await composeReport(page, { overall: "FAIL", progId: p.progId, ts, resultLines, actualLines }, null);
      const sv = await saveImage(p, "FAILED - could not find - " + (p.calId ? p.calId + " - " : "") + (p.progId || ""), composed);
      savedAs = sv.savedAs; savedFallback = sv.fallback;
    } else { CAP.method = "none"; shotErr = "Screenshot failed (debugger unavailable)"; }
  } catch (e) { shotErr = "Screenshot failed: " + ((e && e.message) || e); }
  return { status: "DONE", overall: "FAIL", notFound: true, anyChecked: true, passCount: 0, failCount: 1, resultLines, actualLines, savedAs, savedFallback, shotErr, imageDataUrl: "", ts, calId: p.calId, progId: p.progId, capDiag: JSON.parse(JSON.stringify(CAP)) };
}

async function checkCalendarCase(tabId, p, navUrl) {
  try { await chrome.tabs.update(tabId, { url: listUrlFor(navUrl, p.calId), active: false }); } catch (e) {}
  await waitTabComplete(tabId, 25000);
  await sleep(600);
  const calRes = await openCalendar(tabId, p.calId, 20000);
  if (calRes === "NOT_FOUND") return await notFoundResult(tabId, p, "calendar", p.calId);
  if (calRes !== "OK") return { status: "FAIL_STEP", step: "Calendar", code: calRes, message: "\u274C Calendar: " + p.calId + "\nClicked calendar but page didn't switch to Programs.", calId: p.calId, progId: p.progId };
  await sleep(900);
  let info = null;
  for (let k = 0; k < 14; k++) {
    try { info = JSON.parse(await exec(tabId, inj_readCalendarPage, [p.evProgs || []])); } catch (e) { info = null; }
    if (info && info.flag && info.flag.v && info.progs && info.progs.length) break;
    await sleep(500);
  }
  if (!info || !info.progs) return { status: "FAIL_STEP", step: "Calendar", code: "NOREAD", message: "\u274C Calendar: " + p.calId + "\nCould not read the calendar page (header / programs).", calId: p.calId, progId: p.progId };
  const { checks, hl, union, wantProgs } = calendarChecks(p, info);
  const overall = checks.some(c => c.pass === false) ? "FAIL" : (checks.some(c => c.pass === true) ? "PASS" : "N/A");
  const passCount = checks.filter(c => c.pass === true).length, failCount = checks.filter(c => c.pass === false).length;
  const resultLines = checks.map(c => ({ line: c.line, pass: c.pass, bold: !!c.bold }));
  const ts = new Date().toLocaleString();
  const actualLines = ["\u2500\u2500 ACTUAL (calendar page) \u2500\u2500", "Flag: " + (info.flag.v || "") + "  |  Tag: " + (info.tag.v || "")]
    .concat(wantProgs.map(x => x.id + ": " + (x.events.join(", ") || "(no events)")));
  capReset();
  let savedAs = "", shotErr = "", savedFallback = false;
  try {
    const shot = await debuggerShotCalendar(tabId, p.evProgs || [], hl);
    if (shot.url) {
      const composed = await composeReport(shot.url, { overall, progId: p.calId + (p.bracket ? "  \u00B7  shard " + p.bracket : ""), ts, resultLines, actualLines }, shot.hl);
      const sv = await saveImage(p, failPrefix(overall, checks) + p.calId + " - calendar", composed);
      savedAs = sv.savedAs; savedFallback = sv.fallback;
    } else { CAP.method = "none"; shotErr = "Screenshot failed (" + (CAP.reason || "calendar page capture") + ")"; }
  } catch (e) { shotErr = "Screenshot failed: " + ((e && e.message) || e); }
  return { status: "DONE", overall, anyChecked: checks.some(c => c.pass !== null), passCount, failCount, resultLines, actual: { flag: info.flag.v, tag: info.tag.v }, actualLines, savedAs, savedFallback, shotErr, imageDataUrl: "", ts, calId: p.calId, progId: p.progId, capDiag: JSON.parse(JSON.stringify(CAP)) };
}

// ===== Boss-spawn (v3/v4): locate program(s) on KM by coc id, check placement + inherited schedule =====
// p carries: calId (main cal), coc, shard (expected), flag/date/time/dur (inherited from
// main program), progId (ticket v3/v4 id, used for the screenshot name), prefix (main id).
async function checkBossCase(tabId, p, navUrl) {
  // always start from a clean program list of the main calendar
  try { await chrome.tabs.update(tabId, { url: listUrlFor(navUrl, p.calId), active: false }); } catch (e) {}
  await waitTabComplete(tabId, 25000);
  await sleep(600);

  const calRes = await openCalendar(tabId, p.calId, 20000);
  if (calRes === "NOT_FOUND") return await notFoundResult(tabId, p, "calendar", p.calId);
  if (calRes !== "OK") {
    const why = calRes === "NOT_FOUND" ? "Calendar ID not found (waited 20s)." : "Clicked calendar but page didn't switch to Programs.";
    return { status: "FAIL_STEP", step: "Calendar", code: calRes, message: "\u274C Calendar: " + p.calId + "\n" + why, calId: p.calId, progId: p.progId };
  }
  await sleep(700);

  // find every program whose Content column holds the coc id
  let idsJson = "[]";
  for (let k = 0; k < 12; k++) {
    try { idsJson = await exec(tabId, inj_findRowsByContent, [p.coc]); } catch (e) { idsJson = "[]"; }
    if (idsJson && idsJson !== "[]") break;
    await sleep(400);
  }
  let ids = []; try { ids = JSON.parse(idsJson) || []; } catch (e) { ids = []; }
  if (!ids.length) {
    // coc not found in any Content cell -> try opening by the ticket program name directly
    const pr0 = await openProgram(tabId, p.progId, 8000);
    if (pr0 === "OK") { ids = [p.progId]; }
    else {
      return await notFoundResult(tabId, p, "program", "config id " + p.coc + " / name " + p.progId + " in calendar " + p.calId);
    }
  }

  const subs = [];
  for (const idText of ids) {
    const pr = await openProgram(tabId, idText, 20000);
    if (pr !== "OK") { subs.push({ idText, overall: "FAIL", checks: [{ line: "\u274C Program popup didn't open: " + idText, pass: false }], nameMatch: idMatch(idText, p.progId), actual: null }); continue; }

    let raw = "NOMODAL";
    for (let k = 0; k < 12; k++) {
      try { raw = await exec(tabId, inj_readModal); } catch (e) { raw = "NOMODAL"; }
      if (raw && raw !== "NOMODAL" && raw.split("\u00A7\u00A7")[0]) break;
      await sleep(300);
    }
    const f = (raw || "").split("\u00A7\u00A7");
    const actual = { id: f[0] || "", flag: f[1] || "", event: f[2] || "", tags: f[3] || "", when: f[4] || "", pre: f[5] || "", dur: f[6] || "", post: f[7] || "", ccid: f[8] || "", shard: f[9] || "" };

    // Flag is recorded (in actualLines) but NOT scored for boss-spawn.
    const checks = []; const push = (c) => { if (c) checks.push(c); };
    flagRuleChecks("", actual.flag).forEach(push);
    push(cmpInField("County Config ID", p.coc, "County Config IDs", actual.ccid, [{ name: "Event IDs", val: actual.event }, { name: "Package Tags", val: actual.tags }]));
    push(cmpExact("Shard Tag", norm(p.shard), actual.shard));
    cmpWhen(norm(p.date), norm(p.time), actual.when).forEach(push);
    push(cmpDuration("Duration", norm(p.dur), actual.dur));

    const overall = checks.some(c => c.pass === false) ? "FAIL" : "PASS";
    subs.push({ idText, overall, checks, actual, nameMatch: idMatch(idText, p.progId) });

    try { await exec(tabId, inj_closeModal); } catch (e) {}
    await sleep(400);
  }

  // "most correct" row = KM program ID that matches the ticket program name:
  // prefer an exact match, then a token-set match, else the first row.
  const exactNamed = subs.find(s => s.actual && lc(s.idText) === lc(p.progId));
  const named = exactNamed || subs.find(s => s.nameMatch);
  let best = named || subs[0];
  const overall = best.overall;
  const passCount = best.checks.filter(c => c.pass === true).length;
  const failCount = best.checks.filter(c => c.pass === false).length;

  // report lines: chosen row's checks + a header when several rows matched the coc
  const resultLines = [];
  if (subs.length > 1) {
    resultLines.push({ line: "Note: " + subs.length + " KM programs matched config id " + p.coc + "; verdict from name-matching row: " + best.idText + (named ? "" : " (no name match \u2014 used first; verify manually)"), pass: null });
    subs.forEach(s => { if (s !== best) resultLines.push({ line: "   \u00B7 other: " + s.idText + " [" + s.overall + "] flag(KM)=" + (s.actual ? s.actual.flag : "?"), pass: null }); });
  }
  best.checks.forEach(c => resultLines.push({ line: c.line, pass: c.pass }));

  const ts = new Date().toLocaleString();
  const a = best.actual || {};
  const actualLines = [
    "\u2500\u2500 ACTUAL DATA (KM: " + best.idText + ") \u2500\u2500",
    "Flag (KM, recorded \u2014 not scored): " + (a.flag || ""),
    "Shard Tag: " + (a.shard || ""),
    "County Config IDs: " + (a.ccid || ""),
    "Event IDs: " + (a.event || ""),
    "When: " + String(a.when || "").replace(/\n+/g, " / "),
    "Duration: " + (a.dur || "")
  ];

  // screenshot the chosen row (re-open it), named <mainPrefix>__<ticket v3/v4 id>
  let savedAs = "", shotErr = "", imageDataUrl = "", savedFallback = false;
  const shotName = ((p.prefix ? p.prefix + "__" : "") + (p.progId || best.idText)).replace(/[\/\\:*?"<>|]+/g, "_");
  try {
    await openProgram(tabId, best.idText, 20000);
    const dataUrl = await captureShot(tabId, { overall, progId: shotName, ts, resultLines, actualLines, highlight: failLabels(best.checks) });
    if (typeof dataUrl === "string" && dataUrl.indexOf("data:image/png") === 0) {
      const sv = await saveImage(p, failPrefix(overall, best.checks) + (p.mainEvent || p.calId || "boss") + " - " + (p.progId || best.idText), dataUrl);
      savedAs = sv.savedAs; savedFallback = sv.fallback;
    } else { shotErr = "Screenshot failed (" + dataUrl + ")"; }
    try { await exec(tabId, inj_closeModal); } catch (e) {}
  } catch (e) { shotErr = "Screenshot failed: " + (e.message || e); }

  return { status: "DONE", overall, anyChecked: true, passCount, failCount, resultLines, actual: a, actualLines, savedAs, savedFallback, shotErr, imageDataUrl, ts, calId: p.calId, progId: p.progId, shotName, capDiag: CAP ? JSON.parse(JSON.stringify(CAP)) : null };
}

// Check a single case in an already-open work tab. navFresh = reload calendars list first.
export async function checkOneCase(tabId, p, navUrl, navFresh) {
  if (p.boss) return checkBossCase(tabId, p, navUrl);
  if (p.calCheck) return checkCalendarCase(tabId, p, navUrl);
  if (navFresh || p.calTag) {
    try { await chrome.tabs.update(tabId, { url: listUrlFor(navUrl, p.calId), active: false }); } catch (e) {}
    await waitTabComplete(tabId, 25000);
    await sleep(600);
  }
  // Calendar Tag layout: read the Tag / Flag from the filtered calendars list and photograph it
  let listInfo = null, listShot = null, preNotes = [];
  if (p.calTag) {
    for (let k = 0; k < 24 && !listInfo; k++) { let r = null; try { r = JSON.parse(await exec(tabId, inj_readListRow, [p.calId])); } catch (e) {} if (r && r.found) listInfo = r; else await sleep(500); }
    if (listInfo) {
      capReset();
      const sh = await debuggerShotList(tabId, p.calId);
      if (sh.url) listShot = sh;
      preNotes = (CAP.notes || []).slice();
      if (!listShot) preNotes.push("calendar list picture failed (" + (CAP.reason || "unknown") + ") \u2014 the report has the popup picture only");
      else if (CAP.tries > 1) preNotes.push("calendar list picture needed " + CAP.tries + " tries");
    }
  }

  const calRes = await openCalendar(tabId, p.calId, 20000);
  if (calRes === "NOT_FOUND") return await notFoundResult(tabId, p, "calendar", p.calId);
  if (calRes !== "OK") {
    const why = calRes === "NOT_FOUND"
      ? "Calendar ID not found in the list (waited 20s). Check the ID / your access."
      : "Clicked calendar but page didn't switch to Programs (slow network?).";
    return { status: "FAIL_STEP", step: "Calendar", code: calRes, message: "\u274C Calendar: " + p.calId + "\n" + why, calId: p.calId, progId: p.progId };
  }
  await sleep(600);

  const progRes = await openProgram(tabId, p.progId, 20000);
  if (progRes === "NOT_FOUND") return await notFoundResult(tabId, p, "program", p.progId + " in calendar " + p.calId);
  if (progRes !== "OK") {
    const why = progRes === "NOT_FOUND"
      ? "Program ID not found in the list (waited 20s). Check the ID / whether it belongs to this calendar."
      : "Clicked program but the detail popup didn't open (slow render/hydration).";
    return { status: "FAIL_STEP", step: "Program", code: progRes, message: "\u274C Program: " + p.progId + "\n" + why, calId: p.calId, progId: p.progId };
  }

  let raw = "NOMODAL";
  for (let k = 0; k < 12; k++) {
    try { raw = await exec(tabId, inj_readModal); } catch (e) { raw = "NOMODAL"; }
    if (raw && raw !== "NOMODAL" && raw.split("\u00A7\u00A7")[0]) break;
    await sleep(300);
  }
  if (!raw || raw === "NOMODAL") return { status: "ERROR", message: "Popup opened but data couldn't be read.", calId: p.calId, progId: p.progId };

  const f = raw.split("\u00A7\u00A7");
  const actual = { id: f[0] || "", flag: f[1] || "", event: f[2] || "", tags: f[3] || "", when: f[4] || "", pre: f[5] || "", dur: f[6] || "", post: f[7] || "", ccid: f[8] || "", shard: f[9] || "", global: f[10] || "", repeats: f[11] || "", endsAfter: f[12] || "", calIds: f[13] || "" };

  const checks = []; const push = (c) => { if (c) checks.push(c); };
  if (p.calTag) {
    const tg = listInfo ? cmpTagExact("Calendar Tag", p.calTag, listInfo.tag) : { label: "Calendar Tag", pass: false, line: "\u274C Calendar Tag: expected \"" + p.calTag + "\" | could not read the calendar row in the calendars list" };
    if (tg) { tg.bold = true; push(tg); }
    if (listInfo) flagRuleChecks("", listInfo.flag, "Calendar Flag").forEach(push);
  }
  p = adaptGlued(p, actual);
  (p._gluedKept || []).forEach(raw => push({ label: "Event ID", pass: null, line: "Note: '" + raw + "' is kept as ONE id (KM holds exactly this id; the reader had split it in two)" }));
  flagRuleChecks(p.flag, actual.flag, "Flag", !!p.flagCmp).forEach(push);
  // Content tokens: presence AND correct position (mis-placed = FAIL)
  cmpInFieldMulti("Event ID", p.event, "Event IDs", actual.event, [{ name: "Package Tags", val: actual.tags }, { name: "County Config IDs", val: actual.ccid }, { name: "Calendar IDs", val: actual.calIds }]).forEach(push);
  packageTagChecks(p, actual).forEach(push);
  cmpInFieldMulti("County Config ID", p.cocIds, "County Config IDs", actual.ccid, [{ name: "Event IDs", val: actual.event }, { name: "Package Tags", val: actual.tags }, { name: "Calendar IDs", val: actual.calIds }]).forEach(push);
  cmpInFieldMulti("Calendar ID", p.calIds, "Calendar IDs", actual.calIds, [{ name: "Event IDs", val: actual.event }, { name: "Package Tags", val: actual.tags }, { name: "County Config IDs", val: actual.ccid }]).forEach(push);
  if (p.shard) push(cmpExact("Shard Tag", norm(p.shard), actual.shard));
  else if (p.shardTokens) cmpInFieldMulti("Shard Tag", p.shardTokens, "Shard Tag", actual.shard, [{ name: "Package Tags", val: actual.tags }, { name: "Event IDs", val: actual.event }]).forEach(push);
  if (p.noteKmTags && !p.tags) checks.push({ label: "Package Tag", pass: null, bold: true, line: "Note: Package Tags not specified in the ticket \u2014 KM has: " + (norm(actual.tags) || "(none)") });
  if (p.unknownContent) checks.push({ label: "Content", pass: null, line: "Note: unrecognized Content type(s) \u2014 verify manually: " + p.unknownContent });
  cmpWhen(norm(p.date), norm(p.time), actual.when).forEach(push);
  const se = p.strictEmpty || [];
  push(cmpDurField("Pre-Duration", norm(p.pre), actual.pre, se.indexOf("pre") >= 0));
  push(cmpDurField("Duration", norm(p.dur), actual.dur, se.indexOf("dur") >= 0));
  push(cmpDurField("Post-Duration", norm(p.post), actual.post, se.indexOf("post") >= 0));
  if (p.schedNote) checks.push({ label: "Schedule", pass: null, line: "Note: " + p.schedNote });
  if (p.evNote) checks.push({ label: "Event", pass: null, line: "Note: " + p.evNote });
  push(cmpGlobal(p.global, actual.global));
  // ticket-data problems found while reading the ticket (e.g. no value labeled for this calendar's brackets)
  (p.dataErrors || []).forEach(m => checks.push({ label: "Ticket data", pass: false, line: "\u274C TICKET DATA ERROR \u2014 " + m }));
  if (p.kvk) kvkProgramChecks(p, actual).forEach(c => checks.push(c));
  push(cmpRepeatEvery(p.repeatEvery, actual.repeats));
  push(cmpEndsAfter(p.endsAfter, actual.endsAfter, actual.repeats));
  if (p.flagNote) checks.push({ label: "Flag", pass: null, line: "Note: " + p.flagNote });

  const anyChecked = checks.some(c => c.pass === true || c.pass === false);
  const anyFail = checks.some(c => c.pass === false);
  const overall = !anyChecked ? "N/A" : (anyFail ? "FAIL" : "PASS");
  const passCount = checks.filter(c => c.pass === true).length;
  const failCount = checks.filter(c => c.pass === false).length;

  const ts = new Date().toLocaleString();
  const actualLines = [
    "\u2500\u2500 ACTUAL DATA \u2500\u2500",
    "Flag: " + actual.flag,
    "Event IDs: " + actual.event,
    "Package Tags: " + actual.tags,
    "County Config IDs: " + actual.ccid + "  |  Calendar IDs: " + actual.calIds,
    "Shard Tag: " + actual.shard,
    (p.calTag && listInfo ? "Calendar (list): Flag " + (listInfo.flag || "-") + "  |  Tag " + (listInfo.tag || "-") : null),
    "When: " + String(actual.when || "").replace(/\n+/g, " / "),
    "Pre/Dur/Post: " + actual.pre + " / " + actual.dur + " / " + actual.post,
    "Global: " + actual.global + "  |  Repeats: " + actual.repeats.replace(/\n/g, " / ") + "  |  Ends after: " + actual.endsAfter
  ].filter(Boolean);

  let savedAs = "", shotErr = "", imageDataUrl = "", savedFallback = false;
  try {
    const dataUrl = await captureShot(tabId, { overall, progId: programHeader(p), ts, resultLines: checks.map(c => ({ line: c.line, pass: c.pass, bold: !!c.bold })), actualLines, highlight: failLabels(checks), listShot, preNotes, tagFail: checks.some(c => c.label === "Calendar Tag" && c.pass === false) });
    if (typeof dataUrl === "string" && dataUrl.indexOf("data:image/png") === 0) {
      const sv = await saveImage(p, failPrefix(overall, checks) + (p.calId ? p.calId + " - " : "") + (p.progId || "calcheck"), dataUrl);
      savedAs = sv.savedAs; savedFallback = sv.fallback;
    } else { shotErr = "Screenshot failed (" + dataUrl + ")"; }
  } catch (e) { shotErr = "Screenshot failed: " + (e.message || e); }

  return { status: "DONE", overall, anyChecked, passCount, failCount, resultLines: checks.map(c => ({ line: c.line, pass: c.pass, bold: !!c.bold })), actual, actualLines, savedAs, savedFallback, shotErr, imageDataUrl, ts, calId: p.calId, progId: p.progId, capDiag: CAP ? JSON.parse(JSON.stringify(CAP)) : null };
}
