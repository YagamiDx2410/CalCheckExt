// Popup entry: buttons, run check / batch, render results, resume a background run.
import "./jira.js";   // registers the "Read Jira" button
import { aiConfirmRun, clearAi, initAi } from "./ai.js";
import { $, DEFAULT_URL, esc, FIELDS } from "./dom.js";
import { dirHandle, ensureDirPermission, loadDir, writeToDir } from "./folder.js";
import { batchCases, batchSel, caseKey, clearData, enterBatchMode, enterSingleMode, failedKeys, lastSummary, loadState, manualTagList, restoredSession, saveState, selectedCases, sessionTicket, setBatchCases, setBatchSel, setLastSummary, setRestoredSession, setSessionTicket, setSingleExtras, show, singleExtras, ticketKey, updateBatchUi, updateTagsNote } from "./session.js";
import { syncGitUrlUi, versionGate } from "./version.js";

let lastLogText = "";

// ---------- steps ----------
$("toForm").onclick = async () => { const u = $("url").value.trim(); if (!u) { $("url").focus(); return; } saveState(); if (!(await versionGate())) return; show("form"); $("jiraLink").focus(); };

$("backUrl").onclick = () => show("url");

$("clearData").onclick = () => { clearRun(); clearAi(); clearData(true); const m = $("jiraMsg"); m.className = "jmsg info"; m.classList.remove("hide"); m.textContent = "Cleared (URL kept)."; saveState(); $("calId").focus(); };

// =================== RUN CHECK ===================
$("doCheck").onclick = async () => {
  if (!aiConfirmRun()) return;
  const payload = {
    url: $("url").value.trim(),
    calId: $("calId").value.trim(),
    progId: $("progId").value.trim(),
    flag: $("flag").value.trim(),
    event: $("event").value.trim(),
    tags: $("tags").value.trim(),
    date: $("date").value.trim(),
    time: $("time").value.trim(),
    pre: $("pre").value.trim(),
    dur: $("dur").value.trim(),
    post: $("post").value.trim(),
    global: singleExtras.global || "",
    repeatEvery: singleExtras.repeatEvery,
    endsAfter: singleExtras.endsAfter,
    flagNote: singleExtras.flagNote || "",
    cocIds: singleExtras.cocIds || "",
    calIds: singleExtras.calIds || "",
    unknownContent: singleExtras.unknownContent || "",
    shard: singleExtras.shard || "",
    noteKmTags: !!singleExtras.noteKmTags,
    _glued: singleExtras.glued || [],
    shardTokens: singleExtras.shardTokens || "",
    ticket: ticketKey()
  };
  $("formErr").classList.add("hide");
  if (!payload.calId || !payload.progId) {
    $("formErr").textContent = "\u26A0 Calendar ID and Program ID are required."; $("formErr").classList.remove("hide"); return;
  }
  saveState();

  // decide save target while we still have the click gesture (needed for permission)
  let saveMode = "downloads", permNote = "";
  if (dirHandle) {
    const ok = await ensureDirPermission();
    if (ok) saveMode = "folder";
    else permNote = "No write permission for the chosen folder -- saved to Downloads/CalCheck.";
  }
  payload.saveMode = saveMode;

  $("doCheck").disabled = true; $("backUrl").disabled = true; $("jiraRead").disabled = true;
  $("running").classList.remove("hide");
  let res;
  try { res = await chrome.runtime.sendMessage({ action: "runCheck", payload }); }
  catch (e) { res = { status: "ERROR", message: "Lost connection to the tool: " + (e.message || e) }; }

  // if folder mode, write the returned image into the chosen folder
  if (res && res.status === "DONE" && saveMode === "folder" && res.imageDataUrl) {
    try {
      const nm = await writeToDir(dirHandle, (payload.progId || "calcheck") + ".png", res.imageDataUrl);
      res.savedAs = nm + "  ->  " + dirHandle.name + " (chosen folder)";
      res.shotErr = "";
    } catch (e) {
      res.savedAs = ""; res.shotErr = "Folder write failed: " + (e.message || e) + " -- try re-selecting the folder.";
    }
  }
  if (permNote && res && res.status === "DONE" && !res.shotErr) res.savedAs = (res.savedAs || "") + "  (" + permNote + ")";

  $("doCheck").disabled = false; $("backUrl").disabled = false; $("jiraRead").disabled = false;
  $("running").classList.add("hide");
  renderResult(res);
};

