/* CalCheck v2 — service worker (MV3)
 * Runs in a background tab (active:false) so the popup keeps focus.
 * Compares: Flag, Event IDs, Package Tags, Date, Time, Pre/Duration/Post (exact match).
 * Navigates by Calendar ID + Program ID. English report.
 */

const DESIGN_HOST = "design.km.globalworldwide.com";

// ---------- text helpers ----------
function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function lc(s) { return norm(s).toLowerCase(); }
function splitCsv(s) { return (s || "").replace(/;/g, ",").split(",").map(norm).filter(Boolean); }
// Program-id match for boss row selection: exact, else token-set equality ignoring
// order and any wkN token (KM sometimes reorders tokens / drops the week suffix).
function idTokens(s) { return lc(s).split(/[.\-_/\s]+/).filter(t => t && !/^wk\d+$/.test(t)).sort().join("."); }
function idMatch(a, b) { if (!a || !b) return false; if (lc(a) === lc(b)) return true; return idTokens(a) === idTokens(b); }

// ---------- comparison (English) ----------
function cmpExact(label, exp, act) {
  if (!exp) return null;
  const ok = lc(exp) === lc(act);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + act + '"' };
}
// Pre/Dur/Post: a value -> exact match. Blank in the ticket -> skipped, UNLESS strict
// (mission tickets): then KM must be blank too ("", "N/A" or "-").
// Duration -> total seconds, so formatting never matters: "23h50m" = "23h 50m" = "23 h 50 m",
// "1d23h45m" = "1d 23h 45m", "24h" = "1d" (same duration). A unit-less number takes the next
// smaller unit ("23h50" = 23h 50m). Returns null when the text is not a duration.
function durSeconds(x) {
  const t = String(x || "").toLowerCase().replace(/[,;]/g, " ").trim();
  const re = /(\d+)\s*([dhms])?/g;
  if (!t || t.replace(re, " ").replace(/\s+/g, "")) return null;
  const mult = { d: 86400, h: 3600, m: 60, s: 1 }, nextU = { d: "h", h: "m", m: "s" };
  let total = 0, last = null, any = false, m;
  while ((m = re.exec(t))) {
    const u = m[2] || nextU[last];
    if (!u) return null;
    total += parseInt(m[1], 10) * mult[u]; last = u; any = true;
  }
  return any ? total : null;
}
// Pre / Duration / Post: compare the VALUE (spaces, case and unit layout are ignored)
function cmpDuration(label, exp, act) {
  if (!exp) return null;
  const e = durSeconds(exp), a = durSeconds(act);
  const ok = (e != null && a != null) ? e === a : lc(exp).replace(/\s+/g, "") === lc(act).replace(/\s+/g, "");
  const sameText = lc(exp) === lc(act);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + act + '"' + (ok && !sameText ? " (same duration)" : "") };
}
function isBlankKM(v) { return !/\d+\s*[dhm]/i.test(norm(v)); } // no real duration (blank, N/A, -, ...) = blank
function cmpDurField(label, exp, act, strict) {
  if (exp) return cmpDuration(label, exp, act);
  if (!strict) return null;
  const ok = isBlankKM(act);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected empty | actual "' + (norm(act) || "(empty)") + '"' };
}
function cmpContains(label, exp, act) {
  if (!exp) return null;
  const ok = lc(act).indexOf(lc(exp)) >= 0;
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': "' + exp + '"' + (ok ? " (found in: " + act + ")" : ' NOT found in "' + act + '"') };
}
function cmpMulti(label, expCsv, actJoined) {
  const exp = splitCsv(expCsv);
  if (!exp.length) return [];
  return exp.map(e => {
    const ok = lc(actJoined).indexOf(lc(e)) >= 0;
    return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + (ok ? " has: " : " MISSING: ") + e };
  });
}

// ---------- canonical Time / Date comparison ----------
// Time: compare by seconds-of-day; a missing seconds field counts as :00
// ("02:00" == "02:00:00", but "02:00:10" != "02:00"). Timezone: only fails when
// BOTH sides state a tz and they differ (a missing tz is treated as UTC).
function parseTimeToken(s) {
  const m = String(s || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const mi = parseInt(m[2], 10), se = m[3] ? parseInt(m[3], 10) : 0;
  const ap = (m[4] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
  const tzm = String(s || "").match(/\b(UTC|GMT|[A-Z]{2,4})\b/);
  return { sec: h * 3600 + mi * 60 + se, tz: tzm ? tzm[1].toUpperCase() : "" };
}
function cmpTime(label, exp, whenAct) {
  if (!exp) return null;
  const e = parseTimeToken(exp), a = parseTimeToken(whenAct);
  let ok = false, note = "";
  if (e && a) {
    ok = e.sec === a.sec;
    if (ok && e.tz && a.tz && e.tz !== a.tz) { ok = false; note = " (timezone differs: " + e.tz + " vs " + a.tz + ")"; }
  } else if (!a) { note = " (no time found on KM)"; }
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + whenAct + '"' + note };
}
const MON_BG = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function monNumBg(w) { w = (w || "").toLowerCase(); return MON_BG[w.slice(0, 4)] || MON_BG[w.slice(0, 3)] || 0; }
function norm4y(y) { y = parseInt(y, 10); return y < 100 ? 2000 + y : y; }
// Parse a date to {mo,d,y} (y=0 when absent). Handles M/D/Y, M/D, "25[th] Sept [2026]",
// "Sept 25[, 2026]"; ignores leading zeros and weekday prefixes.
function parseDateParts(s) {
  s = String(s || ""); let m;
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/))) return { mo: +m[1], d: +m[2], y: norm4y(m[3]) };
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\b/))) return { mo: +m[1], d: +m[2], y: 0 };
  if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?/)) && monNumBg(m[2])) return { mo: monNumBg(m[2]), d: +m[1], y: m[3] ? +m[3] : 0 };
  if ((m = s.match(/\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/)) && monNumBg(m[1])) return { mo: monNumBg(m[1]), d: +m[2], y: m[3] ? +m[3] : 0 };
  return null;
}
// ===== When: a program can have SEVERAL entries (date + time each) on KM =====
// The ticket's date/time only has to be one of them; extra entries on KM are fine. Date and time
// must belong to the SAME entry (no mixing the date of one entry with the time of another).
function whenEntries(when) {
  const out = [], str = String(when || "");
  const re = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\s,]*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(am|pm))?\s*(UTC|GMT)?)?/gi;
  let m;
  while ((m = re.exec(str))) {
    const t = m[4] ? parseTimeToken(m[4] + (m[5] ? " " + m[5] : "") + (m[6] ? " " + m[6] : "")) : null;
    out.push({ mo: +m[1], d: +m[2], y: norm4y(m[3]), sec: t ? t.sec : null, tz: t ? t.tz : "" });
  }
  return out;
}
function whenShow(e) {
  const p2 = n => String(n).padStart(2, "0");
  const t = e.sec == null ? "" : " " + p2(Math.floor(e.sec / 3600)) + ":" + p2(Math.floor(e.sec / 60) % 60) + ":" + p2(e.sec % 60) + (e.tz ? " " + e.tz : "");
  return e.mo + "/" + e.d + "/" + e.y + t;
}
function cmpWhen(expDate, expTime, when) {
  const out = [];
  if (!expDate && !expTime) return out;
  const ents = whenEntries(when), many = ents.length > 1;
  const ed = expDate ? parseDateParts(expDate) : null, et = expTime ? parseTimeToken(expTime) : null;
  const list = ents.slice(0, 10).map(whenShow).join("  |  ") + (ents.length > 10 ? "  |  \u2026" : "");
  let dm = ents, dateOk = true;
  if (expDate) {
    dm = ed ? ents.filter(e => e.mo === ed.mo && e.d === ed.d && (!ed.y || !e.y || ed.y === e.y)) : [];
    dateOk = dm.length > 0;
    let line;
    if (dateOk) line = "\u2705 Date: expected \"" + expDate + "\" | " + (many ? "found in KM entry " + (ents.indexOf(dm[0]) + 1) + " of " + ents.length : "actual \"" + whenShow(dm[0]).split(" ")[0] + "\"");
    else if (!ents.length) line = "\u274C Date: expected \"" + expDate + "\" | no date found on KM";
    else if (ed && ents.some(e => e.mo === ed.mo && e.d === ed.d)) line = "\u274C Date: expected \"" + expDate + "\" | same day on KM but a different year: " + list;
    else line = "\u274C Date: expected \"" + expDate + "\" | KM has " + (many ? ents.length + " entries: " : "") + list;
    out.push({ label: "Date", pass: dateOk, line });
  }
  if (expTime) {
    if (expDate && !dateOk) out.push({ label: "Time", pass: null, line: "Note: Time not checked \u2014 no KM entry has the ticket's date" });
    else {
      const cand = expDate ? dm : ents;           // the time must sit in the entry of the matching date
      const hit = et && cand.find(e => e.sec != null && e.sec === et.sec && (!e.tz || !et.tz || e.tz === et.tz));
      let line;
      if (hit) line = "\u2705 Time: expected \"" + expTime + "\" | actual \"" + whenShow(hit).split(" ").slice(1).join(" ") + "\"" + (many && expDate ? " (same entry as the date)" : "");
      else if (!ents.length) line = "\u274C Time: expected \"" + expTime + "\" | no time found on KM";
      else {
        const have = cand.filter(e => e.sec != null).map(e => whenShow(e).split(" ").slice(1).join(" "));
        line = "\u274C Time: expected \"" + expTime + "\" | KM " + (expDate ? "entry for that date" : "entries") + " " + (have.length ? "has " + Array.from(new Set(have)).join(", ") : "has no time");
      }
      out.push({ label: "Time", pass: !!hit, line });
    }
  }
  if (many && dateOk) out.push({ label: "When", pass: null, line: "Note: KM shows " + ents.length + " When entries \u2014 the ticket's is one of them; the other entries are ignored" });
  return out;
}
function cmpDate(label, exp, whenAct) {
  if (!exp) return null;
  const e = parseDateParts(exp), a = parseDateParts(whenAct);
  let ok = false, note = "";
  if (e && a) {
    ok = e.mo === a.mo && e.d === a.d;
    if (ok && e.y && a.y && e.y !== a.y) { ok = false; note = " (year differs: " + e.y + " vs " + a.y + ")"; }
    else if (ok && !e.y && a.y) { note = " (ticket has no year; compared month/day only)"; }
  } else if (!a) { note = " (no date found on KM)"; }
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + whenAct + '"' + note };
}
// Boss-spawn: the coc id MUST sit in "County Config IDs"; if it's in "Event IDs"
// it was mis-tagged -> FAIL.
function cmpPlacement(label, coc, ccids, evids) {
  if (!coc) return null;
  const inCC = lc(ccids).indexOf(lc(coc)) >= 0;
  const inEV = lc(evids).indexOf(lc(coc)) >= 0;
  const ok = inCC && !inEV;
  let note = "";
  if (inEV) note = " (found under Event IDs \u2014 must be County Config IDs)";
  else if (!inCC) note = " (not found in County Config IDs)";
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ": " + coc + note };
}

