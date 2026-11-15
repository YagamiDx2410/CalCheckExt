// AI assist (popup shell): toggle, review line, Detail popup, "Use" a side.
// Logic (field list, prompt, reply reader, comparison) lives in core/ai.js.
import { AI_FIELDS, aiCompare, aiMerge, buildAiPrompt, parseAiReply } from "../core/ai.js";
import { $, esc } from "./dom.js";
import { aiState, clearData, enterBatchMode, enterSingleMode, fillSingle, saveState, setAiState } from "./session.js";

// ---- SEND TO AI / GET THE REPLY: left empty on purpose (flow not decided yet) ----
// Must resolve to the AI's raw reply text (it carries the CALCHECK-BEGIN/END block), or "" / throw
// when the AI cannot be reached -> the review shows "AI unavailable".
async function askAi(prompt) { return ""; }

// false while askAi above is empty: the toggle then only shows "Under Development" and no AI call is
// made. Set to true in the same change that makes askAi return a real reply.
const AI_READY = false;

// Second read of the ticket by AI, compared with the tool's cases. Sets the review state.
// Returns the AI's programs ONLY when the tool found none ("AI only"); otherwise null.
export async function aiReview(toolCases, ticketText) {
  if (!$("aiAssist").checked || !AI_READY) { setAiState(null); return null; }
  const m = $("jiraMsg"); m.className = "jmsg info"; m.textContent = "Asking AI…";
  const nonce = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  let ai = null, why = "";
  try { ai = parseAiReply(await askAi(buildAiPrompt(ticketText, nonce)), nonce); } catch (e) { why = String((e && e.message) || e); }
  if (!ai) { setAiState({ status: "unavailable", why, noTool: !toolCases.length }); return null; }
  const cmp = aiCompare(toolCases, ai, ticketText);
  const status = !toolCases.length ? "aionly" : cmp.same ? "match" : "review";
  setAiState({ status, tool: toolCases, ai, rows: cmp.rows, used: status === "aionly" ? "ai" : "", asked: false });
  return status === "aionly" ? ai : null;
}

export function clearAi() { setAiState(null); renderAi(); }

export function renderAi() {
  const st = $("aiAssist").checked ? aiState : null;
  AI_FIELDS.forEach(f => $(f.key).classList.remove("ai-diff"));
  if ($("aiAssist").checked && !AI_READY) {
    $("aiBadge").className = "cap-tag cap-warn"; $("aiBadge").textContent = "Under Development";
    $("aiText").textContent = "AI assist is not connected yet; the tool reads the ticket as usual.";
    $("aiDetailBtn").classList.add("hide"); $("aiLine").classList.remove("hide");
    return;
  }
  $("aiLine").classList.toggle("hide", !st);
  if (!st) return;
  const dif = (st.rows || []).filter(r => !r.same).length;
  const view = {
    match: ["Match", "ai-ok", "AI and the tool read the same values."],
    review: ["Need review", "cap-warn", dif + " program" + (dif === 1 ? "" : "s") + " differ" + (dif === 1 ? "s" : "") + (st.used ? " — using the " + (st.used === "ai" ? "AI" : "tool") + " result." : " — the form holds the tool result.")],
    aionly: ["AI only", "cap-info", "The tool could not read this ticket; the values come from AI."],
    unavailable: ["AI unavailable", "ai-off", (st.noTool ? "No AI result for this ticket." : "Using the tool result; it was not cross-checked.") + (st.why ? " (" + st.why + ")" : "")]
  }[st.status];
  $("aiBadge").className = "cap-tag " + view[1]; $("aiBadge").textContent = view[0];
  $("aiText").textContent = view[2];
  $("aiDetailBtn").classList.toggle("hide", st.status !== "review" && st.status !== "aionly");
  // single program on screen: mark the fields where the two sides differ
  if (st.status === "review" && st.rows.length === 1 && st.rows[0].side === "both" && !$("singleFields").classList.contains("hide"))
    st.rows[0].cells.forEach(c => { if (!c.same) $(c.key).classList.add("ai-diff"); });
}

function openDetail() {
  const st = aiState; if (!st || !st.rows) return;
  const val = (v, c, isAi) => (v ? esc(v) : '<span class="none">(empty)</span>') + (isAi && c.unseen ? ' <span class="cap-tag cap-bad" title="This id does not appear in the ticket text">not in ticket</span>' : "");
  $("aiDetail").innerHTML = st.rows.map((r, i) => {
    const only = r.side === "tool" ? "only the tool has this program" : r.side === "ai" ? "only AI has this program" : "";
    const body = r.cells.filter(c => c.tool || c.ai).map(c =>
      '<tr class="' + (r.side === "both" && !c.same ? "dif" : "") + '"><td>' + esc(c.label) + "</td>"
      + "<td>" + (r.side === "ai" ? '<span class="none">—</span>' : val(c.tool, c, false)) + "</td>"
      + "<td>" + (r.side === "tool" ? '<span class="none">—</span>' : val(c.ai, c, true)) + "</td></tr>").join("");
    return "<table><caption>" + (i + 1) + ". " + esc(r.progId || "(no Program ID)")
      + (only ? ' <span class="cap-tag cap-warn">' + only + "</span>" : r.same ? ' <span class="cap-tag ai-ok">match</span>' : ' <span class="cap-tag cap-warn">differs</span>')
      + "</caption><tr><th>Field</th><th>Tool</th><th>AI</th></tr>" + body + "</table>";
  }).join("");
  $("aiUseTool").classList.toggle("hide", st.status === "aionly");
  $("aiModal").classList.remove("hide");
}

function useSide(side) {
  const st = aiState; if (!st || !st.ai) return;
  const cases = side === "tool" ? st.tool : aiMerge(st.tool, st.ai);
  if (!cases.length) return;
  if (cases.length > 1) enterBatchMode(cases);
  else { enterSingleMode(); clearData(false); fillSingle(cases[0]); }
  setAiState(Object.assign({}, st, { used: side }));
  $("aiModal").classList.add("hide");
  const m = $("jiraMsg"); m.className = "jmsg info"; m.classList.remove("hide");
  m.textContent = "Filled from the " + (side === "ai" ? "AI" : "tool") + " result. Review, then click CHECK.";
  renderAi(); saveState();
}

// Before a run: with an unresolved "Need review", ask once.
export function aiConfirmRun() {
  const st = $("aiAssist").checked && AI_READY ? aiState : null;
  if (!st || st.status !== "review" || st.used || st.asked) return true;
  if (!confirm("AI and the tool read this ticket differently and you have not picked a side (see Detail).\nRun the check with the values on screen?")) return false;
  setAiState(Object.assign({}, st, { asked: true })); saveState();
  return true;
}

// Called once, after the saved session is loaded.
export function initAi() {
  chrome.storage.local.get("aiAssist").then(r => { $("aiAssist").checked = !!(r && r.aiAssist); renderAi(); });
  $("aiAssist").addEventListener("change", () => {
    chrome.storage.local.set({ aiAssist: $("aiAssist").checked });
    if (!$("aiAssist").checked) setAiState(null);
    renderAi(); saveState();
  });
  $("aiDetailBtn").addEventListener("click", e => { e.preventDefault(); openDetail(); });
  $("aiClose").addEventListener("click", () => $("aiModal").classList.add("hide"));
  $("aiUseTool").addEventListener("click", () => useSide("tool"));
  $("aiUseAi").addEventListener("click", () => useSide("ai"));
  AI_FIELDS.forEach(f => $(f.key).addEventListener("input", () => $(f.key).classList.remove("ai-diff")));
}