function renderResult(res) {
  if (!res) res = { status: "ERROR", message: "No response." };
  if (res.status !== "DONE") {
    $("formErr").textContent = res.message || (res.step ? ("Error at step " + res.step) : "An error occurred.");
    $("formErr").classList.remove("hide"); return;
  }
  const v = $("verdict"), overall = res.overall;
  v.className = "verdict " + (overall === "PASS" ? "v-pass" : overall === "FAIL" ? "v-fail" : "v-na");
  v.textContent = overall === "N/A" ? "N/A \u2014 screenshot only (no compare values entered)" : ("RESULT: " + overall + "  (" + res.passCount + " match, " + res.failCount + " fail)");

  const linesEl = $("lines");
  if (res.anyChecked && res.resultLines && res.resultLines.length) {
    linesEl.innerHTML = "";
    res.resultLines.forEach(l => { const d = document.createElement("div"); d.className = "ln " + (l.pass === false ? "no" : l.pass === true ? "ok" : ""); if (l.bold) d.style.fontWeight = "700"; d.textContent = l.line; linesEl.appendChild(d); });
    linesEl.classList.remove("hide");
  } else linesEl.classList.add("hide");

  const act = $("actual"); act.textContent = (res.actualLines || []).join("\n");
  act.classList.toggle("hide", !(res.actualLines && res.actualLines.length));

  const saved = $("saved");
  if (res.savedAs) { saved.className = "saved ok"; saved.textContent = "\u2705 Screenshot saved: " + res.savedAs + (res.savedFallback ? "  (folder not writable \u2014 saved to Downloads instead)" : ""); }
  else { saved.className = "saved err"; saved.textContent = "\u26A0 " + (res.shotErr || "Screenshot not saved."); }
  lastLogText = res.logText || "";
  if (res.logSaved) saved.textContent += "  \u26A0 Fails / capture issues \u2014 log saved: " + res.logSaved;
  show("result");
}

$("again").onclick = () => { clearRun(); show("form"); $("jiraLink").focus(); };

$("stop").onclick = async () => { clearRun(); try { await chrome.runtime.sendMessage({ action: "closeWorkTab" }); } catch (e) {} window.close(); };

FIELDS.forEach(f => $(f).addEventListener("input", saveState));

loadDir();

// ================= BATCH run =================
$("clearBatch").onclick = () => { clearRun(); clearAi(); enterSingleMode(); const m = $("jiraMsg"); m.className = "jmsg info"; m.classList.remove("hide"); m.textContent = "Batch list cleared."; saveState(); };

$("backUrlB").onclick = () => show("url");

$("batchStop").onclick = async () => { clearRun(); try { await chrome.runtime.sendMessage({ action: "closeWorkTab" }); } catch (e) {} window.close(); };

$("batchAgain").onclick = () => { clearRun(); show("form"); enterBatchMode(batchCases, true); };

// live progress + incremental folder-save
let batchFolderMode = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "batchProgress") return;
  if (msg.phase === "running") {
    $("batchProg").textContent = "Running " + msg.i + "/" + msg.n + ": " + msg.progId + " \u2026" + (msg.note ? " (" + msg.note + ")" : "");
    const bar = $("batchBar"); if (bar) bar.style.width = Math.round(((msg.i - 1) / msg.n) * 100) + "%";
  } else if (msg.phase === "done") {
    $("batchProg").textContent = "Done " + msg.i + "/" + msg.n + ": " + msg.progId;
    const bar = $("batchBar"); if (bar) bar.style.width = Math.round((msg.i / msg.n) * 100) + "%";
    // folder mode: write this case's image immediately
    if (batchFolderMode && dirHandle && msg.row && msg.row.imageDataUrl) {
      writeToDir(dirHandle, ((msg.row.shotName || msg.row.progId) || "case") + ".png", msg.row.imageDataUrl)
        .then(nm => { msg.row.savedAs = nm; }).catch(() => {});
    }
  }
});

function withManualTags(list) {
  const man = manualTagList(); if (!man.length) return list;
  return list.map(c => {
    if (c.calCheck || c.boss) return c;
    const have = String(c.tags || "").split(/[,\s]+/).filter(Boolean), all = have.slice();
    man.forEach(t => { if (!all.some(x => x.toLowerCase() === t.toLowerCase())) all.push(t); });
    return Object.assign({}, c, { tags: all.join(", "), manualTags: man.slice(), noteKmTags: false });
  });
}