// Position-aware presence check for a single token. correctVal = the KM field the
// token SHOULD be in; others = [{name, val}, ...] the fields it must NOT be in.
// Reports clearly whether it's present AND in the right place, or mis-placed.
// A KM field holds a list of ids. An id counts as present only as a WHOLE id (case-insensitive):
// an extra / missing character, or a longer id that merely contains it, is not a match.
function fieldIds(v) { return String(v || "").split(/[,\s]+/).map(x => x.trim()).filter(Boolean); }
function hasId(val, tok) { const t = lc(tok); return fieldIds(val).some(x => lc(x) === t); }
function idWhy(want, got) {
  const dl = got.length - want.length, n = Math.abs(dl);
  if (evDay(want) !== evDay(got)) return "different day";
  if (dl > 0) return n + " extra character" + (n === 1 ? "" : "s");
  if (dl < 0) return n + " missing character" + (n === 1 ? "" : "s");
  const d = evLev(lc(want), lc(got)); return d + " character" + (d === 1 ? "" : "s") + " differ";
}
function cmpInField(label, token, correctName, correctVal, others, expectedAll) {
  if (!token) return null;
  if (hasId(correctVal, token)) return { label, pass: true, line: "\u2705 " + label + " '" + token + "' \u2014 present in the correct field (" + correctName + ") on KM" };
  const wrong = (others || []).find(o => hasId(o.val, token));
  if (wrong) return { label, pass: false, line: "\u274C " + label + " '" + token + "' \u2014 found in the WRONG field (" + wrong.name + "), must be " + correctName };
  // near miss in the right field: <= 2 characters apart, or KM's id is the ticket's id plus/minus a
  // short tail. Ids the ticket also needs are never offered as the "near" one.
  const skip = (expectedAll || []).map(lc);
  let best = null;
  fieldIds(correctVal).forEach(x => {
    if (skip.indexOf(lc(x)) >= 0) return;
    const d = evLev(lc(token), lc(x)), pre = (lc(x).indexOf(lc(token)) === 0 || lc(token).indexOf(lc(x)) === 0) && Math.abs(x.length - token.length) <= 10;
    if ((d <= 2 || pre) && (!best || d < best.d)) best = { x, d };
  });
  if (best) return { label, pass: false, line: "\u274C " + label + " '" + token + "' \u2014 KM " + correctName + " has '" + best.x + "' (" + idWhy(token, best.x) + ")" };
  return { label, pass: false, line: "\u274C " + label + " '" + token + "' \u2014 MISSING (not in " + correctName + ")" };
}
function cmpInFieldMulti(label, expCsv, correctName, correctVal, others) {
  const all = splitCsv(expCsv);
  return all.map(tok => cmpInField(label, tok, correctName, correctVal, others, all)).filter(Boolean);
}

// Global: only enforced when the ticket says yes. Ticket no/empty -> default no, pass.
function cmpGlobal(expYesNo, actGlobal) {
  const exp = lc(expYesNo);
  if (exp !== "yes") return null; // ticket has no "yes" -> not checked
  const actYes = /^\s*yes\b/i.test(actGlobal || "");
  return { label: "Global", pass: actYes, line: (actYes ? "\u2705 " : "\u274C ") + 'Global: expected "Yes" | actual "' + (actGlobal || "(empty)") + '"' };
}
// Repeats: KM shows "Every N day" / "Every N days". Compare the interval number.
function cmpRepeatEvery(expInterval, actRepeats) {
  if (!expInterval) return null;
  const m = String(actRepeats || "").match(/every\s+(\d+)\s*day/i);
  const actN = m ? parseInt(m[1], 10) : null;
  const ok = actN === Number(expInterval);
  return { label: "Repeats", pass: ok, line: (ok ? "\u2705 " : "\u274C ") + 'Repeats: expected "Every ' + expInterval + ' day' + (Number(expInterval) === 1 ? "" : "s") + '" | actual "' + (String(actRepeats || "").replace(/\s*\n\s*/g, " / ") || "(empty)") + '"' };
}
// Ends after: KM shows "N occurrences" (own field, and inside the Repeats cell).
function cmpEndsAfter(expOcc, actEndsAfter, actRepeats) {
  if (!expOcc) return null;
  let m = String(actEndsAfter || "").match(/(\d+)\s*occurrence/i);
  if (!m) m = String(actRepeats || "").match(/ends?\s*after\s*(\d+)\s*occurrence/i);
  const actN = m ? parseInt(m[1], 10) : null;
  const ok = actN === Number(expOcc);
  return { label: "Ends after", pass: ok, line: (ok ? "\u2705 " : "\u274C ") + 'Ends after: expected "' + expOcc + ' occurrences" | actual "' + (actEndsAfter || actRepeats || "(empty)") + '"' };
}

// ============ injected (MAIN world) ============
function inj_findClick(targetText) {
  var target = (targetText || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) return "NOTARGET";
  var nodes = document.querySelectorAll("a,span,div,td,th,p,button,li");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.children.length === 0) {
      var t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (t === target) {
        try { el.scrollIntoView({ block: "center" }); } catch (e) {}
        try { el.click(); } catch (e) { return "CLICKFAIL"; }
        return "CLICKED";
      }
    }
  }
  return "NOTFOUND";
}
function inj_url() { return location.href; }
function inj_modal() { return document.querySelector(".MuiDialog-paper") ? "MODAL" : "NOMODAL"; }
function inj_closeModal() {
  var root = document.querySelector(".MuiDialog-paper");
  if (!root) return "NOMODAL";
  // try a close button first
  var btns = root.querySelectorAll('button[aria-label],button');
  for (var i = 0; i < btns.length; i++) {
    var al = (btns[i].getAttribute("aria-label") || "").toLowerCase();
    if (al.indexOf("close") >= 0) { try { btns[i].click(); return "CLOSED"; } catch (e) {} }
  }
  // else click the backdrop
  var bd = document.querySelector(".MuiBackdrop-root");
  if (bd) { try { bd.click(); return "CLOSED"; } catch (e) {} }
  // else press Escape
  try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true })); } catch (e) {}
  return "ESC";
}
function inj_rowCount() { return document.querySelectorAll("span.cursor-pointer.underline").length; }
function inj_readModal() {
  var root = document.querySelector(".MuiDialog-paper");
  if (!root) return "NOMODAL";
  function cell(label) {
    var all = root.querySelectorAll("div,td,th,span,p");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && (el.textContent || "").trim() === label) {
        return el.parentElement ? el.parentElement.nextElementSibling : null;
      }
    }
    return null;
  }
  function gv(label) { var c = cell(label); return c ? (c.textContent || "").trim() : ""; }
  function gvLines(label) { var c = cell(label); if (!c) return ""; var t = (c.innerText || c.textContent || ""); return t.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).join("\n"); }
  function gvIds(label) {
    var c = cell(label); if (!c) return "";
    var chips = c.querySelectorAll(".MuiChip-label");
    if (chips.length) { var a = []; for (var j = 0; j < chips.length; j++) { var tx = (chips[j].textContent || "").trim(); if (tx) a.push(tx); } return a.join(", "); }
    return String(c.innerText || c.textContent || "").split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean).join(", ");
  }
  function gvChips(label) {
    var c = cell(label);
    if (!c) return "";
    var chips = c.querySelectorAll(".MuiChip-label");
    if (!chips.length) return (c.textContent || "").trim();
    var a = [];
    for (var j = 0; j < chips.length; j++) { var tx = (chips[j].textContent || "").trim(); if (tx) a.push(tx); }
    return a.join(", ");
  }
  var titleChips = root.querySelectorAll(".MuiDialogTitle-root .MuiChip-label");
  if (!titleChips.length) titleChips = root.querySelectorAll(".MuiChip-label"); // fallback if title markup differs
  var idT = "", flagT = "";
  for (var t = 0; t < titleChips.length; t++) {
    var tx = (titleChips[t].textContent || "").trim();
    if (!tx) continue;
    if (!idT && tx.indexOf(".") >= 0 && tx.indexOf(" ") < 0) { idT = tx; continue; }   // dotted -> program id
    if (!flagT && tx.indexOf("-") >= 0 && tx.indexOf(" ") < 0) { flagT = tx; continue; } // hyphen -> flag
  }
  if (!idT && titleChips[0]) idT = (titleChips[0].textContent || "").trim();
  if (!flagT && titleChips[1]) flagT = (titleChips[1].textContent || "").trim();
  return [idT, flagT, gvChips("Event IDs"), gvChips("Package Tags"),
          gvLines("When"), gv("Pre-Duration"), gv("Duration"), gv("Post-Duration"),
          gvChips("County Config IDs"), gvIds("Shard Tag"),
          gv("Global"), gvLines("Repeats"), gv("Ends after"), gvChips("Calendar IDs")].join("\u00A7\u00A7");
}
// Boss-spawn: on a calendar's PROGRAMS list, return the program-ID strings of every
// row whose Content column contains the given coc id. Rows are located generically:
// for each clickable ID (span.cursor-pointer.underline) climb to the smallest
// ancestor that contains the coc text AND exactly one ID (i.e. a single row).
function inj_findRowsByContent(coc) {
  var want = (coc || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!want) return "[]";
  var ids = document.querySelectorAll("span.cursor-pointer.underline");
  var seen = {}, out = [];
  for (var i = 0; i < ids.length; i++) {
    var idEl = ids[i];
    var idText = (idEl.textContent || "").replace(/\s+/g, " ").trim();
    if (!idText) continue;
    var node = idEl.parentElement, hitNode = null;
    for (var up = 0; up < 12 && node; up++) {
      if ((node.textContent || "").toLowerCase().indexOf(want) >= 0) { hitNode = node; break; }
      node = node.parentElement;
    }
    if (hitNode) {
      var idCount = hitNode.querySelectorAll("span.cursor-pointer.underline").length;
      if (idCount === 1 && !seen[idText]) { seen[idText] = 1; out.push(idText); }
    }
  }
  return JSON.stringify(out);
}
async function inj_shot(payload) {
  var root = document.querySelector(".MuiDialog-paper");
  if (!root) return "NOMODAL";
  if (typeof window.html2canvas !== "function") return "NOLIB";
  // Temporarily unclip scrollable areas so the FULL popup (all chips/rows) is
  // captured, not just the visible part; styles are restored right after.
  var saved = [], rootSaved = null;
  try {
    var scan = root.querySelectorAll("*");
    for (var qi = 0; qi < scan.length; qi++) {
      var el = scan[qi];
      if (el.scrollHeight > el.clientHeight + 2) {
        saved.push([el, el.style.overflow, el.style.maxHeight, el.style.height]);
        el.style.overflow = "visible"; el.style.maxHeight = "none"; el.style.height = "auto";
      }
    }
    rootSaved = [root.style.overflow, root.style.maxHeight, root.style.height];
    root.style.overflow = "visible"; root.style.maxHeight = "none"; root.style.height = "auto";
  } catch (e) { /* expansion best-effort */ }
  var mc = null;
  try { mc = await window.html2canvas(root, { backgroundColor: "#ffffff", scale: 2, logging: false, useCORS: true }); } catch (e) { mc = null; }
  // restore styles no matter what
  try {
    for (var ri = saved.length - 1; ri >= 0; ri--) { saved[ri][0].style.overflow = saved[ri][1]; saved[ri][0].style.maxHeight = saved[ri][2]; saved[ri][0].style.height = saved[ri][3]; }
    if (rootSaved) { root.style.overflow = rootSaved[0]; root.style.maxHeight = rootSaved[1]; root.style.height = rootSaved[2]; }
  } catch (e) {}
  // if the expanded capture failed, retry once with the modal as-is
  if (!mc) { try { mc = await window.html2canvas(root, { backgroundColor: "#ffffff", scale: 2, logging: false, useCORS: true }); } catch (e) { mc = null; } }
  if (mc && payload.highlight && payload.highlight.length) {
    try {
      var pb = root.getBoundingClientRect(), k2 = mc.width / (pb.width || mc.width), c2 = mc.getContext("2d");
      var rowOf = function (label) { var all = root.querySelectorAll("div,td,th,span,p"); for (var i = 0; i < all.length; i++) { var el = all[i]; if (el.children.length === 0 && (el.textContent || "").trim() === label) { var lc = el.parentElement; return lc && lc.parentElement ? lc.parentElement : lc; } } return null; };
      c2.strokeStyle = "#e01e1e"; c2.lineWidth = Math.max(3, Math.round(2.5 * k2));
      payload.highlight.forEach(function (l) {
        var el = null;
        if (l === "__flag") { var cs = root.querySelectorAll(".MuiDialogTitle-root .MuiChip-root"); el = cs.length > 1 ? cs[1] : root.querySelector(".MuiDialogTitle-root"); }
        else el = rowOf(l);
        if (el) { var b = el.getBoundingClientRect(); if (b.width && b.height) c2.strokeRect((b.left - pb.left) * k2 + 2, (b.top - pb.top) * k2 + 2, b.width * k2 - 4, b.height * k2 - 4); }
      });
    } catch (e) {}
  }
  var S = 2, pad = 20 * S;
  var overall = payload.overall, baseName = payload.progId, ts = payload.ts;
  var resultLines = payload.resultLines || [], actualLines = payload.actualLines || [];
  var color = overall === "PASS" ? "#0a7d28" : (overall === "FAIL" ? "#c00" : "#555");
  var head = [];
  head.push({ t: "CalCheck \u2014 RESULT: " + overall, c: color, b: true, s: 22 });
  head.push({ t: "Program: " + baseName + "   (" + ts + ")", c: "#333", s: 14 });
  head.push({ t: "", s: 8 });
  resultLines.forEach(function (l) { head.push({ t: l.line, b: !!l.bold, c: l.pass === false ? "#c00" : (l.pass === true ? "#0a7d28" : "#333"), s: 15 }); });
  head.push({ t: "", s: 8 });
  actualLines.forEach(function (l) { head.push({ t: l, c: "#555", s: 13 }); });
  if (!mc) head.push({ t: "(KM modal image unavailable \u2014 text report only)", c: "#c00", s: 13 });
  var lh = function (o) { return (o.s || 15) * S * 1.5; };
  var headerH = pad * 2 + head.reduce(function (a, o) { return a + lh(o); }, 0);
  var W = Math.max(mc ? mc.width : 0, 1100 * S);
  var out = document.createElement("canvas");
  out.width = W; out.height = Math.round(headerH) + (mc ? mc.height : 0);
  var ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = "top";
  var y = pad;
  head.forEach(function (o) {
    var sz = (o.s || 15) * S;
    ctx.fillStyle = o.c || "#333";
    ctx.font = (o.b ? "700 " : "") + sz + "px -apple-system, system-ui, Arial";
    if (o.t) ctx.fillText(o.t, pad, y);
    y += lh(o);
  });
  if (mc) {
    ctx.strokeStyle = "#e0e0e0"; ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(out.width, headerH); ctx.stroke();
    ctx.drawImage(mc, 0, Math.round(headerH));
  }
  return out.toDataURL("image/png");
}

