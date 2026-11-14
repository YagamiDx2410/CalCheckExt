// Date / time parsing for Jira tickets and KM "When" entries (pure).

// ---------- canonical Time / Date comparison ----------
// Time: compare by seconds-of-day; a missing seconds field counts as :00
// ("02:00" == "02:00:00", but "02:00:10" != "02:00"). Timezone: only fails when
// BOTH sides state a tz and they differ (a missing tz is treated as UTC).
export function parseTimeToken(s) {
  const m = String(s || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const mi = parseInt(m[2], 10), se = m[3] ? parseInt(m[3], 10) : 0;
  const ap = (m[4] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
  const tzm = String(s || "").match(/\b(UTC|GMT|[A-Z]{2,4})\b/);
  return { sec: h * 3600 + mi * 60 + se, tz: tzm ? tzm[1].toUpperCase() : "" };
}

export const MON_BG = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function monNumBg(w) { w = (w || "").toLowerCase(); return MON_BG[w.slice(0, 4)] || MON_BG[w.slice(0, 3)] || 0; }

export function norm4y(y) { y = parseInt(y, 10); return y < 100 ? 2000 + y : y; }

// Parse a date to {mo,d,y} (y=0 when absent). Handles M/D/Y, M/D, "25[th] Sept [2026]",
// "Sept 25[, 2026]"; ignores leading zeros and weekday prefixes.
export function parseDateParts(s) {
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
export function whenEntries(when) {
  const out = [], str = String(when || "");
  const re = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\s,]*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(am|pm))?\s*(UTC|GMT)?)?/gi;
  let m;
  while ((m = re.exec(str))) {
    const t = m[4] ? parseTimeToken(m[4] + (m[5] ? " " + m[5] : "") + (m[6] ? " " + m[6] : "")) : null;
    out.push({ mo: +m[1], d: +m[2], y: norm4y(m[3]), sec: t ? t.sec : null, tz: t ? t.tz : "" });
  }
  return out;
}

export function whenShow(e) {
  const p2 = n => String(n).padStart(2, "0");
  const t = e.sec == null ? "" : " " + p2(Math.floor(e.sec / 3600)) + ":" + p2(Math.floor(e.sec / 60) % 60) + ":" + p2(e.sec % 60) + (e.tz ? " " + e.tz : "");
  return e.mo + "/" + e.d + "/" + e.y + t;
}

// A ticket may write 03/11/2026 meaning 3 November (day first). When the text carries a weekday
// ("Tuesday, 03/11/2026") the weekday decides: if it only fits day/month, the date is swapped to
// month/day (11/3/2026, what KM shows). 25/11/2026 (first number > 12) can only be day/month.
export const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

export function slashDate(s) {
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

export function firstDate(s) { return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s || "") ? slashDate(s) : (s || "").trim(); }

export function timeOf(s) { const m = (s || "").match(/\d{1,2}:\d{2}(:\d{2})?\s*UTC/i); return m ? m[0].trim() : ""; }

// Month lookup + date matchers (module-level so parseOffer can reuse them)
export const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export const RE_SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;

export const RE_DMY = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?/; // 25[th] September [2026]

export const RE_MDY = /\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/; // September 25[, 2026]

export function monNum(w) { w = (w || "").toLowerCase(); return MON[w.slice(0, 4)] || MON[w.slice(0, 3)] || 0; }

export function normDate(s) {
  s = (s || "").trim(); let m;
  if ((m = s.match(RE_SLASH))) { const mm = slashDate(s).match(RE_SLASH); return mm[1] + "/" + mm[2] + "/" + mm[3]; }
  if ((m = s.match(RE_DMY)) && monNum(m[2])) return monNum(m[2]) + "/" + parseInt(m[1], 10) + (m[3] ? "/" + m[3] : "");
  if ((m = s.match(RE_MDY)) && monNum(m[1])) return monNum(m[1]) + "/" + parseInt(m[2], 10) + (m[3] ? "/" + m[3] : "");
  return s;
}

export function extractDate(line) {
  for (const re of [RE_SLASH, RE_DMY, RE_MDY]) {
    const m = (line || "").match(re);
    if (m) { const d = normDate(m[0]); if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(d)) return d; }
  }
  return "";
}
