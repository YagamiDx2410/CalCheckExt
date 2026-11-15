// Popup state (single owner; others use the setters), session memory, single / batch mode.
import { $, CLEARABLE, DEFAULT_GIT_URL, DEFAULT_URL, esc, FIELDS } from "./dom.js";

// ---- session memory: everything typed / read is saved as you go, so closing the popup never loses it ----
const SESSION_TTL = 12 * 3600 * 1000;   // a saved session is dropped after 12 hours

export let baseStep = "url", sessionTicket = "", restoredSession = null;

export function show(step) {
  if (step === "url" || step === "form") baseStep = step;
  $("stepUrl").classList.toggle("hide", step !== "url");
  $("stepForm").classList.toggle("hide", step !== "form");
  $("stepResult").classList.toggle("hide", step !== "result");
  $("stepBatch").classList.toggle("hide", step !== "batch");
  $("stepLabel").textContent = step === "url" ? "Step 1/2 \u2014 URL" : step === "form" ? "Step 2/2 \u2014 Values" : "Result";
  saveState();
}

// batch state
export let batchCases = [];

export let batchSel = null;      // Set of ticked case keys; null = all ticked

export let lastSummary = [];     // latest result per case (re-checks replace only the rows they re-ran)

export let singleExtras = {};

export let aiState = null;      // AI assist review of the current ticket (null = none)

export function ticketKey() { const m = ($("jiraLink").value || "").match(/[A-Z][A-Z0-9]+-\d+/); return m ? m[0] : ""; } // Global/Repeat carried into single-mode CHECK (no UI fields)

export function enterSingleMode() {
  batchCases = []; batchSel = null; lastSummary = []; $("batchTags").value = "";
  $("batchBox").classList.add("hide");
  $("singleFields").classList.remove("hide");
  saveState();
}

// Package Tags typed by hand for the whole batch (checked in addition to what the ticket lists)
export function manualTagList() { return Array.from(new Set(($("batchTags").value || "").split(/[,;\s]+/).map(x => x.trim()).filter(Boolean))); }

export function updateTagsNote() {
  const prog = batchCases.filter(c => !c.calCheck && !c.boss), withTags = prog.filter(c => c.tags && c.tags.trim()).length;
  const n = $("batchTagsNote"), man = manualTagList();
  let txt;
  if (!prog.length) txt = "";
  else if (!withTags) txt = man.length ? "The ticket has no Package Tags for these programs. Your " + man.length + " tag(s) will be checked on every program that is ticked." : "\u26A0 The ticket has no Package Tags for these programs. Type them here to add a check; left empty, the report only shows a Note with the Package Tags found on KM.";
  else if (withTags === prog.length) txt = "Package Tags come from the ticket" + (man.length ? "; your " + man.length + " tag(s) are checked in addition." : ". Anything typed here is checked in addition.");
  else txt = "The ticket lists Package Tags for " + withTags + " of " + prog.length + " programs. Type tags here to check them on every program.";
  n.textContent = txt; n.style.color = (!withTags && !man.length && prog.length) ? "#b36b00" : "#7a7f92";
}

export function caseKey(c) { return (c.calCheck ? "CAL|" : "") + (c.calId || "") + "|" + (c.progId || ""); }

function isSel(k) { return batchSel === null || batchSel.has(k); }