// ============ orchestration ============
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function exec(tabId, func, args) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [], world: "MAIN" });
  return res && res[0] ? res[0].result : undefined;
}
async function injectFile(tabId, file) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file], world: "MAIN" });
}
function waitTabComplete(tabId, timeout) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = async () => {
      try { const t = await chrome.tabs.get(tabId); if (t.status === "complete") return resolve(true); }
      catch (e) { return resolve(false); }
      if (Date.now() - start > timeout) return resolve(true);
      setTimeout(tick, 300);
    };
    tick();
  });
}
async function ensureWorkTab(navUrl) {
  const stored = await chrome.storage.session.get("workTabId");
  let tabId = stored.workTabId;
  if (tabId != null) { try { await chrome.tabs.get(tabId); } catch (e) { tabId = null; } }
  if (tabId == null) { const tab = await chrome.tabs.create({ url: navUrl, active: false }); tabId = tab.id; }
  else { await chrome.tabs.update(tabId, { url: navUrl, active: false }); }
  await chrome.storage.session.set({ workTabId: tabId });
  return tabId;
}
async function openCalendar(tabId, calId, maxMs) {
  const start = Date.now(); let everFound = false, lastClick = 0;
  while (Date.now() - start < maxMs) {
    let url = ""; try { url = await exec(tabId, inj_url); } catch (e) {}
    if (url && url.indexOf("/design/calendar/") >= 0) return "OK";
    if (!lastClick || Date.now() - lastClick >= 5000) {
      const r = await exec(tabId, inj_findClick, [calId]);
      if (r === "CLICKED") { everFound = true; lastClick = Date.now(); }
    }
    await sleep(500);
  }
  return everFound ? "CLICK_NO_NAV" : "NOT_FOUND";
}
async function openProgram(tabId, progId, maxMs) {
  const start = Date.now(); let everFound = false, lastClick = 0;
  while (Date.now() - start < maxMs) {
    let m = "NOMODAL"; try { m = await exec(tabId, inj_modal); } catch (e) {}
    if (m === "MODAL") return "OK";
    if (!lastClick || Date.now() - lastClick >= 2000) {
      const r = await exec(tabId, inj_findClick, [progId]);
      if (r === "CLICKED") { everFound = true; lastClick = Date.now(); }
    }
    await sleep(500);
  }
  return everFound ? "CLICK_NO_MODAL" : "NOT_FOUND";
}
function notify(title, message) {
  try { chrome.notifications.create("", { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2 }); } catch (e) {}
}

async function runCheck(p) {
  let navUrl = (p.url || "").trim();
  if (!navUrl) navUrl = "https://" + DESIGN_HOST + "/design/calendars";
  let host = ""; try { host = new URL(navUrl).host; } catch (e) { return { status: "ERROR", message: "Invalid URL: " + navUrl }; }

  let tabId;
  try { tabId = await ensureWorkTab(navUrl); }
  catch (e) { return { status: "ERROR", message: "Cannot open tab: " + (e.message || e) }; }
  await dbgEarly(tabId);

  await waitTabComplete(tabId, 25000);
  await sleep(800);

  let curUrl = "";
  try { curUrl = await exec(tabId, inj_url); }
  catch (e) { return { status: "ERROR", message: "Cannot access page. Check host_permissions for: " + host }; }

  const onExpectedHost = curUrl.indexOf(host) >= 0;
  if (curUrl.indexOf("/login") >= 0 || !onExpectedHost) {
    try { await chrome.tabs.update(tabId, { active: true }); } catch (e) {}
    notify("CalCheck — Login required", "Sign in on the opened tab, then click CHECK again.");
    return { status: "LOGIN", message: "Not signed in. A tab was opened for you to log in — sign in, then click CHECK again." };
  }

  CUR = { i: 1, n: 1, progId: p.progId };
  const res = await checkOneCase(tabId, p, navUrl, true);
  const row = { progId: p.progId, status: res.status, overall: res.overall || "", message: res.message || "", resultLines: res.resultLines || [], savedAs: res.savedAs || "", imageDataUrl: res.imageDataUrl || "", shotErr: res.shotErr || "", capDiag: res.capDiag || null, savedFallback: !!res.savedFallback };
  res.logText = buildLog(p.ticket, [row]);
  res.logSaved = rowHasIssue(row) ? await saveLog(p.ticket, res.logText) : "";
  if (res.status === "DONE" && !row.savedAs && !row.imageDataUrl) notify("CalCheck \u2014 screenshot failed", "No screenshot saved for " + p.progId + " (see log).");
  return res;
}

