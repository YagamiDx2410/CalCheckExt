// Expected (ticket) vs actual (KM) comparisons -> check rows (pure).
import { parseDateParts, parseTimeToken, whenEntries, whenShow } from "./dates.js";
import { durSeconds, isBlankKM } from "./duration.js";
import { evDay, evKindOfEvent, evKindOfProg, evLev, fieldIds, gluedParts, hasId, idWhy } from "./ids.js";
import { lc, norm, safeName, splitCsv } from "./text.js";

// ---------- comparison (English) ----------
export function cmpExact(label, exp, act) {
  if (!exp) return null;
  const ok = lc(exp) === lc(act);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + act + '"' };
}

// Pre / Duration / Post: compare the VALUE (spaces, case and unit layout are ignored)
export function cmpDuration(label, exp, act) {
  if (!exp) return null;
  const e = durSeconds(exp), a = durSeconds(act);
  const ok = (e != null && a != null) ? e === a : lc(exp).replace(/\s+/g, "") === lc(act).replace(/\s+/g, "");
  const sameText = lc(exp) === lc(act);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + act + '"' + (ok && !sameText ? " (same duration)" : "") };
}

export function cmpDurField(label, exp, act, strict) {
  if (exp) return cmpDuration(label, exp, act);
  if (!strict) return null;
  const ok = isBlankKM(act);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected empty | actual "' + (norm(act) || "(empty)") + '"' };
}

export function cmpContains(label, exp, act) {
  if (!exp) return null;
  const ok = lc(act).indexOf(lc(exp)) >= 0;
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': "' + exp + '"' + (ok ? " (found in: " + act + ")" : ' NOT found in "' + act + '"') };
}

export function cmpMulti(label, expCsv, actJoined) {
  const exp = splitCsv(expCsv);
  if (!exp.length) return [];
  return exp.map(e => {
    const ok = lc(actJoined).indexOf(lc(e)) >= 0;
    return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + (ok ? " has: " : " MISSING: ") + e };
  });
}

export function cmpTime(label, exp, whenAct) {
  if (!exp) return null;
  const e = parseTimeToken(exp), a = parseTimeToken(whenAct);
  let ok = false, note = "";
  if (e && a) {
    ok = e.sec === a.sec;
    if (ok && e.tz && a.tz && e.tz !== a.tz) { ok = false; note = " (timezone differs: " + e.tz + " vs " + a.tz + ")"; }
  } else if (!a) { note = " (no time found on KM)"; }
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp + '" | actual "' + whenAct + '"' + note };
}