async function runSelected(restoreSel) {
  if (!batchCases.length) return;
  if (!aiConfirmRun()) return;
  const toRun = selectedCases();
  if (!toRun.length) { $("batchErr").textContent = "Tick at least one program to check."; $("batchErr").classList.remove("hide"); return; }
  if (typeof restoreSel === "function") { restoreSel(); updateBatchUi(); saveState(); }   // a one-shot run (re-check failed) must not change your ticks
  const url = $("url").value.trim() || DEFAULT_URL;
  $("batchErr").classList.add("hide");

  // save target within the click gesture (for folder permission)
  let saveMode = "downloads";
  batchFolderMode = false;
  if (dirHandle) {
    const ok = await ensureDirPermission();
    if (ok) { saveMode = "folder"; batchFolderMode = true; }
  }

  $("runBatch").disabled = true; $("clearBatch").disabled = true; $("backUrlB").disabled = true;
  $("batchRunning").classList.remove("hide");
  $("batchProg").textContent = "Starting\u2026";
  { const bar = $("batchBar"); if (bar) bar.style.width = "0%"; }

  let res;
  try { res = await chrome.runtime.sendMessage({ action: "runBatch", payload: { url, saveMode, ticket: ticketKey(), cases: withManualTags(toRun) } }); }
  catch (e) { res = { status: "ERROR", message: "Lost connection to the tool: " + (e.message || e) }; }

  $("runBatch").disabled = false; $("clearBatch").disabled = false; $("backUrlB").disabled = false;
  $("batchRunning").classList.add("hide");

  if (!res || res.status !== "BATCH_DONE") {
    $("batchErr").textContent = (res && res.message) ? res.message : "Batch error.";
    $("batchErr").classList.remove("hide");
    return;
  }
  showBatchResult(res, saveMode);
}

$("runBatch").onclick = () => runSelected();

function showBatchResult(res, saveMode) {
  const rows = (res.summary || []).map(r => { const c = Object.assign({}, r); delete c.imageDataUrl; return c; });
  const ran = new Set(rows.map(caseKey));
  const order = {}; batchCases.forEach((c, i) => { order[caseKey(c)] = i; });
  setLastSummary(lastSummary.filter(r => !ran.has(caseKey(r))).concat(rows).sort((a, b) => (order[caseKey(a)] === undefined ? 999 : order[caseKey(a)]) - (order[caseKey(b)] === undefined ? 999 : order[caseKey(b)])));
  const m = lastSummary;
  const merged = Object.assign({}, res, {
    summary: m, ranKeys: Array.from(ran), ranNow: rows.length,
    total: batchCases.length || m.length,
    pass: m.filter(r => r.status === "DONE" && r.overall === "PASS").length,
    fail: m.filter(r => r.status === "DONE" && r.overall === "FAIL").length,
    err: m.filter(r => r.status !== "DONE").length,
    notChecked: Math.max(0, (batchCases.length || m.length) - m.length)
  });
  renderBatch(merged, saveMode);
  saveState();
}