// ===== Boss-spawn (v3/v4): locate program(s) on KM by coc id, check placement + inherited schedule =====
// p carries: calId (main cal), coc, shard (expected), flag/date/time/dur (inherited from
// main program), progId (ticket v3/v4 id, used for the screenshot name), prefix (main id).
// ===== Flag rule (always on): every program needs a real flag (not tbd / ignore) =====
function flagRuleChecks(expFlag, actFlag, what, compare) {
  // Default: the flag is only RECORDED (programs of one ticket can carry different flags) and checked
  // against the rule: not empty, no "tbd" / "ignore". For KvK tickets (compare = true) it is also
  // compared with the flag written in the ticket.
  const w = what || "Flag", fv = norm(actFlag);
  if (!fv) return [{ label: w, pass: false, flagRule: true, flagBad: "empty", line: "\u274C " + w + " is EMPTY \u2014 every program must have a flag (not tbd / ignore)" }];
  if (/tbd|ignore/i.test(fv)) return [{ label: w, pass: false, flagRule: true, flagBad: fv, line: "\u274C " + w + " '" + fv + "' is not allowed \u2014 contains tbd / ignore" }];
  if (compare && norm(expFlag)) {
    const ok = lc(expFlag) === lc(fv);
    return [{ label: w, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + w + ': expected "' + norm(expFlag) + '" | actual "' + fv + '"' + (ok ? " (not tbd / ignore)" : "") }];
  }
  return [{ label: w, pass: true, line: "\u2705 " + w + " on KM: '" + fv + "' \u2014 recorded; not empty, no tbd / ignore" }];
}
// File-name prefix for failed programs: "FAILED - " (+ "flag-<value> - " when the flag rule failed)
function failPrefix(overall, checks) {
  if (overall !== "FAIL") return "";
  const fr = (checks || []).find(c => c.flagRule && c.pass === false);
  return "FAILED - " + (fr ? "flag-" + safeName(fr.flagBad || "empty") + " - " : "");
}
// KM popup fields to box in red, from the failed checks
const FIELD_OF = { "Flag": "__flag", "Event ID": "Event IDs", "Package Tag": "Package Tags", "County Config ID": "County Config IDs", "Calendar ID": "Calendar IDs", "Shard Tag": "Shard Tag", "Date": "When", "Time": "When", "Pre-Duration": "Pre-Duration", "Duration": "Duration", "Post-Duration": "Post-Duration", "Global": "Global", "Repeats": "Repeats", "Ends after": "Ends after", "Config ID placement": "County Config IDs", "Global": "Global" };
function failLabels(checks) {
  const out = new Set();
  (checks || []).filter(c => c.pass === false).forEach(c => {
    if (FIELD_OF[c.label]) out.add(FIELD_OF[c.label]);
    const w = String(c.line || "").match(/WRONG field \(([^)]+)\)/); if (w) out.add(w[1]);
  });
  return Array.from(out);
}
// in-page: rects (relative to the popup) of the rows/chips to highlight
const HL_FN = "function(labels){var r=document.querySelector('.MuiDialog-paper');if(!r)return [];var pb=r.getBoundingClientRect();function rowOf(label){var all=r.querySelectorAll('div,td,th,span,p');for(var i=0;i<all.length;i++){var el=all[i];if(el.children.length===0&&(el.textContent||'').trim()===label){var lc=el.parentElement;return lc&&lc.parentElement?lc.parentElement:lc;}}return null;}var out=[];(labels||[]).forEach(function(l){var el=null;if(l==='__flag'){var cs=r.querySelectorAll('.MuiDialogTitle-root .MuiChip-root');el=cs.length>1?cs[1]:r.querySelector('.MuiDialogTitle-root');}else el=rowOf(l);if(el){var b=el.getBoundingClientRect();if(b.width&&b.height)out.push({x:b.left-pb.left,y:b.top-pb.top,w:b.width,h:b.height});}});return out;}";
let lastHl = null;
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
// ===== exact event check per program =====
// The ticket's section (B072/B073, C033 ...) is the list. Rule that says which program
// holds which event: the dayN in the event must equal the dayN in the program name, and
// the event TYPE (last segment) picks the program: sms/ams/alb -> *.0.events,
// slb -> *.1.slbs, rlb -> the parent program (…dayN). The scope word between
// (bcshards / cshard / c033 ...) is irrelevant: it is compared as plain text.
function evDay(x) { const m = String(x).match(/day(\d+)/i); return m ? m[1] : ""; }
function evKindOfEvent(e) { const t = String(e).split(".").pop().toLowerCase(); return /^(sms|ams|alb)$/.test(t) ? "events" : (t === "slb" ? "slbs" : (t === "rlb" ? "parent" : "?")); }
function evKindOfProg(p) { p = String(p); return /\.0\.events$/i.test(p) ? "events" : (/\.1\.slbs$/i.test(p) ? "slbs" : (/day\d+$/i.test(p) ? "parent" : "?")); }
function evLev(a, b) {
  const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; } for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function eventProgramCheck(sectionEvents, progName, kmEvents, others) {
  const out = [];
  const day = evDay(progName), kind = evKindOfProg(progName);
  if (!day || kind === "?") { out.push({ label: "Events", pass: null, line: "Note: event rule not applied \u2014 can't map program '" + progName + "' to a day / events-slbs-parent (events are still checked on the calendar row)" }); return out; }
  const exp = (sectionEvents || []).filter(e => evDay(e) === day && evKindOfEvent(e) === kind);
  const km = (kmEvents || []).filter(Boolean);
  const inKm = e => km.some(k => lc(k) === lc(e)), inExp = e => exp.some(k => lc(k) === lc(e));
  const missing = exp.filter(e => !inKm(e)), extra = km.filter(e => !inExp(e));
  const usedExtra = [];
  const short = e => String(e).replace(/^ev\.[a-z0-9]+\./i, "");
  missing.slice().forEach(m => {
    let best = null;
    extra.forEach(x => { if (usedExtra.indexOf(x) >= 0) return; const d = evLev(lc(m), lc(x)); if (d <= 2 && (!best || d < best.d)) best = { x, d }; });
    if (best) {
      usedExtra.push(best.x); missing.splice(missing.indexOf(m), 1);
      const why = idWhy(m, best.x);
      out.push({ label: "Event ID", pass: false, line: "\u274C KM has '" + short(best.x) + "', ticket has '" + short(m) + "' (" + why + ")" });
    }
  });
  missing.forEach(m => out.push({ label: "Event ID", pass: false, line: "\u274C '" + short(m) + "' MISSING on KM" }));
  extra.filter(x => usedExtra.indexOf(x) < 0).forEach(x => {
    const own = (others || []).find(o => (o.events || []).some(e => lc(e) === lc(x)));
    out.push({ label: "Event ID", pass: false, line: "\u274C '" + short(x) + "' is not in the ticket's list for this program" + (own ? " (it belongs to the " + own.name + " list)" : "") });
  });
  if (!out.length && exp.length) out.push({ label: "Event ID", pass: true, line: "\u2705 Event IDs: " + exp.length + "/" + exp.length + " ticket events are in the Event IDs field and match exactly" });
  return out;
}
// Header of the report image: which calendar / shard the picture belongs to
function programHeader(p) {
  if (p.calTag || p.kvk || p.showCal) return p.progId + "  @  " + p.calId + (p.bracket ? "  \u00B7  shard " + p.bracket : "");
  return p.progId;
}
// The reader splits a token like "ev.Atag.B" into two ids (two ids stuck together in Jira). But some real ids
// contain "ev." / "tag." inside (ev.ftev.kvk.v2, tag.kvk.ftev.shop.v2). KM decides: when the glued form
// exists on KM as ONE id in its own field, it is kept as one id and its split parts are not checked.
function gluedParts(raw) { return String(raw).split(/(?<=[^.])(?=(?:ev|tag)\.)/i).map(x => x.replace(/\.+$/, "").trim()).filter(Boolean); }
function adaptGlued(p, actual) {
  const raws = (p._glued || []).filter(Boolean); if (!raws.length) return p;
  const lists = { event: splitCsv(p.event), tags: splitCsv(p.tags) }, kept = [];
  raws.forEach(raw => {
    const isEv = /^ev\./i.test(raw), isTag = /^tag\./i.test(raw);
    const field = isEv ? actual.event : (isTag ? actual.tags : "");
    if (!field || !hasId(field, raw)) return;
    const parts = gluedParts(raw).map(lc);
    lists.event = lists.event.filter(x => parts.indexOf(lc(x)) < 0); lists.tags = lists.tags.filter(x => parts.indexOf(lc(x)) < 0);
    const tgt = isEv ? lists.event : lists.tags; if (!tgt.some(x => lc(x) === lc(raw))) tgt.push(raw);
    kept.push(raw);
  });
  if (!kept.length) return p;
  return Object.assign({}, p, { event: lists.event.join(", "), tags: lists.tags.join(", "), _gluedKept: kept });
}
// Package Tags from the ticket and/or typed by hand in the popup (those are marked in the report)
function packageTagChecks(p, actual) {
  const man = (p.manualTags || []).map(lc);
  return cmpInFieldMulti("Package Tag", p.tags, "Package Tags", actual.tags, [{ name: "Event IDs", val: actual.event }, { name: "County Config IDs", val: actual.ccid }, { name: "Calendar IDs", val: actual.calIds }]).map(c => {
    const m = c.line.match(/'([^']+)'/);
    if (m && man.indexOf(lc(m[1])) >= 0) c.line += " (added manually)";
    return c;
  });
}
// KvK calendar-grouped programs: event placement, Global (when it has events), events note
function kvkProgramChecks(p, actual) {
  const out = [];
  const evRes = (p.evWatch || []).length ? eventProgramCheck(p.evWatch, p.progId, String(actual.event || "").split(/[,\s]+/).filter(Boolean), p.evOthers) : [];
  // position: a ticket event of this bracket must sit in Event IDs, never in another field
  const wrong = [];
  (p.evWatch || []).forEach(tok => {
    const w = [{ name: "Package Tags", val: actual.tags }, { name: "County Config IDs", val: actual.ccid }, { name: "Calendar IDs", val: actual.calIds }, { name: "Shard Tag", val: actual.shard }].find(o => hasId(o.val, tok));
    if (w && !hasId(actual.event, tok)) wrong.push({ label: "Event ID", pass: false, line: "\u274C Event ID '" + tok + "' \u2014 found in the WRONG field (" + w.name + "), must be Event IDs" });
  });
  if (evRes.length === 1 && evRes[0].pass === true && !wrong.length) evRes[0].line += " \u2014 none of them in another field (Package Tags / Calendar IDs / County Config IDs / Shard Tag)";
  evRes.forEach(c => out.push(c)); wrong.forEach(c => out.push(c));
  if (p.globalIfEvents && /(^|,\s*)ev\./i.test(actual.event || "")) {
    const gy = /^\s*yes\b/i.test(actual.global || "");
    out.push({ label: "Global", pass: gy, line: (gy ? "\u2705 " : "\u274C ") + 'Global: program has events \u2192 expected "Yes" | actual "' + (norm(actual.global) || "(empty)") + '"' });
  }
  if (p.noteEvents) out.push({ label: "Events", pass: null, line: "Note: Events on KM for this program: " + (norm(actual.event) || "(none)") });
  return out;
}

