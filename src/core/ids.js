// Id / tag tokens: splitting, exact matching, near-miss explanations (pure).
import { lc } from "./text.js";

// Program-id match for boss row selection: exact, else token-set equality ignoring
// order and any wkN token (KM sometimes reorders tokens / drops the week suffix).
export function idTokens(s) { return lc(s).split(/[.\-_/\s]+/).filter(t => t && !/^wk\d+$/.test(t)).sort().join("."); }

export function idMatch(a, b) { if (!a || !b) return false; if (lc(a) === lc(b)) return true; return idTokens(a) === idTokens(b); }

// Position-aware presence check for a single token. correctVal = the KM field the
// token SHOULD be in; others = [{name, val}, ...] the fields it must NOT be in.
// Reports clearly whether it's present AND in the right place, or mis-placed.
// A KM field holds a list of ids. An id counts as present only as a WHOLE id (case-insensitive):
// an extra / missing character, or a longer id that merely contains it, is not a match.
export function fieldIds(v) { return String(v || "").split(/[,\s]+/).map(x => x.trim()).filter(Boolean); }

export function hasId(val, tok) { const t = lc(tok); return fieldIds(val).some(x => lc(x) === t); }

export function idWhy(want, got) {
  const dl = got.length - want.length, n = Math.abs(dl);
  if (evDay(want) !== evDay(got)) return "different day";
  if (dl > 0) return n + " extra character" + (n === 1 ? "" : "s");
  if (dl < 0) return n + " missing character" + (n === 1 ? "" : "s");
  const d = evLev(lc(want), lc(got)); return d + " character" + (d === 1 ? "" : "s") + " differ";
}

// ===== exact event check per program =====
// The ticket's section (B072/B073, C033 ...) is the list. Rule that says which program
// holds which event: the dayN in the event must equal the dayN in the program name, and
// the event TYPE (last segment) picks the program: sms/ams/alb -> *.0.events,
// slb -> *.1.slbs, rlb -> the parent program (…dayN). The scope word between
// (bcshards / cshard / c033 ...) is irrelevant: it is compared as plain text.
export function evDay(x) { const m = String(x).match(/day(\d+)/i); return m ? m[1] : ""; }

export function evKindOfEvent(e) { const t = String(e).split(".").pop().toLowerCase(); return /^(sms|ams|alb)$/.test(t) ? "events" : (t === "slb" ? "slbs" : (t === "rlb" ? "parent" : "?")); }

export function evKindOfProg(p) { p = String(p); return /\.0\.events$/i.test(p) ? "events" : (/\.1\.slbs$/i.test(p) ? "slbs" : (/day\d+$/i.test(p) ? "parent" : "?")); }

export function evLev(a, b) {
  const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; } for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// The reader splits a token like "ev.Atag.B" into two ids (two ids stuck together in Jira). But some real ids
// contain "ev." / "tag." inside (ev.ftev.kvk.v2, tag.kvk.ftev.shop.v2). KM decides: when the glued form
// exists on KM as ONE id in its own field, it is kept as one id and its split parts are not checked.
export function gluedParts(raw) { return String(raw).split(/(?<=[^.])(?=(?:ev|tag)\.)/i).map(x => x.replace(/\.+$/, "").trim()).filter(Boolean); }

// Split a raw Tags-cell string into clean tokens.
// Jira sometimes stores two ids glued with NO separator, e.g.
//   "ev.fund.cb26.short.unittag.fund.cb26.short.unit"
// A plain comma/space split keeps that as one token → misclassified as Event,
// and the real tag.* is lost. Here we also break BEFORE any inner ev./tag.
// prefix and flag the token so the user re-checks (we never split silently).
export function splitTagTokens(raw) {
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

export function classifyTags(raw) {
  const { tokens, glued } = splitTagTokens(raw);
  const uq = (a) => a.filter((v, i) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  return { ev: uq(tokens.filter(t => /^ev\./i.test(t))), tag: uq(tokens.filter(t => /^tag\./i.test(t))), glued };
}
