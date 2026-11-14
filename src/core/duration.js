// Duration values such as "1d 2h 30m" (pure).
import { norm } from "./text.js";

// Pre/Dur/Post: a value -> exact match. Blank in the ticket -> skipped, UNLESS strict
// (mission tickets): then KM must be blank too ("", "N/A" or "-").
// Duration -> total seconds, so formatting never matters: "23h50m" = "23h 50m" = "23 h 50 m",
// "1d23h45m" = "1d 23h 45m", "24h" = "1d" (same duration). A unit-less number takes the next
// smaller unit ("23h50" = 23h 50m). Returns null when the text is not a duration.
export function durSeconds(x) {
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

export function isBlankKM(v) { return !/\d+\s*[dhm]/i.test(norm(v)); } // no real duration (blank, N/A, -, ...) = blank

// Pre/Dur/Post: only a real duration (digits + d/h/m, e.g. "4d", "23h 59m") counts;
// blanks, "-", "N/A", "TBD"... mean "no value".
export function durVal(v) { v = (v || "").trim(); return /\d+\s*[dhm]/i.test(v) ? v : ""; }