// ===== Picture 1 of the report: the calendars list filtered by the calendar id =====
// (what you see when you search the calendar by hand: ID | Flag | Tag ...). The Tag / Flag of the
// calendar are read from that row; the picture is stacked above the program popup.
function inj_readListRow(calId) {
  var all = document.querySelectorAll("div,span,p,td,th,a"), L = [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i]; if (e.children.length) continue;
    var t = (e.textContent || "").trim(); if (!t) continue;
    var b = e.getBoundingClientRect(); if (b.width) L.push({ t: t, b: b });
  }
  function rc(b) { return { x: b.left, y: b.top, w: b.width, h: b.height }; }
  var hdr = {};
  ["ID", "Flag", "Tag"].forEach(function (name) { for (var k = 0; k < L.length; k++) if (L[k].t === name && L[k].b.top > 100 && L[k].b.top < 360) { hdr[name] = L[k].b; break; } });
  if (!hdr.ID || !hdr.Tag) return JSON.stringify({ found: false });
  var idc = null;
  for (var j = 0; j < L.length; j++) if (L[j].t === calId && L[j].b.top > hdr.ID.bottom - 2) { idc = L[j]; break; }
  if (!idc) return JSON.stringify({ found: false });
  var mid = idc.b.top + idc.b.height / 2, cells = L.filter(function (c) { return Math.abs(c.b.top + c.b.height / 2 - mid) < 20; });
  function under(name) {
    var h = hdr[name]; if (!h) return null; var best = null;
    cells.forEach(function (c) { var ov = Math.min(c.b.right, h.right + 40) - Math.max(c.b.left, h.left - 10); if (ov > 0 && (!best || Math.abs(c.b.left - h.left) < Math.abs(best.b.left - h.left))) best = c; });
    return best;
  }
  var fl = under("Flag"), tg = under("Tag");
  var ids = L.filter(function (c) { return /^cal\./i.test(c.t) && Math.abs(c.b.left - hdr.ID.left) < 14 && c.b.top > hdr.ID.bottom - 2; }).sort(function (a, b) { return a.b.top - b.b.top; }).slice(0, 4);
  var rowsBottom = idc.b.bottom; ids.forEach(function (c) { if (c.b.bottom > rowsBottom) rowsBottom = c.b.bottom; });
  if (tg && tg.b.bottom > rowsBottom) rowsBottom = tg.b.bottom;
  var tagRect = tg ? rc(tg.b) : { x: hdr.Tag.left - 6, y: idc.b.top - 6, w: hdr.Tag.width + 20, h: idc.b.height + 12 };
  return JSON.stringify({ found: true, flag: fl ? fl.t : "", tag: tg ? tg.t : "", flagRect: fl ? rc(fl.b) : null, tagRect: tagRect, hdrLeft: hdr.ID.left, hdrTop: hdr.ID.top, rowsBottom: rowsBottom, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 });
}
// pure: the part of the page to photograph (table header + the matching rows)
function planListClip(m) {
  const x = Math.max(0, Math.floor(m.hdrLeft - 40)), y = Math.max(0, Math.floor(m.hdrTop - 16));
  const width = Math.max(200, Math.floor(m.vw - x - 8));
  const height = Math.min(Math.max(60, Math.ceil(m.rowsBottom - y + 18)), Math.floor(m.vh - y));
  return { x, y, width, height, scale: 1 };
}
// pure: how the list picture and the popup picture are stacked, and where the red boxes land
const TOP_SEP = 8;
function topStackLayout(listPxW, listPxH, listClipW, modalPxW, modalPxH) {
  const k = listPxW / listClipW, sepPx = Math.round(TOP_SEP * k);
  const W = Math.max(listPxW, modalPxW);
  return { k, sepPx, W, H: listPxH + sepPx + modalPxH, yB: listPxH + sepPx, hAcss: listPxH / k, clipW: W / k };
}
function topStackBoxes(lay, listShot, modalHl, tagFail) {
  const rects = [];
  if (tagFail && listShot && listShot.tagRect) rects.push(listShot.tagRect);
  ((modalHl && modalHl.rects) || []).forEach(r => rects.push({ x: r.x, y: r.y + lay.hAcss + TOP_SEP, w: r.w, h: r.h }));
  return rects;
}
// The calendars list holds hundreds of rows, sorted by Updated At and paged by 25: an older calendar is NOT on page 1
// of the plain list, so every lookup opens the list filtered by the calendar id (?term=<id>).
function listUrlFor(navUrl, calId) { return calId ? withTerm(navUrl, calId) : navUrl; }
function withTerm(url, term) {
  try { const u = new URL(url); u.searchParams.set("term", term); return u.toString(); }
  catch (e) { return url + (url.indexOf("?") >= 0 ? "&" : "?") + "term=" + encodeURIComponent(term); }
}
async function debuggerShotList(tabId, calId) {
  if (CAP) CAP.method = "debugger";
  if (!(await dbgAttach(tabId))) { CAP.reason = "debugger attach failed"; return { url: "" }; }
  const T = { tabId }; await dbgTitle(T);
  const expr = "(" + inj_readListRow.toString() + ")(" + JSON.stringify(calId) + ")";
  try {
    await warmShot(T); dbgWarm = tabId;                 // every list page is freshly opened: warm it up first
    for (let attempt = 0; attempt < 3; attempt++) {
      CAP.tries = attempt + 1;
      const bad = async (why) => { CAP.reason = why; CAP.notes.push("list try " + (attempt + 1) + " rejected: " + why); await sleep(350); };
      if (attempt > 0) { progressNote("capture retry " + (attempt + 1) + "/3 (calendar list)"); CAP.notes.push("calendar list capture try " + (attempt + 1) + (attempt === 1 ? " (re-warmed)" : " (tab shown briefly)")); await warmShot(T); }
      await dbgStable(T, 2000);
      // wait until the table stops moving (two identical reads in a row)
      let m = null, prev = null;
      for (let k = 0; k < 8; k++) {
        m = await dbgEval(T, expr);
        if (m && m.found && prev && Math.abs(m.tagRect.y - prev.tagRect.y) < 0.5 && Math.abs(m.rowsBottom - prev.rowsBottom) < 0.5) break;
        prev = (m && m.found) ? m : null; await sleep(250);
      }
      if (!m || !m.found) { await bad("calendar row not found in the list"); continue; }
      const clip = planListClip(m);
      let shot = null;
      try { shot = await capClip(T, tabId, clip, attempt); } catch (e) { await bad("capture error: " + errText(e)); continue; }
      const m2 = await dbgEval(T, expr);
      if (!shot || !shot.data) { await bad("empty capture (list)"); continue; }
      if (!m2 || !m2.found || Math.abs(m2.tagRect.y - m.tagRect.y) > 1) { await bad("list moved during capture"); continue; }
      const url = "data:image/png;base64," + shot.data;
      if (!(await shotSizeOk(url, clip.width, clip.height, m.dpr || 1))) { await bad("wrong image size " + CAP.img + " (list)"); continue; }
      if (await shotTiled(url, true)) { await bad("tiled image rejected (list)"); continue; }
      const rel = r => r ? { x: r.x - clip.x, y: r.y - clip.y, w: r.w, h: r.h } : null;
      CAP.reason = attempt > 0 ? "ok on try " + (attempt + 1) : "";
      return { url, clip, tagRect: rel(m.tagRect), flagRect: rel(m.flagRect) };
    }
    return { url: "" };
  } catch (e) { CAP.reason = "error: " + errText(e); return { url: "" }; }
}
async function stackWithTop(listShot, modalUrl, modalHl, tagFail) {
  const bmA = await createImageBitmap(await (await fetch(listShot.url)).blob());
  const bmB = await createImageBitmap(await (await fetch(modalUrl)).blob());
  const lay = topStackLayout(bmA.width, bmA.height, listShot.clip.width, bmB.width, bmB.height);
  const cv = new OffscreenCanvas(lay.W, lay.H), cx = cv.getContext("2d");
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, lay.W, lay.H);
  cx.drawImage(bmA, 0, 0);
  cx.fillStyle = "#c9ced8"; cx.fillRect(0, bmA.height + Math.floor(lay.sepPx / 2) - 1, lay.W, 2);
  cx.drawImage(bmB, 0, lay.yB);
  const url = abToDataUrl(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { url, hl: { rects: topStackBoxes(lay, listShot, modalHl, tagFail), clipW: lay.clipW } };
}
// ===== KvK calendar-level check: Flag + Tag on the calendar page, events across its programs =====
// Injected into the calendar page: header Flag/Tag (found by column position under their
// labels) and the programs list (id + ev.* ids per row, with on-screen rectangles).
function inj_readCalendarPage(names, keepScroll) {
  var want = {}; (names || []).forEach(function (n) { want[String(n).toLowerCase()] = 1; });
  var ids = document.querySelectorAll("span.cursor-pointer.underline");
  if (!keepScroll) {
    try { window.scrollTo(0, 0); } catch (e) {}
    for (var q = 0; q < ids.length && q < 3; q++) { var a = ids[q].parentElement; while (a) { if (a.scrollTop) a.scrollTop = 0; a = a.parentElement; } }
  }
  var all = document.querySelectorAll("div,span,p,td,th,a"), L = [];
  for (var i = 0; i < all.length; i++) { var e = all[i]; if (e.children.length === 0 && (e.textContent || "").trim()) L.push(e); }
  function rect(el) { var b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }
  function first(t) { for (var k = 0; k < L.length; k++) if ((L[k].textContent || "").trim() === t && L[k].getBoundingClientRect().width) return L[k]; return null; }
  var labs = [];
  ["Flag", "Tag", "Calendar Type", "Notes"].forEach(function (t) { var el = first(t); if (el) labs.push({ t: t, el: el, r: el.getBoundingClientRect() }); });
  labs.sort(function (x, y) { return x.r.left - y.r.left; });
  function under(t) {
    var k = -1; for (var m = 0; m < labs.length; m++) if (labs[m].t === t) k = m;
    if (k < 0) return { v: "", rect: null };
    var lb = labs[k].r, lo = lb.left - 14, hi = (k + 1 < labs.length) ? labs[k + 1].r.left - 6 : lb.left + 320, best = null;
    for (var j = 0; j < L.length; j++) {
      var b = L[j].getBoundingClientRect(), tx = (L[j].textContent || "").trim();
      if (!b.width || !tx) continue;
      if (b.top < lb.bottom - 2 || b.top > lb.bottom + 140) continue;
      if (b.left < lo || b.left >= hi) continue;
      if (!best || b.top < best.b.top - 1 || (Math.abs(b.top - best.b.top) <= 1 && b.left < best.b.left)) best = { el: L[j], b: b, tx: tx };
    }
    return best ? { v: best.tx, rect: rect(best.el) } : { v: "", rect: rect(labs[k].el) };
  }
  var progs = [], seen = {};
  for (var p = 0; p < ids.length; p++) {
    var idEl = ids[p], idText = (idEl.textContent || "").replace(/\s+/g, " ").trim();
    if (!idText || seen[idText]) continue; seen[idText] = 1;
    var best2 = idEl.parentElement, node = idEl.parentElement;
    while (node && node !== document.body) { var c = node.querySelectorAll("span.cursor-pointer.underline").length; if (c === 1) best2 = node; else if (c > 1) break; node = node.parentElement; }
    var evs = []; String(best2.innerText || "").split(/\n+/).forEach(function (ln) { var mm = ln.match(/(?<![A-Za-z0-9._-])ev\.[a-z0-9._-]+/ig); if (mm) mm.forEach(function (x) { x = x.replace(/[._-]+$/, ""); if (evs.indexOf(x) < 0) evs.push(x); }); });
    progs.push({ id: idText, events: evs, rect: rect(best2), want: !!want[idText.toLowerCase()] });
  }
  return JSON.stringify({ flag: under("Flag"), tag: under("Tag"), progs: progs, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 });
}
// exact-token tag compare ("kvk-c033" must NOT match "kvk-c033-b072")
function cmpTagExact(label, expCsv, act) {
  const exp = splitCsv(expCsv); if (!exp.length) return null;
  const have = String(act || "").split(/[,\s]+/).map(norm).filter(Boolean).map(lc);
  const ok = exp.every(t => have.indexOf(lc(t)) >= 0);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp.join(", ") + '" | actual "' + (norm(act) || "(empty)") + '"' };
}
// pure: all calendar-level checks + which page areas to box in red
function calendarChecks(p, info) {
  const checks = []; const push = c => { if (c) checks.push(c); };
  const actFlag = info.flag && info.flag.v || "", actTag = info.tag && info.tag.v || "";
  flagRuleChecks(p.flag, actFlag, "Calendar Flag", !!p.flagCmp).forEach(push);
  if (p.expTag) push(cmpTagExact("Calendar Tag", p.expTag, actTag));
  const wantProgs = (info.progs || []).filter(x => x.want);
  const union = []; wantProgs.forEach(x => x.events.forEach(e => { if (union.map(lc).indexOf(lc(e)) < 0) union.push(e); }));
  const missingProgs = (p.evProgs || []).filter(n => !wantProgs.some(x => lc(x.id) === lc(n)));
  const rows = [];
  if (p.evStrict) {
    const exp = p.evExpected || [];
    const miss = exp.filter(e => union.map(lc).indexOf(lc(e)) < 0);
    const foreign = union.filter(e => exp.map(lc).indexOf(lc(e)) < 0);
    if (!miss.length && !foreign.length) checks.push({ label: "Events", pass: true, line: "\u2705 Events: all " + exp.length + " ticket events (" + p.bracket + ") are in this calendar's programs, no other events \u2014 which field they sit in is checked on each program row" });
    miss.forEach(e => checks.push({ label: "Events", pass: false, line: "\u274C Event '" + e + "' \u2014 MISSING from this ticket's programs on KM (" + p.bracket + ")" }));
    foreign.forEach(e => { const owners = wantProgs.filter(x => x.events.map(lc).indexOf(lc(e)) >= 0).map(x => x.id); owners.forEach(o => rows.push(o)); checks.push({ label: "Events", pass: false, line: "\u274C Event '" + e + "' in " + owners.join(", ") + " is not in the ticket's " + p.bracket + " list" }); });
  } else if ((p.evExpected || []).length) {
    checks.push({ label: "Events", pass: null, line: "Note: events are not verified for " + p.bracket + " (their ids carry no bracket label) \u2014 see each program's report" });
  }
  if (missingProgs.length) checks.push({ label: "Programs", pass: null, line: "Note: not listed on the calendar page: " + missingProgs.join(", ") });
  (p.dataErrors || []).forEach(m => checks.push({ label: "Ticket data", pass: false, line: "\u274C TICKET DATA ERROR \u2014 " + m }));
  const bad = l => checks.some(c => c.pass === false && c.label === l);
  const hl = { flag: bad("Calendar Flag") || checks.some(c => c.flagRule && c.pass === false), tag: bad("Calendar Tag"), rows: rows };
  return { checks, hl, union, wantProgs };
}
// Scroll the ticket's program rows to the middle of the screen (page or inner scroller).
function inj_calScroll(names) {
  var want = {}; (names || []).forEach(function (n) { want[String(n).toLowerCase()] = 1; });
  var ids = document.querySelectorAll("span.cursor-pointer.underline"), hits = [];
  for (var i = 0; i < ids.length; i++) if (want[(ids[i].textContent || "").replace(/\s+/g, " ").trim().toLowerCase()]) hits.push(ids[i]);
  if (!hits.length) return "0";
  hits[Math.floor(hits.length / 2)].scrollIntoView({ block: "center" });
  return "1";
}
// pure: where to cut the two evidence parts (header / ticket rows) and where the red boxes
// land inside the stacked image. Both parts are plain viewport captures (no resizing).
function planCalendarParts(mTop, mRows, hl) {
  const vh = mTop.vh, vw = mTop.vw;
  const ys = (mTop.progs || []).map(q => q.rect.y).filter(y => y > 0);
  const firstY = ys.length ? Math.min.apply(null, ys) : 420;
  const hA = Math.ceil(Math.min(vh, Math.max(320, firstY)));
  const clipA = { x: 0, y: 0, width: Math.ceil(vw), height: hA, scale: 1 };
  const rowsB = ((mRows && mRows.progs) || []).filter(q => q.want);
  let clipB = null;
  if (rowsB.length) {
    const top = Math.max(0, Math.floor(Math.min.apply(null, rowsB.map(q => q.rect.y)) - 30));
    const bottom = Math.min(vh, Math.ceil(Math.max.apply(null, rowsB.map(q => q.rect.y + q.rect.h)) + 20));
    if (bottom - top >= 40) clipB = { x: 0, y: top, width: Math.ceil(vw), height: bottom - top, scale: 1 };
  }
  const sep = 8, rects = [];
  if (hl && hl.flag && mTop.flag && mTop.flag.rect) rects.push(mTop.flag.rect);
  if (hl && hl.tag && mTop.tag && mTop.tag.rect) rects.push(mTop.tag.rect);
  if (clipB) ((hl && hl.rows) || []).forEach(id => { const pr = mRows.progs.find(q => lc(q.id) === lc(id)); if (pr) rects.push({ x: pr.rect.x, y: pr.rect.y - clipB.y + hA + sep, w: pr.rect.w, h: pr.rect.h }); });
  return { clipA, clipB, sep, rects };
}
// Screenshot with escalating strategies: 0 = normal, 1 = normal after a fresh warm-up frame
// (re-warmed by the caller), 2 = briefly show the tab, capture, restore the user's tab.
function errText(e) { return String((e && e.message) || e || "").slice(0, 160); }
// The first frame after a page is opened can be stale: take one throw-away shot, then let it settle.
async function warmShot(T) { try { await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png" }); } catch (e) {} await sleep(300); }
async function capClip(T, tabId, clip, attempt) {
  const params = { format: "png", clip: Object.assign({ scale: 1 }, clip) };   // Chrome rejects a clip without "scale"
  let prevActive = null;
  if (attempt >= 2) {
    try {
      const wt = await chrome.tabs.get(tabId); const act = await chrome.tabs.query({ active: true, windowId: wt.windowId });
      if (act && act[0] && act[0].id !== tabId) prevActive = act[0].id;
      if (!wt.active) { await chrome.tabs.update(tabId, { active: true }); await sleep(450); }
    } catch (e) {}
  }
  try { return await chrome.debugger.sendCommand(T, "Page.captureScreenshot", params); }
  finally { if (prevActive != null) { try { await chrome.tabs.update(prevActive, { active: true }); } catch (e) {} } }
}
async function stackShots(urlA, urlB, sepCss, clipW) {
  const bmA = await createImageBitmap(await (await fetch(urlA)).blob());
  const bmB = urlB ? await createImageBitmap(await (await fetch(urlB)).blob()) : null;
  const k = bmA.width / clipW, sepPx = Math.round(sepCss * k);
  const W = Math.max(bmA.width, bmB ? bmB.width : 0), H = bmA.height + (bmB ? sepPx + bmB.height : 0);
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext("2d");
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, W, H);
  cx.drawImage(bmA, 0, 0);
  if (bmB) { cx.fillStyle = "#c9ced8"; cx.fillRect(0, bmA.height + Math.floor(sepPx / 2) - 1, W, 2); cx.drawImage(bmB, 0, bmA.height + sepPx); }
  return abToDataUrl(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
}
// Evidence for the calendar row = header (Flag / Tag) stacked above the ticket's program
// rows. Plain viewport captures only (resizing the viewport of a hidden tab made Chrome
// return a tiled image); each part is size-checked and rejected if tiled.
async function debuggerShotCalendar(tabId, names, hl) {
  if (CAP) CAP.method = "debugger";
  if (!(await dbgAttach(tabId))) { CAP.reason = "debugger attach failed"; return { url: "" }; }
  const T = { tabId }; await dbgTitle(T);
  const fnSrc = inj_readCalendarPage.toString(), nm = JSON.stringify(names || []);
  const readTop = "(" + fnSrc + ")(" + nm + ", false)", readKeep = "(" + fnSrc + ")(" + nm + ", true)";
  const scrollExpr = "(" + inj_calScroll.toString() + ")(" + nm + ")";
  try {
    await warmShot(T); dbgWarm = tabId;
    const notes = ["normal", "re-warmed", "tab shown briefly"];
    for (let attempt = 0; attempt < 3; attempt++) {
      CAP.tries = attempt + 1;
      if (attempt > 0) { progressNote("capture retry " + (attempt + 1) + "/3"); CAP.notes.push("calendar capture try " + (attempt + 1) + ": " + notes[attempt]); await warmShot(T); }
      await dbgStable(T, 2000);
      const mTop = await dbgEval(T, readTop); if (!mTop || !mTop.progs) { CAP.reason = "calendar page not readable"; return { url: "" }; }
      CAP.viewport = Math.round(mTop.vw) + "x" + Math.round(mTop.vh) + (dbgLock ? " locked" : "");
      const planA = planCalendarParts(mTop, null, hl);
      // part A: header (scrolled to top)
      let shotA = null;
      try { shotA = await capClip(T, tabId, planA.clipA, attempt); } catch (e) { CAP.reason = "capture error: " + errText(e); CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      const mTop2 = await dbgEval(T, readKeep);
      const movedA = !mTop2 || (mTop.flag.rect && mTop2.flag.rect && Math.abs(mTop.flag.rect.y - mTop2.flag.rect.y) > 1);
      if (!shotA || !shotA.data) { CAP.reason = "empty capture"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      if (movedA) { CAP.reason = "page moved during capture"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      const urlA = "data:image/png;base64," + shotA.data;
      if (!(await shotSizeOk(urlA, planA.clipA.width, planA.clipA.height, mTop.dpr || 1))) { CAP.reason = "wrong image size " + CAP.img + " (header)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      if (await shotTiled(urlA, true)) { CAP.reason = "tiled image rejected (header)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      // part B: the ticket's program rows (scrolled into view)
      await dbgEval(T, scrollExpr); await sleep(400);
      const mRows = await dbgEval(T, readKeep);
      const plan = planCalendarParts(mTop, mRows, hl);
      let urlB = "";
      if (plan.clipB) {
        let shotB = null;
        try { shotB = await capClip(T, tabId, plan.clipB, attempt); } catch (e) { CAP.reason = "capture error (rows): " + errText(e); CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        const mRows2 = await dbgEval(T, readKeep);
        const w1 = (mRows.progs || []).filter(q => q.want), w2 = mRows2 && (mRows2.progs || []).filter(q => q.want);
        const movedB = !w2 || !w2.length || !w1.length || Math.abs(w2[0].rect.y - w1[0].rect.y) > 1;
        if (!shotB || !shotB.data) { CAP.reason = "empty capture (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        if (movedB) { CAP.reason = "page moved during capture (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        urlB = "data:image/png;base64," + shotB.data;
        if (!(await shotSizeOk(urlB, plan.clipB.width, plan.clipB.height, mTop.dpr || 1))) { CAP.reason = "wrong image size " + CAP.img + " (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        if (await shotTiled(urlB, true)) { CAP.reason = "tiled image rejected (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      }
      try { await dbgEval(T, readTop); } catch (e) {} // leave the page scrolled to the top
      const url = await stackShots(urlA, urlB, plan.sep, plan.clipA.width);
      CAP.reason = attempt > 0 ? CAP.reason + " -> ok on try " + (attempt + 1) : "";
      return { url, hl: { rects: plan.rects, clipW: plan.clipA.width } };
    }
    return { url: "" };
  } catch (e) { CAP.reason = "error: " + ((e && e.message) || e); return { url: "" }; }
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
async function checkOneCase(tabId, p, navUrl, navFresh) {
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

// ===== BATCH: run many cases sequentially in one work tab =====
let RUN = { active: false, mode: "", saveMode: "", progress: null, result: null, at: 0 };
// ---- run log (saved only when something went wrong: retry / fallback / no image / error)
function rowHasIssue(r) {
  const d = r.capDiag || {};
  return r.status !== "DONE" || r.overall === "FAIL" || !(r.savedAs || r.imageDataUrl) || r.savedFallback || (d.tries || 0) > 1 || (d.method && d.method !== "debugger");
}
function buildLog(ticket, rows) {
  const pad = (x, n) => { x = String(x == null ? "" : x); return x.length >= n ? x : x + " ".repeat(n - x.length); };
  const L = ["CalCheck log \u2014 " + (ticket || "(no ticket)") + " \u2014 " + new Date().toLocaleString() + " \u2014 v" + chrome.runtime.getManifest().version];
  rows.forEach((r, k) => {
    const d = r.capDiag || {};
    let line = "[" + (k + 1) + "/" + rows.length + "] " + pad(r.progId, 28) + " " + pad(r.status === "DONE" ? r.overall : "ERR", 5)
      + "  capture=" + pad(d.method || "-", 11) + " img=" + pad(d.img || "-", 10) + " tries=" + (d.tries || 0);
    if (d.viewport) line += "  vp=" + d.viewport;
    if (d.tile) line += "  tile=" + d.tile;
    if (d.reason) line += "  (" + d.reason + ")";
    L.push(line);
    (d.notes || []).forEach(n => L.push("      note: " + n));
    (r.resultLines || []).filter(l => l.pass === false).forEach(l => L.push("      fail: " + l.line));
    const okL = []; (r.resultLines || []).filter(l => l.pass === true).forEach(l => { const lab = String(l.line).replace(/^[^A-Za-z]+/, "").match(/^(?:Calendar )?[A-Za-z][A-Za-z -]*?(?=\s*(?::|'|\u2014|\s\())/); const nm = (lab ? lab[0] : String(l.line).slice(0, 18)).trim(); okL.push(nm); });
    if (okL.length) { const cnt = {}; okL.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; }); L.push("      ok: " + Object.keys(cnt).map(k => k + (cnt[k] > 1 ? " x" + cnt[k] : "")).join(", ")); }
    if (r.status !== "DONE" && r.message) L.push("      error: " + String(r.message).replace(/\n/g, " | "));
    if (r.shotErr) L.push("      screenshot: " + r.shotErr);
  });
  return L.join("\n");
}
// ---- saving: chosen folder via the offscreen writer (no popup needed); Downloads fallback
async function ensureOffscreen() {
  try {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return true;
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Write evidence screenshots into the folder the user chose." });
    return true;
  } catch (e) { return /single offscreen|only a single|already/i.test(String((e && e.message) || e)); }
}
async function closeOffscreen() { try { if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); } catch (e) {} }
function safeName(x) { return String(x || "").replace(/[\/\\:*?"<>|]+/g, "_").trim(); }
async function saveImage(p, baseName, dataUrl) {
  const base = safeName(baseName) || "calcheck";
  if (p.saveMode === "folder") {
    let r = null;
    if (await ensureOffscreen()) {
      try { r = await chrome.runtime.sendMessage({ target: "offscreen", type: "writeFile", name: base + ".png", dataUrl }); }
      catch (e) { r = { ok: false, reason: String((e && e.message) || e) }; }
    }
    if (r && r.ok) return { savedAs: r.name + "  ->  " + r.folder + " (chosen folder)", fallback: false };
    if (CAP) CAP.notes.push("folder write failed (" + ((r && r.reason) || "offscreen writer unavailable") + ") -> saved to Downloads/CalCheck");
  }
  const fname = "CalCheck/" + base + ".png";
  await chrome.downloads.download({ url: dataUrl, filename: fname, conflictAction: "uniquify", saveAs: false });
  return { savedAs: fname, fallback: p.saveMode === "folder" };
}
function logStamp() { const d = new Date(), z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + z(d.getMinutes()); }
async function saveLog(ticket, text) {
  const name = "CalCheck/CalCheck_log_" + (ticket || "run").replace(/[^A-Za-z0-9._-]+/g, "_") + "_" + logStamp() + ".txt";
  try { await chrome.downloads.download({ url: "data:text/plain;charset=utf-8," + encodeURIComponent(text), filename: name, conflictAction: "uniquify", saveAs: false }); return name; }
  catch (e) { return ""; }
}
// ---- Method 2: capture via chrome.debugger (CDP). Works on a hidden tab with no
// tab flicker; attaches once per run (one "debugging" banner), detaches at the end.
let dbgTab = null, dbgWarm = null, dbgLock = null;
// capture diagnostics of the last screenshot (for the log / badges) + current case
let CAP = null, CUR = { i: 1, n: 1, progId: "" };
function capReset() { CAP = { method: "", tries: 0, reason: "", img: "", viewport: "", tile: "", notes: [] }; }
function progressNote(note) {
  try { if (RUN && RUN.progress) RUN.progress.note = note; } catch (e) {}
  try { chrome.runtime.sendMessage({ type: "batchProgress", i: CUR.i, n: CUR.n, progId: CUR.progId, phase: "running", note }); } catch (e) {}
}
const TITLE_SET = "(function(){if(document.title.indexOf('CalCheck running')<0)window.__ccTitle=document.title;document.title='\u23F3 CalCheck running \u2014 do not use';})()";
const TITLE_RESTORE = "(function(){if(window.__ccTitle)document.title=window.__ccTitle;})()";
async function dbgTitle(T) { try { await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: TITLE_SET }); } catch (e) {} }
async function dbgAttach(tabId) {
  if (dbgTab === tabId) return true;
  if (dbgTab != null) await dbgDetach();
  try { await chrome.debugger.attach({ tabId }, "1.3"); await chrome.debugger.sendCommand({ tabId }, "Page.enable", {}); dbgTab = tabId; dbgWarm = null; return true; }
  catch (e) { dbgTab = null; return false; }
}
async function dbgDetach() {
  if (dbgTab == null) return;
  const t = dbgTab, T = { tabId: t }; dbgTab = null; dbgWarm = null; dbgLock = null;
  try { await chrome.debugger.sendCommand(T, "Input.setIgnoreInputEvents", { ignore: false }); } catch (e) {}
  try { await chrome.debugger.sendCommand(T, "Emulation.clearDeviceMetricsOverride", {}); } catch (e) {}
  try { await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: TITLE_RESTORE }); } catch (e) {}
  try { await chrome.debugger.detach({ tabId: t }); } catch (e) {}
}
// Wait until the viewport size stops changing (3 equal reads ~150ms apart). The
// debugging banner appears asynchronously after attach and resizes the viewport.
async function dbgStable(T, maxMs) {
  let prev = null, same = 0; const t0 = Date.now();
  while (Date.now() - t0 < (maxMs || 3000)) {
    let v = null; try { v = await dbgEval(T, "JSON.stringify({w:window.innerWidth,h:window.innerHeight})"); } catch (e) {}
    if (v && prev && v.w === prev.w && v.h === prev.h) { if (++same >= 2) return true; } else same = 0;
    prev = v; await sleep(150);
  }
  return false;
}
// Attach at run start (before the first popup is opened) and give the banner time to land.
async function dbgEarly(tabId) {
  try {
    if (!(await dbgAttach(tabId))) return;
    const T = { tabId };
    await sleep(900); await dbgStable(T, 2500);
    // Lock the viewport size AND device-pixel-ratio for the whole run so layout and
    // capture always use the same scale (a never-shown tab otherwise renders its
    // first frame at x1 while laying out at x2 -> tiled/offset first screenshot).
    const v = await dbgEval(T, "JSON.stringify({w:window.innerWidth,h:window.innerHeight,dpr:window.devicePixelRatio||1})");
    if (v && v.w && v.h) {
      await chrome.debugger.sendCommand(T, "Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: false });
      dbgLock = { w: v.w, h: v.h, dpr: v.dpr };
      await sleep(300);
    }
    // Block the user's mouse/keyboard on this tab (the tool drives the page from inside,
    // not via input events, so it keeps working); mark the tab title.
    try { await chrome.debugger.sendCommand(T, "Input.setIgnoreInputEvents", { ignore: true }); } catch (e) {}
    await dbgTitle(T);
  } catch (e) {}
}
async function dbgEval(T, expr) {
  const ev = await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: expr, returnByValue: true });
  const v = ev && ev.result ? ev.result.value : null;
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
// Size check: a good capture is clip size x devicePixelRatio (or x1).
async function shotSizeOk(dataUrl, w, h, dpr) {
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    if (CAP) CAP.img = bmp.width + "x" + bmp.height;
    const near = (a, b) => Math.abs(a - b) <= Math.max(4, b * 0.02);
    return (near(bmp.width, w * dpr) && near(bmp.height, h * dpr)) || (near(bmp.width, w) && near(bmp.height, h));
  } catch (e) { return false; }
}
// Tiled-image guard: a duplicated capture has identical left/right (or top/bottom)
// halves. Compare the halves on a small downscale; ~0 difference = tiled -> reject.
async function shotTiled(dataUrl, both) {
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const W = 96, H = 96, c = new OffscreenCanvas(W, H), x = c.getContext("2d");
    x.drawImage(bmp, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, at = (i, j) => (j * W + i) * 4;
    const diff = (p, q) => (Math.abs(d[p] - d[q]) + Math.abs(d[p + 1] - d[q + 1]) + Math.abs(d[p + 2] - d[q + 2])) / 3;
    let lr = 0, tb = 0, n1 = 0, n2 = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W / 2; i++) { lr += diff(at(i, j), at(i + W / 2, j)); n1++; }
    for (let j = 0; j < H / 2; j++) for (let i = 0; i < W; i++) { tb += diff(at(i, j), at(i, j + H / 2)); n2++; }
    lr /= n1; tb /= n2;
    if (CAP) CAP.tile = lr.toFixed(1) + "/" + tb.toFixed(1);
    return both ? (lr < 1.5 && tb < 1.5) : (lr < 1.5 || tb < 1.5);
  } catch (e) { return false; }
}
// Capture the KM popup via CDP without touching the page layout. Viewport + DPR are
// locked for the run (dbgEarly); each try waits for a stable viewport, measures,
// captures, re-measures, and rejects moved / wrong-size / tiled images (max 3 tries).
// Program picture: the whole visible page (breadcrumb "Design / Calendars / <calendar> / <flag>", the
// dimmed background and the popup) so the picture itself shows which calendar is being checked.
// If a full-page shot is rejected twice, the last try falls back to the popup only.
const FULL_PAGE_SHOT = true;
async function debuggerShotModal(tabId, labels) {
  lastHl = null;
  if (CAP) CAP.method = "debugger";
  if (!(await dbgAttach(tabId))) { if (CAP) CAP.reason = "debugger attach failed"; return ""; }
  const T = { tabId };
  await dbgTitle(T);
  const measure = "(function(){var r=document.querySelector('.MuiDialog-paper');if(!r)return 'null';var b=r.getBoundingClientRect();var ov=Math.max(0,r.scrollHeight-r.clientHeight),e=r.querySelectorAll('*');for(var i=0;i<e.length;i++){var x=e[i];if(x.scrollHeight>x.clientHeight+2){var oy=getComputedStyle(x).overflowY;if(oy==='auto'||oy==='scroll')ov=Math.max(ov,x.scrollHeight-x.clientHeight);}}return JSON.stringify({x:b.left+window.scrollX,y:b.top+window.scrollY,w:b.width,h:b.height,sh:r.scrollHeight,ov:ov,vw:window.innerWidth,vh:window.innerHeight,dpr:window.devicePixelRatio||1});})()";
  // last resort only: unclip inner scroll areas (restored right after the capture)
  const EXPAND = "(function(){var s=[],r=document.querySelector('.MuiDialog-paper');if(!r)return 0;var e=[r].concat([].slice.call(r.querySelectorAll('*')));e.forEach(function(x){if(x.scrollHeight>x.clientHeight+2){var oy=getComputedStyle(x).overflowY;if(oy==='auto'||oy==='scroll'||x===r){s.push([x,x.style.overflow,x.style.maxHeight,x.style.height]);x.style.overflow='visible';x.style.maxHeight='none';x.style.height='auto';}}});window.__ccExp=s;return s.length;})()";
  const UNEXPAND = "(function(){var s=window.__ccExp||[];s.forEach(function(a){a[0].style.overflow=a[1];a[0].style.maxHeight=a[2];a[0].style.height=a[3];});window.__ccExp=null;return s.length;})()";
  let overridden = false, expanded = false;
  try {
    let m = await dbgEval(T, measure);
    if (!m || !m.w || !m.h) { CAP.reason = "popup not found"; return ""; }
    CAP.viewport = Math.round(m.vw) + "x" + Math.round(m.vh) + " @" + m.dpr + "x" + (dbgLock ? " locked" : "");
    if (m.ov > 2 || m.sh > m.h + 2 || m.h > m.vh - 8) {
      // popup body scrolls inside the popup -> make the viewport taller by the hidden
      // part; the KM popup grows with the window, so all rows become visible
      const H = Math.ceil(m.vh + Math.max(m.ov, m.sh - m.h, 0) + 120);
      await chrome.debugger.sendCommand(T, "Emulation.setDeviceMetricsOverride", { width: dbgLock ? dbgLock.w : Math.ceil(m.vw), height: H, deviceScaleFactor: dbgLock ? dbgLock.dpr : 0, mobile: false });
      overridden = true; CAP.notes.push("popup had hidden rows (" + Math.round(m.ov) + "px) -> viewport enlarged to " + H + "px");
      await sleep(450); await dbgStable(T, 2000);
      m = await dbgEval(T, measure);
      if (!m || !m.w || !m.h) { CAP.reason = "popup not found after enlarge"; return ""; }
      if (m.ov > 2) {
        const n = await dbgEval(T, "JSON.stringify(" + EXPAND + ")");
        expanded = true; CAP.notes.push("still " + Math.round(m.ov) + "px hidden after enlarge -> unclipped " + n + " scroll area(s)");
        await sleep(350); await dbgStable(T, 2000);
        m = await dbgEval(T, measure);
        if (!m || !m.w || !m.h) { CAP.reason = "popup not found after unclip"; return ""; }
      }
    }
    if (dbgWarm !== tabId) {
      try { await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png" }); } catch (e) {}
      dbgWarm = tabId;
      await sleep(250);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      CAP.tries = attempt + 1;
      if (attempt > 0) progressNote("capture retry " + (attempt + 1) + "/3");
      await dbgStable(T, 2500);
      const m1 = await dbgEval(T, measure);
      if (!m1 || !m1.w || !m1.h) { CAP.reason = "popup not found"; return ""; }
      const full = FULL_PAGE_SHOT && attempt < 2;       // tries 1-2: whole page; try 3: popup only
      if (FULL_PAGE_SHOT && attempt === 2) CAP.notes.push("full-page picture rejected twice -> popup only");
      const clip = full ? { x: 0, y: 0, width: Math.ceil(m1.vw), height: Math.ceil(m1.vh), scale: 1 }
        : { x: Math.max(0, Math.floor(m1.x)), y: Math.max(0, Math.floor(m1.y)), width: Math.ceil(m1.w), height: Math.ceil(m1.h), scale: 1 };
      const shot = await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png", clip });
      const m2 = await dbgEval(T, measure);
      const moved = !m2 || Math.abs(m2.x - m1.x) > 1 || Math.abs(m2.y - m1.y) > 1 || Math.abs(m2.w - m1.w) > 1 || Math.abs(m2.h - m1.h) > 1;
      if (!shot || !shot.data) { CAP.reason = "empty capture"; await sleep(350); continue; }
      if (moved) { CAP.reason = "popup moved during capture"; await sleep(350); continue; }
      const url = "data:image/png;base64," + shot.data;
      if (!(await shotSizeOk(url, clip.width, clip.height, m1.dpr))) { CAP.reason = "wrong image size " + CAP.img; await sleep(350); continue; }
      if (await shotTiled(url, full)) { CAP.reason = "tiled image rejected"; await sleep(350); continue; }
      CAP.reason = attempt > 0 ? CAP.reason + " -> ok on try " + (attempt + 1) : "";
      if (labels && labels.length) {
        try {
          const rects = await dbgEval(T, "JSON.stringify((" + HL_FN + ")(" + JSON.stringify(labels) + "))");
          // the boxes are measured from the popup's corner; in a full-page picture the popup sits at (m1.x, m1.y)
          lastHl = { rects: (rects || []).map(r => full ? { x: r.x + m1.x, y: r.y + m1.y, w: r.w, h: r.h } : r), clipW: clip.width };
        } catch (e) {}
      }
      return url;
    }
    return "";
  } catch (e) { CAP.reason = "error: " + ((e && e.message) || e); return ""; }
  finally {
    if (expanded) { try { await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: UNEXPAND }); } catch (e) {} }
    if (overridden) {
      try {
        if (dbgLock) await chrome.debugger.sendCommand(T, "Emulation.setDeviceMetricsOverride", { width: dbgLock.w, height: dbgLock.h, deviceScaleFactor: dbgLock.dpr, mobile: false });
        else await chrome.debugger.sendCommand(T, "Emulation.clearDeviceMetricsOverride", {});
      } catch (e) {}
    }
  }
}
function abToDataUrl(buf) { const bytes = new Uint8Array(buf); let bin = ""; const ch = 0x8000; for (let i = 0; i < bytes.length; i += ch) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + ch)); return "data:image/png;base64," + btoa(bin); }
// Compose the text report (verdict + check lines + actual data) above the modal
// screenshot, entirely in the service worker via OffscreenCanvas.
// text size follows the picture width (a wide full-page picture gets bigger text); the final image is
// scaled down to at most REPORT_MAX_W pixels wide to keep the files small
const REPORT_MAX_W = 2400;
function reportScale(imgPxW) { return Math.min(4, Math.max(2, (imgPxW || 0) / 1000)); }
function reportOutSize(w, h) { const f = w > REPORT_MAX_W ? REPORT_MAX_W / w : 1; return { w: Math.round(w * f), h: Math.round(h * f), f }; }
async function composeReport(modalDataUrl, payload, hl) {
  let bmp = null, mw = 0, mh = 0;
  try { const blob = await (await fetch(modalDataUrl)).blob(); bmp = await createImageBitmap(blob); mw = bmp.width; mh = bmp.height; } catch (e) {}
  const S = reportScale(mw), pad = 22 * S;
  const vc = payload.overall === "PASS" ? "#0a7d28" : payload.overall === "FAIL" ? "#c0392b" : "#555";
  const head = [{ t: "CalCheck \u2014 RESULT: " + payload.overall, b: true, s: 19, c: vc }, { t: "Program: " + (payload.progId || "") + "  (" + (payload.ts || "") + ")", s: 12, c: "#555" }, { t: "", s: 6 }];
  (payload.resultLines || []).forEach(l => head.push({ t: l.line, s: 13, b: !!l.bold, c: l.pass === false ? "#c0392b" : l.pass === true ? "#0a7d28" : (l.bold ? "#222" : "#555") }));
  head.push({ t: "", s: 6 });
  (payload.actualLines || []).forEach(l => head.push({ t: l, s: 12, c: "#555" }));
  const lh = o => (o.s || 14) * S * 1.5;
  const headerH = Math.round(pad * 2 + head.reduce((a, o) => a + lh(o), 0));
  const W = Math.max(mw, 1000 * S);
  const canvas = new OffscreenCanvas(W, headerH + mh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textBaseline = "top";
  let y = pad;
  for (const o of head) { const sz = (o.s || 14) * S; ctx.fillStyle = o.c || "#333"; ctx.font = (o.b ? "700 " : "") + sz + "px -apple-system, system-ui, Arial, sans-serif"; if (o.t) ctx.fillText(o.t, pad, y); y += lh(o); }
  if (bmp) { ctx.strokeStyle = "#e0e0e0"; ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(canvas.width, headerH); ctx.stroke(); ctx.drawImage(bmp, 0, headerH); }
  // red boxes around the failed fields of the KM popup
  if (bmp && hl && hl.rects && hl.rects.length) {
    const k = bmp.width / (hl.clipW || bmp.width);
    ctx.strokeStyle = "#e01e1e"; ctx.lineWidth = Math.max(3, Math.round(2.5 * k));
    hl.rects.forEach(r => ctx.strokeRect(r.x * k + 2, headerH + r.y * k + 2, Math.max(4, r.w * k - 4), Math.max(4, r.h * k - 4)));
  }
  const osz = reportOutSize(canvas.width, canvas.height);
  let outCanvas = canvas;
  if (osz.f < 1) { outCanvas = new OffscreenCanvas(osz.w, osz.h); const c2 = outCanvas.getContext("2d"); c2.imageSmoothingQuality = "high"; c2.drawImage(canvas, 0, 0, osz.w, osz.h); }
  const outBlob = await outCanvas.convertToBlob({ type: "image/png" });
  return abToDataUrl(await outBlob.arrayBuffer());
}
async function captureShot(tabId, payload) {
  capReset();
  (payload.preNotes || []).forEach(n => CAP.notes.push(n));
  // Primary: chrome.debugger capture (no flicker, works on a hidden tab).
  try { const modal = await debuggerShotModal(tabId, payload.highlight); if (modal) {
      let img = modal, hl = lastHl;
      if (payload.listShot && payload.listShot.url) { try { const st = await stackWithTop(payload.listShot, modal, lastHl, !!payload.tagFail); img = st.url; hl = st.hl; } catch (e) { CAP.notes.push("could not stack the list picture: " + ((e && e.message) || e)); } }
      const composed = await composeReport(img, payload, hl); if (composed) return composed; CAP.reason = "compose failed"; } } catch (e) { CAP.reason = "error: " + ((e && e.message) || e); }
  CAP.notes.push("debugger capture failed (" + (CAP.reason || "unknown") + ")");
  CAP.method = "html2canvas";
  // Fallback: html2canvas (needs the tab visible for an instant).
  let prevActiveId = null;
  try { const wt = await chrome.tabs.get(tabId); const act = await chrome.tabs.query({ active: true, windowId: wt.windowId }); if (act && act[0] && act[0].id !== tabId) prevActiveId = act[0].id; if (!wt.active) { await chrome.tabs.update(tabId, { active: true }); await sleep(260); } } catch (e) {}
  let dataUrl = "";
  try { await injectFile(tabId, "lib/html2canvas.min.js"); dataUrl = await exec(tabId, inj_shot, [payload]); } catch (e) { dataUrl = ""; }
  try { if (prevActiveId != null) await chrome.tabs.update(prevActiveId, { active: true }); } catch (e) {}
  if (!(typeof dataUrl === "string" && dataUrl.indexOf("data:image/png") === 0)) { CAP.method = "none"; CAP.notes.push("html2canvas fallback failed"); }
  return dataUrl;
}
// Keep the MV3 service worker alive while a run is in progress even if the popup
// is closed: a repeating alarm wakes the worker so long sleeps don't kill the run.
try { chrome.alarms.onAlarm.addListener(() => { /* wake only */ }); } catch (e) {}
function keepAlive(on) {
  try {
    if (on) chrome.alarms.create("calcheck-keepalive", { periodInMinutes: 0.4 });
    else chrome.alarms.clear("calcheck-keepalive");
  } catch (e) {}
}
async function runBatch(payload) {
  // payload: { url, saveMode, cases:[{calId,progId,flag,event,tags,date,time,pre,dur,post}] }
  let navUrl = (payload.url || "").trim();
  if (!navUrl) navUrl = "https://" + DESIGN_HOST + "/design/calendars";
  let host = ""; try { host = new URL(navUrl).host; } catch (e) { return { status: "ERROR", message: "Invalid URL: " + navUrl }; }
  const cases = payload.cases || [];
  if (!cases.length) return { status: "ERROR", message: "No cases to run." };

  let tabId;
  try { tabId = await ensureWorkTab(navUrl); }
  catch (e) { return { status: "ERROR", message: "Cannot open tab: " + (e.message || e) }; }
  await dbgEarly(tabId);
  await waitTabComplete(tabId, 25000);
  await sleep(800);

  let curUrl = "";
  try { curUrl = await exec(tabId, inj_url); }
  catch (e) { return { status: "ERROR", message: "Cannot access page. Check host_permissions for: " + host }; }
  if (curUrl.indexOf("/login") >= 0 || curUrl.indexOf(host) < 0) {
    try { await chrome.tabs.update(tabId, { active: true }); } catch (e) {}
    notify("CalCheck — Login required", "Sign in on the opened tab, then run again.");
    return { status: "LOGIN", message: "Not signed in. A tab was opened — sign in, then run again." };
  }

  const summary = [];
  let prevCal = "";
  for (let i = 0; i < cases.length; i++) {
    const c = Object.assign({ url: navUrl, saveMode: payload.saveMode }, cases[i]);
    CUR = { i: i + 1, n: cases.length, progId: c.progId };
    // progress ping to popup (best-effort)
    RUN.progress = { i: i + 1, n: cases.length, progId: c.progId, phase: "running" };
    try { chrome.runtime.sendMessage({ type: "batchProgress", i: i + 1, n: cases.length, progId: c.progId, phase: "running" }); } catch (e) {}

    // reuse the same calendar's program list when calId unchanged: close modal instead of full reload
    let res;
    if (c.calId && c.calId === prevCal) {
      try { await exec(tabId, inj_closeModal); } catch (e) {}
      await sleep(400);
      res = await checkOneCase(tabId, c, navUrl, false);
      if (res.status === "FAIL_STEP" && res.step === "Program") {
        // maybe list changed; retry once with a fresh navigation
        res = await checkOneCase(tabId, c, navUrl, true);
      }
    } else {
      res = await checkOneCase(tabId, c, navUrl, true);
    }
    prevCal = c.calId || prevCal;

    const row = {
      progId: c.progId, calId: c.calId,
      status: res.status, overall: res.overall || (res.status === "DONE" ? "N/A" : "ERROR"),
      passCount: res.passCount || 0, failCount: res.failCount || 0,
      message: res.message || "", savedAs: res.savedAs || "", shotErr: res.shotErr || "",
      resultLines: res.resultLines || [], imageDataUrl: res.imageDataUrl || "", shotName: res.shotName || "",
      capDiag: res.capDiag || null, savedFallback: !!res.savedFallback, calCheck: !!c.calCheck
    };
    summary.push(row);
    if (row.status === "DONE" && !row.savedAs && !row.imageDataUrl) notify("CalCheck \u2014 screenshot failed", "No screenshot saved for " + row.progId + " (see log).");
    // stream the finished case (incl. image for folder-mode writing in popup)
    RUN.progress = { i: i + 1, n: cases.length, progId: c.progId, phase: "done" };
    try { chrome.runtime.sendMessage({ type: "batchProgress", i: i + 1, n: cases.length, progId: c.progId, phase: "done", row }); } catch (e) {}
  }

  const pass = summary.filter(r => r.overall === "PASS").length;
  const fail = summary.filter(r => r.overall === "FAIL").length;
  const err = summary.filter(r => r.status !== "DONE").length;
  notify("CalCheck batch done", pass + " PASS, " + fail + " FAIL" + (err ? ", " + err + " err" : ""));
  const logText = buildLog(payload.ticket, summary);
  const logSaved = summary.some(rowHasIssue) ? await saveLog(payload.ticket, logText) : "";
  return { status: "BATCH_DONE", total: cases.length, pass, fail, err, summary, logText, logSaved };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "runCheck") {
    RUN = { active: true, mode: "single", saveMode: (msg.payload && msg.payload.saveMode) || "downloads", progress: { phase: "running" }, result: null, at: Date.now() };
    keepAlive(true);
    runCheck(msg.payload).then(res => { RUN = { active: false, mode: "single", saveMode: RUN.saveMode, progress: null, result: res, at: Date.now() }; keepAlive(false); dbgDetach(); closeOffscreen(); sendResponse(res); })
      .catch(err => { const e = { status: "ERROR", message: (err && err.message) ? err.message : String(err) }; RUN = { active: false, mode: "single", saveMode: RUN.saveMode, progress: null, result: e, at: Date.now() }; keepAlive(false); dbgDetach(); sendResponse(e); });
    return true;
  }
  if (msg && msg.action === "runBatch") {
    RUN = { active: true, mode: "batch", saveMode: (msg.payload && msg.payload.saveMode) || "downloads", progress: { i: 0, n: (msg.payload && msg.payload.cases || []).length }, result: null, at: Date.now() };
    keepAlive(true);
    runBatch(msg.payload).then(res => { RUN.active = false; RUN.progress = null; RUN.result = res; RUN.at = Date.now(); keepAlive(false); dbgDetach(); sendResponse(res); })
      .catch(err => { const e = { status: "ERROR", message: (err && err.message) ? err.message : String(err) }; RUN.active = false; RUN.progress = null; RUN.result = e; RUN.at = Date.now(); keepAlive(false); dbgDetach(); sendResponse(e); });
    return true;
  }
  if (msg && msg.action === "getRunState") { sendResponse(RUN); return true; }
  if (msg && msg.action === "clearRunState") { RUN = { active: false, mode: "", saveMode: "", progress: null, result: null, at: 0 }; sendResponse({ ok: true }); return true; }
  if (msg && msg.action === "closeWorkTab") {
    chrome.storage.session.get("workTabId").then(({ workTabId }) => {
      if (workTabId != null) { try { chrome.tabs.remove(workTabId); } catch (e) {} }
      chrome.storage.session.remove("workTabId");
      sendResponse({ ok: true });
    });
    return true;
  }
});
