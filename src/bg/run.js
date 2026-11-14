/* CalCheck v2 — service worker (MV3)
 * Runs in a background tab (active:false) so the popup keeps focus.
 * Compares: Flag, Event IDs, Package Tags, Date, Time, Pre/Duration/Post (exact match).
 * Navigates by Calendar ID + Program ID. English report.
 *
 * Entry module (MV3, "type": "module"): single run, batch run, message router.
 */
import { dbgDetach, dbgEarly } from "./capture.js";
import { checkOneCase } from "./check.js";
import { inj_closeModal, inj_url } from "./injected.js";
import { DESIGN_HOST, ensureWorkTab, exec, sleep, waitTabComplete } from "./navigate.js";
import { buildLog, closeOffscreen, notify, rowHasIssue, saveLog } from "./save.js";
import { CUR, RUN, setCUR, setRUN } from "./state.js";

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

  setCUR({ i: 1, n: 1, progId: p.progId });
  const res = await checkOneCase(tabId, p, navUrl, true);
  const row = { progId: p.progId, status: res.status, overall: res.overall || "", message: res.message || "", resultLines: res.resultLines || [], savedAs: res.savedAs || "", imageDataUrl: res.imageDataUrl || "", shotErr: res.shotErr || "", capDiag: res.capDiag || null, savedFallback: !!res.savedFallback };
  res.logText = buildLog(p.ticket, [row]);
  res.logSaved = rowHasIssue(row) ? await saveLog(p.ticket, res.logText) : "";
  if (res.status === "DONE" && !row.savedAs && !row.imageDataUrl) notify("CalCheck \u2014 screenshot failed", "No screenshot saved for " + p.progId + " (see log).");
  return res;
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
    setCUR({ i: i + 1, n: cases.length, progId: c.progId });
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
    setRUN({ active: true, mode: "single", saveMode: (msg.payload && msg.payload.saveMode) || "downloads", progress: { phase: "running" }, result: null, at: Date.now() });
    keepAlive(true);
    runCheck(msg.payload).then(res => { setRUN({ active: false, mode: "single", saveMode: RUN.saveMode, progress: null, result: res, at: Date.now() }); keepAlive(false); dbgDetach(); closeOffscreen(); sendResponse(res); })
      .catch(err => { const e = { status: "ERROR", message: (err && err.message) ? err.message : String(err) }; setRUN({ active: false, mode: "single", saveMode: RUN.saveMode, progress: null, result: e, at: Date.now() }); keepAlive(false); dbgDetach(); sendResponse(e); });
    return true;
  }
  if (msg && msg.action === "runBatch") {
    setRUN({ active: true, mode: "batch", saveMode: (msg.payload && msg.payload.saveMode) || "downloads", progress: { i: 0, n: (msg.payload && msg.payload.cases || []).length }, result: null, at: Date.now() });
    keepAlive(true);
    runBatch(msg.payload).then(res => { RUN.active = false; RUN.progress = null; RUN.result = res; RUN.at = Date.now(); keepAlive(false); dbgDetach(); sendResponse(res); })
      .catch(err => { const e = { status: "ERROR", message: (err && err.message) ? err.message : String(err) }; RUN.active = false; RUN.progress = null; RUN.result = e; RUN.at = Date.now(); keepAlive(false); dbgDetach(); sendResponse(e); });
    return true;
  }
  if (msg && msg.action === "getRunState") { sendResponse(RUN); return true; }
  if (msg && msg.action === "clearRunState") { setRUN({ active: false, mode: "", saveMode: "", progress: null, result: null, at: 0 }); sendResponse({ ok: true }); return true; }
  if (msg && msg.action === "closeWorkTab") {
    chrome.storage.session.get("workTabId").then(({ workTabId }) => {
      if (workTabId != null) { try { chrome.tabs.remove(workTabId); } catch (e) {} }
      chrome.storage.session.remove("workTabId");
      sendResponse({ ok: true });
    });
    return true;
  }
});
