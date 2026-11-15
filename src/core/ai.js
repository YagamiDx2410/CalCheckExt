// AI assist (pure): the target field list, the prompt, the reply reader and the tool-vs-AI comparison.
// AI_FIELDS is the ONE list of targets: the prompt, the reply reader, the comparison and the Detail
// popup are all generated from it. A new field = one more line here.
import { parseDateParts, parseTimeToken } from "./dates.js";
import { durSeconds } from "./duration.js";
import { fieldIds } from "./ids.js";
import { lc, norm } from "./text.js";

// kind decides how two values are compared: id / ids / text / date / time / dur
export const AI_FIELDS = [
  { key: "calId", label: "Calendar ID", kind: "id", hint: "the calendar id, starts with cal." },
  { key: "progId", label: "Program ID", kind: "id", hint: "the program id / name" },
  { key: "flag", label: "Flag", kind: "text", hint: "the feature flag of the program" },
  { key: "event", label: "Event IDs", kind: "ids", hint: "ids starting with ev. ; comma-separated when several" },
  { key: "tags", label: "Package Tags", kind: "ids", hint: "ids starting with tag. ; comma-separated when several" },
  { key: "date", label: "Date", kind: "date", hint: "start date as M/D/YYYY (month first)" },
  { key: "time", label: "Time of Day", kind: "time", hint: "start time as HH:MM:SS UTC" },
  { key: "pre", label: "Pre-Duration", kind: "dur", hint: "like 1d 2h 30m" },
  { key: "dur", label: "Duration", kind: "dur", hint: "like 1d 2h 30m" },
  { key: "post", label: "Post-Duration", kind: "dur", hint: "like 1d 2h 30m" }
];