export function cmpWhen(expDate, expTime, when) {
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

export function cmpDate(label, exp, whenAct) {
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
export function cmpPlacement(label, coc, ccids, evids) {
  if (!coc) return null;
  const inCC = lc(ccids).indexOf(lc(coc)) >= 0;
  const inEV = lc(evids).indexOf(lc(coc)) >= 0;
  const ok = inCC && !inEV;
  let note = "";
  if (inEV) note = " (found under Event IDs \u2014 must be County Config IDs)";
  else if (!inCC) note = " (not found in County Config IDs)";
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ": " + coc + note };
}

export function cmpInField(label, token, correctName, correctVal, others, expectedAll) {
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

export function cmpInFieldMulti(label, expCsv, correctName, correctVal, others) {
  const all = splitCsv(expCsv);
  return all.map(tok => cmpInField(label, tok, correctName, correctVal, others, all)).filter(Boolean);
}

// Global: only enforced when the ticket says yes. Ticket no/empty -> default no, pass.
export function cmpGlobal(expYesNo, actGlobal) {
  const exp = lc(expYesNo);
  if (exp !== "yes") return null; // ticket has no "yes" -> not checked
  const actYes = /^\s*yes\b/i.test(actGlobal || "");
  return { label: "Global", pass: actYes, line: (actYes ? "\u2705 " : "\u274C ") + 'Global: expected "Yes" | actual "' + (actGlobal || "(empty)") + '"' };
}

// Repeats: KM shows "Every N day" / "Every N days". Compare the interval number.
export function cmpRepeatEvery(expInterval, actRepeats) {
  if (!expInterval) return null;
  const m = String(actRepeats || "").match(/every\s+(\d+)\s*day/i);
  const actN = m ? parseInt(m[1], 10) : null;
  const ok = actN === Number(expInterval);
  return { label: "Repeats", pass: ok, line: (ok ? "\u2705 " : "\u274C ") + 'Repeats: expected "Every ' + expInterval + ' day' + (Number(expInterval) === 1 ? "" : "s") + '" | actual "' + (String(actRepeats || "").replace(/\s*\n\s*/g, " / ") || "(empty)") + '"' };
}

// Ends after: KM shows "N occurrences" (own field, and inside the Repeats cell).
export function cmpEndsAfter(expOcc, actEndsAfter, actRepeats) {
  if (!expOcc) return null;
  let m = String(actEndsAfter || "").match(/(\d+)\s*occurrence/i);
  if (!m) m = String(actRepeats || "").match(/ends?\s*after\s*(\d+)\s*occurrence/i);
  const actN = m ? parseInt(m[1], 10) : null;
  const ok = actN === Number(expOcc);
  return { label: "Ends after", pass: ok, line: (ok ? "\u2705 " : "\u274C ") + 'Ends after: expected "' + expOcc + ' occurrences" | actual "' + (actEndsAfter || actRepeats || "(empty)") + '"' };
}

// ===== Flag rule (always on): every program needs a real flag (not tbd / ignore) =====
export function flagRuleChecks(expFlag, actFlag, what, compare) {
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
export function failPrefix(overall, checks) {
  if (overall !== "FAIL") return "";
  const fr = (checks || []).find(c => c.flagRule && c.pass === false);
  return "FAILED - " + (fr ? "flag-" + safeName(fr.flagBad || "empty") + " - " : "");
}

// KM popup fields to box in red, from the failed checks
export const FIELD_OF = { "Flag": "__flag", "Event ID": "Event IDs", "Package Tag": "Package Tags", "County Config ID": "County Config IDs", "Calendar ID": "Calendar IDs", "Shard Tag": "Shard Tag", "Date": "When", "Time": "When", "Pre-Duration": "Pre-Duration", "Duration": "Duration", "Post-Duration": "Post-Duration", "Global": "Global", "Repeats": "Repeats", "Ends after": "Ends after", "Config ID placement": "County Config IDs", "Global": "Global" };

export function failLabels(checks) {
  const out = new Set();
  (checks || []).filter(c => c.pass === false).forEach(c => {
    if (FIELD_OF[c.label]) out.add(FIELD_OF[c.label]);
    const w = String(c.line || "").match(/WRONG field \(([^)]+)\)/); if (w) out.add(w[1]);
  });
  return Array.from(out);
}

export function eventProgramCheck(sectionEvents, progName, kmEvents, others) {
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
export function programHeader(p) {
  if (p.calTag || p.kvk || p.showCal) return p.progId + "  @  " + p.calId + (p.bracket ? "  \u00B7  shard " + p.bracket : "");
  return p.progId;
}

export function adaptGlued(p, actual) {
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
export function packageTagChecks(p, actual) {
  const man = (p.manualTags || []).map(lc);
  return cmpInFieldMulti("Package Tag", p.tags, "Package Tags", actual.tags, [{ name: "Event IDs", val: actual.event }, { name: "County Config IDs", val: actual.ccid }, { name: "Calendar IDs", val: actual.calIds }]).map(c => {
    const m = c.line.match(/'([^']+)'/);
    if (m && man.indexOf(lc(m[1])) >= 0) c.line += " (added manually)";
    return c;
  });
}

// KvK calendar-grouped programs: event placement, Global (when it has events), events note
export function kvkProgramChecks(p, actual) {
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

// exact-token tag compare ("kvk-c033" must NOT match "kvk-c033-b072")
export function cmpTagExact(label, expCsv, act) {
  const exp = splitCsv(expCsv); if (!exp.length) return null;
  const have = String(act || "").split(/[,\s]+/).map(norm).filter(Boolean).map(lc);
  const ok = exp.every(t => have.indexOf(lc(t)) >= 0);
  return { label, pass: ok, line: (ok ? "\u2705 " : "\u274C ") + label + ': expected "' + exp.join(", ") + '" | actual "' + (norm(act) || "(empty)") + '"' };
}

// pure: all calendar-level checks + which page areas to box in red
export function calendarChecks(p, info) {
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
