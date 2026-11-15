// Read a Jira ticket and auto-fill the popup.
import { adfPlainText } from "../core/adf.js";
import { adfPromptText } from "../core/ai.js";
import { parseCountyConfig, parsePerRowExtras, parseTicket, parseTicketHtml, parseTicketV2 } from "../core/parser/index.js";
import { aiReview, clearAi, renderAi } from "./ai.js";
import { $ } from "./dom.js";
import { clearData, enterBatchMode, enterSingleMode, fillSingle, saveState, sessionHasData, sessionTicket, setSessionTicket } from "./session.js";

// =================== JIRA AUTO-FILL ===================
function extractIssueKey(link) {
  const m = (link || "").match(/([A-Z][A-Z0-9]+-\d+)/);
  return m ? m[1] : "";
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
  setSessionTicket(key);
  clearAi();

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
    // AI assist (only when its toggle is on): a second, independent read of the same ticket
    const ticketText = ((data.fields && data.fields.summary) || "") + "\n" + (data.fields && data.fields.description ? adfPromptText(data.fields.description) : "");
    let aiOnly = false;
    if (!parsed || !parsed.cases || !parsed.cases.length) {
      const only = await aiReview([], ticketText);          // the tool found nothing: AI result, if any
      if (only) { parsed = { cases: only, warnings: [] }; aiOnly = true; }
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

    if (!aiOnly) await aiReview(parsed.cases, ticketText);
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
    const filled = fillSingle(got);

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
    renderAi();
    saveState();
  }
}

$("jiraRead").onclick = readJira;