function renderBatch(res, saveMode) {
  const v = $("batchVerdict");
  const allPass = res.fail === 0 && res.err === 0;
  v.className = "verdict " + (allPass ? "v-pass" : "v-fail");
  v.textContent = "BATCH: " + res.pass + " PASS \u00B7 " + res.fail + " FAIL" + (res.err ? " \u00B7 " + res.err + " err" : "") + "  (total " + res.total + (res.notChecked ? ", " + res.notChecked + " not checked" : "") + ")";

  const box = $("batchSummary"); box.innerHTML = "";
  (res.summary || []).forEach(r => {
    const row = document.createElement("div");
    row.className = "bs-row";
    let badgeCls = "bs-na", badgeTxt = r.overall || "N/A";
    if (r.status !== "DONE") { badgeCls = "bs-err"; badgeTxt = "ERR"; }
    else if (r.overall === "PASS") badgeCls = "bs-pass";
    else if (r.overall === "FAIL") badgeCls = "bs-fail";
    const cnt = r.status === "DONE" ? (r.passCount + "✓ " + r.failCount + "✗") : "";
    const detail = r.status !== "DONE" ? (r.message || "").split("\n")[0] : "";
    // why it failed: the failed check lines (max 4) right under the program
    const failLines = (r.status === "DONE" && r.overall === "FAIL") ? (r.resultLines || []).filter(l => l.pass === false) : [];
    const failHtml = failLines.slice(0, 4).map(l => "<div class=\"meta\" style=\"color:#c0392b\">" + esc(l.line) + "</div>").join("")
      + (failLines.length > 4 ? "<div class=\"meta\" style=\"color:#c0392b\">\u2026 +" + (failLines.length - 4) + " more (see screenshot / log)</div>" : "");
    const d = r.capDiag || {};
    let capTag = "";
    if (r.status === "DONE" && !r.savedAs && !r.imageDataUrl) capTag = " <span class=\"cap-tag cap-bad\">\u2716 no image</span>";
    else if (r.savedFallback) capTag = " <span class=\"cap-tag cap-warn\">\u2193 Downloads</span>";
    else if (d.method && d.method !== "debugger") capTag = " <span class=\"cap-tag cap-warn\">\u26A0 fallback</span>";
    else if ((d.tries || 0) > 1) capTag = " <span class=\"cap-tag cap-info\">\u27F3 retried</span>";
    const older = res.ranKeys && res.ranNow < (res.summary || []).length && res.ranKeys.indexOf(caseKey(r)) < 0 ? ' <span class="cap-tag" style="background:#eef0f6;color:#555;">earlier run</span>' : "";
    row.innerHTML = "<span class=\"bs-badge " + badgeCls + "\">" + badgeTxt + "</span>"
      + "<span class=\"bs-name\"><b>" + esc(r.progId) + "</b>" + (r.calCheck ? " <span class=\"cap-tag cap-info\">CAL</span>" : "") + older + capTag + (detail ? "<div class=\"meta\">" + esc(detail) + "</div>" : "") + failHtml + "</span>"
      + "<span class=\"bs-cnt\">" + cnt + "</span>";
    box.appendChild(row);
  });

  const saved = $("batchSaved");
  if (saveMode === "folder") {
    saved.className = "saved ok";
    const fb = (res.summary || []).filter(r => r.savedFallback).length;
    saved.textContent = "\u2705 Per-program screenshots saved to folder: " + (dirHandle ? dirHandle.name : "")
      + (fb ? "  \u26A0 " + fb + " saved to Downloads/CalCheck instead (folder not writable)" : "");
  } else {
    saved.className = "saved ok";
    saved.textContent = "\u2705 Per-program screenshots saved to Downloads/CalCheck (named by Program).";
  }
  lastLogText = res.logText || "";
  if (res.logSaved) saved.textContent += "  \u26A0 Fails / capture issues \u2014 log saved: " + res.logSaved;
  const nf = (res.summary || []).filter(r => r.status !== "DONE" || r.overall === "FAIL").length;
  const rb = $("recheckFailed"); rb.classList.toggle("hide", !nf); rb.textContent = "Re-check failed (" + nf + ")";
  const bn = $("batchNote");
  bn.textContent = (res.ranNow && res.ranNow < (res.summary || []).length) ? "Re-checked now: " + res.ranNow + ". The other rows keep the result of their last check." : "";
  show("batch");
}

// ---- resume a background run after the popup was closed ----
function bgProgressText(pr) { return "Running " + (pr.i || 0) + "/" + (pr.n || "?") + (pr.progId ? ": " + pr.progId : "") + " \u2026" + (pr.note ? " (" + pr.note + ")" : ""); }

function resumeRunning(RUN) {
  show("form");
  if (RUN.mode === "batch") {
    $("singleFields").classList.add("hide");
    $("batchBox").classList.remove("hide");
    $("batchList").innerHTML = "<div class=\"batch-item\"><b>Running in the background\u2026</b><div class=\"meta\">You can switch windows or close this popup \u2014 reopen anytime to see progress/result.</div></div>";
    $("batchRunning").classList.remove("hide");
    if (RUN.progress) { $("batchProg").textContent = bgProgressText(RUN.progress); const bar = $("batchBar"); if (bar && RUN.progress.n) bar.style.width = Math.round(((RUN.progress.i || 0) / RUN.progress.n) * 100) + "%"; }
  } else {
    $("running").classList.remove("hide");
  }
  startPoll();
}

