// Saving: screenshots (chosen folder via offscreen writer, Downloads fallback), run log, notification.
import { CAP } from "./state.js";
import { safeName } from "../core/text.js";

export function notify(title, message) {
  try { chrome.notifications.create("", { type: "basic", iconUrl: chrome.runtime.getURL("src/icons/icon128.png"), title, message, priority: 2 }); } catch (e) {}
}

// ---- run log (saved only when something went wrong: retry / fallback / no image / error)
export function rowHasIssue(r) {
  const d = r.capDiag || {};
  return r.status !== "DONE" || r.overall === "FAIL" || !(r.savedAs || r.imageDataUrl) || r.savedFallback || (d.tries || 0) > 1 || (d.method && d.method !== "debugger");
}

export function buildLog(ticket, rows) {
  const pad = (x, n) => { x = String(x == null ? "" : x); return x.length >= n ? x : x + " ".repeat(n - x.length); };
  const L = ["CalCheck log \u2014 " + (ticket || "(no ticket)") + " \u2014 " + new Date().toLocaleString() + " \u2014 v" + chrome.runtime.getManifest().version];
  rows.forEach((r, k) => {
    const d = r.capDiag || {};
    let line = "[" + (k + 1) + "/" + rows.length + "] " + pad(r.progId, 28) + " " + pad(r.status === "DONE" ? r.overall : "ERR", 5)
      + "  capture=" + pad(d.method || "-", 11) + " img=" + pad(d.img || "-", 10) + " tries=" + (d.tries || 0);
    if (d.viewport) line += "  vp=" + d.viewport;
    if (d.tile) line += "  tile=" + d.tile;
    if (d.reason) line += "  (" + d.reason + ")";
    L.push(line);
    (d.notes || []).forEach(n => L.push("      note: " + n));
    (r.resultLines || []).filter(l => l.pass === false).forEach(l => L.push("      fail: " + l.line));
    const okL = []; (r.resultLines || []).filter(l => l.pass === true).forEach(l => { const lab = String(l.line).replace(/^[^A-Za-z]+/, "").match(/^(?:Calendar )?[A-Za-z][A-Za-z -]*?(?=\s*(?::|'|\u2014|\s\())/); const nm = (lab ? lab[0] : String(l.line).slice(0, 18)).trim(); okL.push(nm); });
    if (okL.length) { const cnt = {}; okL.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; }); L.push("      ok: " + Object.keys(cnt).map(k => k + (cnt[k] > 1 ? " x" + cnt[k] : "")).join(", ")); }
    if (r.status !== "DONE" && r.message) L.push("      error: " + String(r.message).replace(/\n/g, " | "));
    if (r.shotErr) L.push("      screenshot: " + r.shotErr);
  });
  return L.join("\n");
}

// ---- saving: chosen folder via the offscreen writer (no popup needed); Downloads fallback
async function ensureOffscreen() {
  try {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return true;
    await chrome.offscreen.createDocument({ url: chrome.runtime.getURL("src/offscreen.html"), reasons: ["BLOBS"], justification: "Write evidence screenshots into the folder the user chose." });
    return true;
  } catch (e) { return /single offscreen|only a single|already/i.test(String((e && e.message) || e)); }
}

export async function closeOffscreen() { try { if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); } catch (e) {} }

export async function saveImage(p, baseName, dataUrl) {
  const base = safeName(baseName) || "calcheck";
  if (p.saveMode === "folder") {
    let r = null;
    if (await ensureOffscreen()) {
      try { r = await chrome.runtime.sendMessage({ target: "offscreen", type: "writeFile", name: base + ".png", dataUrl }); }
      catch (e) { r = { ok: false, reason: String((e && e.message) || e) }; }
    }
    if (r && r.ok) return { savedAs: r.name + "  ->  " + r.folder + " (chosen folder)", fallback: false };
    if (CAP) CAP.notes.push("folder write failed (" + ((r && r.reason) || "offscreen writer unavailable") + ") -> saved to Downloads/CalCheck");
  }
  const fname = "CalCheck/" + base + ".png";
  await chrome.downloads.download({ url: dataUrl, filename: fname, conflictAction: "uniquify", saveAs: false });
  return { savedAs: fname, fallback: p.saveMode === "folder" };
}

function logStamp() { const d = new Date(), z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + z(d.getMinutes()); }

export async function saveLog(ticket, text) {
  const name = "CalCheck/CalCheck_log_" + (ticket || "run").replace(/[^A-Za-z0-9._-]+/g, "_") + "_" + logStamp() + ".txt";
  try { await chrome.downloads.download({ url: "data:text/plain;charset=utf-8," + encodeURIComponent(text), filename: name, conflictAction: "uniquify", saveAs: false }); return name; }
  catch (e) { return ""; }
}