// ADF description -> plain text for the prompt: one line per paragraph / table row, no JSON, no links.
export function adfPromptText(doc) {
  const lines = [];
  const inline = n => {
    if (!n) return "";
    if (n.type === "text") return n.text || "";
    if (n.type === "status" && n.attrs) return n.attrs.text || "";
    if (n.type === "date" && n.attrs) { const d = new Date(+n.attrs.timestamp); return isNaN(d) ? "" : (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear(); }
    if (n.type === "hardBreak") return " ";
    return (n.content || []).map(inline).join(n.type === "tableCell" || n.type === "tableHeader" ? " " : "");
  };
  (function walk(n) {
    if (!n) return;
    if (n.type === "tableRow") { lines.push((n.content || []).map(c => norm(inline(c))).join(" | ")); return; }
    if (n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock") { lines.push(norm(inline(n))); return; }
    (n.content || []).forEach(walk);
  })(doc);
  return lines.map(l => norm(l.replace(/https?:\/\/\S+/gi, ""))).filter(Boolean).join("\n");
}

export function buildAiPrompt(ticketText, nonce, fields) {
  fields = fields || AI_FIELDS;
  return [
    "Read the ticket below and list every program it schedules.",
    "Reply with ONE code block only, no explanation, exactly in this shape:",
    "CALCHECK-BEGIN " + nonce,
    "program: 1",
    fields.map(f => f.key + ": ...").join("\n"),
    "program: 2",
    "...",
    "CALCHECK-END " + nonce,
    "Rules: a \"program:\" line starts each program. Leave a value empty when the ticket does not state it. Copy ids exactly as written in the ticket; never invent or correct one.",
    "Fields:",
    fields.map(f => "- " + f.key + " = " + f.label + (f.hint ? " (" + f.hint + ")" : "")).join("\n"),
    "Ticket:",
    String(ticketText || "").replace(/https?:\/\/\S+/gi, "").trim()
  ].join("\n");
}

// Reads the LAST complete CALCHECK block carrying this nonce. Returns the programs, or null when
// there is no usable block (-> "AI unavailable").
export function parseAiReply(text, nonce, fields) {
  fields = fields || AI_FIELDS;
  const src = String(text || ""), b = "CALCHECK-BEGIN " + nonce, e = "CALCHECK-END " + nonce;
  const end = src.lastIndexOf(e); if (end < 0) return null;
  const start = src.lastIndexOf(b, end); if (start < 0) return null;
  const keyOf = {}; fields.forEach(f => { keyOf[lc(f.key)] = f.key; keyOf[lc(f.label)] = f.key; });
  const cases = []; let cur = null;
  src.slice(start + b.length, end).split(/\r?\n/).forEach(line => {
    const m = line.replace(/`/g, "").match(/^\s*[-*]?\s*([^:]+?)\s*:\s*(.*)$/); if (!m) return;
    const k = lc(m[1]); let v = norm(m[2]);
    if (k === "program") { cur = {}; cases.push(cur); return; }
    if (!keyOf[k]) return;
    if (!cur) { cur = {}; cases.push(cur); }
    if (/^(-+|n\/?a|none|null|empty|\(empty\)|\.\.\.)$/i.test(v)) v = "";
    cur[keyOf[k]] = v;
  });
  const out = cases.filter(c => fields.some(f => c[f.key]));
  out.forEach(c => fields.forEach(f => { if (c[f.key] == null) c[f.key] = ""; }));
  return out.length ? out : null;
}

// Same VALUE, not same characters: "24h" = "1d", "02:00" = "02:00:00 UTC", "9/01/2026" = "9/1/2026",
// id lists in any order. Month and day are NOT swapped: 03/11 and 11/3 are different dates.
export function aiSame(kind, a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return !a && !b;
  if (kind === "ids") { const x = fieldIds(a).map(lc).sort(), y = fieldIds(b).map(lc).sort(); return x.join(",") === y.join(","); }
  if (kind === "dur") { const x = durSeconds(a), y = durSeconds(b); if (x != null && y != null) return x === y; }
  if (kind === "date") { const x = parseDateParts(a), y = parseDateParts(b); if (x && y) return x.mo === y.mo && x.d === y.d && (!x.y || !y.y || x.y === y.y); }
  if (kind === "time") { const x = parseTimeToken(a), y = parseTimeToken(b); if (x && y) return x.sec === y.sec && (!x.tz || !y.tz || x.tz === y.tz); }
  return lc(a).replace(/\s+/g, "") === lc(b).replace(/\s+/g, "");
}

// Only plain programs are compared: calendar-page and boss-spawn cases are derived by the tool.
export function aiPrograms(cases) { return (cases || []).filter(c => c && !c.calCheck && !c.boss); }

// Guard against invented ids: an id the AI returns must appear word for word in the ticket text.
export function aiUnseen(kind, value, ticketText) {
  if (kind !== "id" && kind !== "ids") return false;
  const hay = lc(ticketText);
  return fieldIds(value).some(t => hay.indexOf(lc(t)) < 0);
}

// Tool vs AI, program by program (paired by Program ID; one program on each side is paired anyway).
// -> { same, rows: [{ progId, side: "both" | "tool" | "ai", same, cells: [{ key, label, tool, ai, same, unseen }] }] }
// unseen = the AI value holds an id that is not in ticketText (only checked when ticketText is given).
export function aiCompare(toolCases, aiCases, ticketText, fields) {
  fields = fields || AI_FIELDS;
  const tool = aiPrograms(toolCases), ai = (aiCases || []).slice(), rows = [];
  const cells = (t, a) => fields.map(f => {
    const tv = norm(t ? t[f.key] : ""), av = norm(a ? a[f.key] : "");
    return { key: f.key, label: f.label, tool: tv, ai: av, same: !!t && !!a && aiSame(f.kind, tv, av), unseen: !!a && !!ticketText && aiUnseen(f.kind, av, ticketText) };
  });
  const lone = tool.length === 1 && ai.length === 1;
  tool.forEach(t => {
    const i = lone ? 0 : ai.findIndex(a => lc(a.progId) === lc(t.progId));
    const a = i >= 0 ? ai.splice(i, 1)[0] : null, cs = cells(t, a);
    rows.push({ progId: t.progId || "", side: a ? "both" : "tool", same: !!a && cs.every(c => c.same), cells: cs });
  });
  ai.forEach(a => rows.push({ progId: a.progId || "", side: "ai", same: false, cells: cells(null, a) }));
  return { same: rows.length > 0 && rows.every(r => r.same), rows };
}

// "Use AI": AI values laid over the tool's cases. A program found by both keeps the tool's extra data
// (repeat, global, ...); a program only the AI found is added; one only the tool found is dropped.
// Calendar-page and boss-spawn cases stay as the tool derived them.
export function aiMerge(toolCases, aiCases, fields) {
  fields = fields || AI_FIELDS;
  const tool = aiPrograms(toolCases), lone = tool.length === 1 && (aiCases || []).length === 1;
  const merged = (aiCases || []).map(a => {
    const t = lone ? tool[0] : tool.find(x => lc(x.progId) === lc(a.progId));
    const c = Object.assign({}, t || {});
    fields.forEach(f => { c[f.key] = a[f.key] || ""; });
    return c;
  });
  return merged.concat((toolCases || []).filter(c => c && (c.calCheck || c.boss)));
}