function resumeResult(RUN) {
  if (!RUN || !RUN.result) return;
  if (RUN.mode === "batch") { $("batchRunning").classList.add("hide"); if (RUN.result.status === "BATCH_DONE") showBatchResult(RUN.result, RUN.saveMode || "downloads"); }
  else { $("running").classList.add("hide"); renderResult(RUN.result); }
}

let _pollTimer = null;

function startPoll() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    let RUN; try { RUN = await chrome.runtime.sendMessage({ action: "getRunState" }); } catch (e) { return; }
    if (!RUN) return;
    if (RUN.active) {
      if (RUN.mode === "batch" && RUN.progress) { $("batchProg").textContent = bgProgressText(RUN.progress); const bar = $("batchBar"); if (bar && RUN.progress.n) bar.style.width = Math.round(((RUN.progress.i || 0) / RUN.progress.n) * 100) + "%"; }
    } else { clearInterval(_pollTimer); _pollTimer = null; resumeResult(RUN); }
  }, 1200);
}

function clearRun() { try { chrome.runtime.sendMessage({ action: "clearRunState" }); } catch (e) {} }

loadState().then(async () => {
  syncGitUrlUi();
  initAi();
  let restored = false;
  try {
    const RUN = await chrome.runtime.sendMessage({ action: "getRunState" });
    if (RUN && RUN.active) { resumeRunning(RUN); restored = true; }
    else if (RUN && RUN.result && (Date.now() - RUN.at) < 10 * 60 * 1000) { resumeResult(RUN); restored = true; }
  } catch (e) {}
  if (!restored) {
    if (restoredSession && restoredSession.step === "form") show("form");
    else { show("url"); $("url").focus(); }
  }
});

// ---- Copy log (last run) ----
async function copyLog(btn) {
  if (!lastLogText) { btn.textContent = "No log"; setTimeout(() => { btn.textContent = "\uD83D\uDCCB Copy log"; }, 1200); return; }
  try { await navigator.clipboard.writeText(lastLogText); btn.textContent = "\u2705 Copied"; }
  catch (e) { btn.textContent = "Copy failed"; }
  setTimeout(() => { btn.textContent = "\uD83D\uDCCB Copy log"; }, 1500);
}

if ($("copyLog")) $("copyLog").onclick = () => copyLog($("copyLog"));

if ($("copyLogS")) $("copyLogS").onclick = () => copyLog($("copyLogS"));

// ---- session memory: save on every edit and when the popup closes; Reset ----
FIELDS.forEach(f => { const el = $(f); if (el) el.addEventListener("input", saveState); });

window.addEventListener("pagehide", saveState);

$("resetSession").onclick = async () => {
  if (!confirm("Reset the session?\nThis clears the saved link, values and ticket list.")) return;
  clearRun();
  FIELDS.forEach(f => { if (f !== "url" && f !== "gitUrl") $(f).value = ""; });
  clearAi(); setSingleExtras({}); setBatchCases([]); setSessionTicket(""); setRestoredSession(null); $("batchTags").value = "";
  enterSingleMode();
  const m = $("jiraMsg"); m.classList.add("hide"); m.textContent = "";
  $("sessNote").classList.add("hide");
  $("formErr").classList.add("hide");
  show("url"); saveState();
};

// ---- tick programs / re-check only the failed ones ----
$("batchList").addEventListener("change", e => {
  const el = e.target; if (!el.classList || !el.classList.contains("bsel")) return;
  const keys = batchCases.map(caseKey);
  const cur = batchSel === null ? new Set(keys) : new Set(batchSel);
  if (el.checked) cur.add(el.dataset.k); else cur.delete(el.dataset.k);
  setBatchSel(cur.size === keys.length ? null : cur);
  updateBatchUi(); saveState();
});

$("selAll").addEventListener("change", e => { setBatchSel(e.target.checked ? null : new Set()); enterBatchMode(batchCases, true); });

$("selFailed").addEventListener("click", () => { setBatchSel(new Set(failedKeys().filter(x => batchCases.some(c => caseKey(c) === x)))); enterBatchMode(batchCases, true); });

$("recheckFailed").onclick = () => {
  const fk = failedKeys().filter(x => batchCases.some(c => caseKey(c) === x));
  if (!fk.length) return;
  const prevSel = batchSel;
  setBatchSel(new Set(fk)); clearRun(); show("form"); enterBatchMode(batchCases, true);
  runSelected(() => { setBatchSel(prevSel); });
};

$("batchTags").addEventListener("input", () => { updateTagsNote(); saveState(); });