export function enterBatchMode(cases, keep) {
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

export function selectedCases() { return batchCases.filter(c => isSel(caseKey(c))); }

export function failedKeys() { return lastSummary.filter(r => r.status !== "DONE" || r.overall === "FAIL").map(caseKey); }

export function updateBatchUi() {
  const n = batchCases.length, k = selectedCases().length, fk = failedKeys().filter(x => batchCases.some(c => caseKey(c) === x));
  $("selCount").textContent = k + " of " + n + " selected";
  const all = $("selAll"); all.checked = k === n; all.indeterminate = k > 0 && k < n;
  $("runBatch").textContent = k === n ? "CHECK ALL (" + n + ")" : "CHECK SELECTED (" + k + ")";
  const sf = $("selFailed"); sf.classList.toggle("hide", !fk.length); sf.textContent = "Select failed (" + fk.length + ")";
}

function jiraMsgSnap() { const m = $("jiraMsg"); return m.classList.contains("hide") ? null : { cls: m.className, text: m.textContent }; }

export function sessionHasData() { return batchCases.length > 0 || CLEARABLE.some(f => $(f).value.trim()); }

export function saveState() {
  const data = {}; FIELDS.forEach(f => data[f] = $(f).value);
  chrome.storage.local.set({ form: data, session: { v: 1, savedAt: Date.now(), step: baseStep, ticket: sessionTicket, batch: batchCases, sel: batchSel ? Array.from(batchSel) : null, btags: $("batchTags").value, last: lastSummary.map(r => { const c = Object.assign({}, r); delete c.imageDataUrl; return c; }), extras: singleExtras, ai: aiState, jmsg: jiraMsgSnap() } });
}

export function loadState() {
  return chrome.storage.local.get(["form", "session"]).then(({ form, session }) => {
    form = form || {};
    FIELDS.forEach(f => { $(f).value = form[f] || ""; });
    if (!$("url").value) $("url").value = DEFAULT_URL;
    if (!$("gitUrl").value) $("gitUrl").value = DEFAULT_GIT_URL;
    const fresh = session && session.v === 1 && (Date.now() - session.savedAt) < SESSION_TTL;
    if (session && !fresh) {                      // expired: drop the old ticket's values and list
      CLEARABLE.forEach(f => { $(f).value = ""; });
      chrome.storage.local.remove("session");
    }
    if (fresh) {
      restoredSession = session; sessionTicket = session.ticket || "";
      singleExtras = session.extras || {};
      aiState = session.ai || null;
      if (session.jmsg) { const m = $("jiraMsg"); m.className = session.jmsg.cls; m.textContent = session.jmsg.text; m.classList.remove("hide"); }
      batchSel = session.sel ? new Set(session.sel) : null; lastSummary = session.last || []; $("batchTags").value = session.btags || "";
      if (session.batch && session.batch.length > 1) enterBatchMode(session.batch, true);
      const t = new Date(session.savedAt), hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
      const n = $("sessNote"); n.textContent = "Restored your last session" + (sessionTicket ? " (" + sessionTicket + ", saved " + hh + ")" : " (saved " + hh + ")") + ". Use Reset to start over."; n.classList.remove("hide");
    }
  });
}

export function clearData(alsoJiraLink) {
  CLEARABLE.forEach(f => { $(f).value = ""; });
  singleExtras = {};
  if (alsoJiraLink) $("jiraLink").value = "";
  $("formErr").classList.add("hide");
  saveState();
}

// one program -> the single-mode fields; returns the names of the fields it filled
export function fillSingle(got) {
  const filled = [];
  ["calId", "progId", "tags", "flag", "event", "date", "time", "pre", "dur", "post"].forEach(k => { if (got[k]) { $(k).value = got[k]; filled.push(k); } });
  saveState();
  singleExtras = { glued: got._glued || [], global: got.global || "", repeatEvery: got.repeatEvery, endsAfter: got.endsAfter, flagNote: got.flagNote || "", cocIds: got.cocIds || "", calIds: got.calIds || "", unknownContent: got.unknownContent || "", shard: got.shard || "", noteKmTags: !!got.noteKmTags, shardTokens: got.shardTokens || "" };
  return filled;
}

// ---- setters: an imported binding is read-only, so other modules assign through these ----
export function setSessionTicket(v) { sessionTicket = v; }
export function setRestoredSession(v) { restoredSession = v; }
export function setBatchCases(v) { batchCases = v; }
export function setBatchSel(v) { batchSel = v; }
export function setLastSummary(v) { lastSummary = v; }
export function setSingleExtras(v) { singleExtras = v; }
export function setAiState(v) { aiState = v; }
