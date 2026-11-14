// Work tab: open, wait, run injected code, go to a calendar / program.
import { inj_findClick, inj_modal, inj_url } from "./injected.js";

export const DESIGN_HOST = "design.km.globalworldwide.com";

// ============ orchestration ============
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function exec(tabId, func, args) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [], world: "MAIN" });
  return res && res[0] ? res[0].result : undefined;
}

export async function injectFile(tabId, file) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file], world: "MAIN" });
}

export function waitTabComplete(tabId, timeout) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = async () => {
      try { const t = await chrome.tabs.get(tabId); if (t.status === "complete") return resolve(true); }
      catch (e) { return resolve(false); }
      if (Date.now() - start > timeout) return resolve(true);
      setTimeout(tick, 300);
    };
    tick();
  });
}

export async function ensureWorkTab(navUrl) {
  const stored = await chrome.storage.session.get("workTabId");
  let tabId = stored.workTabId;
  if (tabId != null) { try { await chrome.tabs.get(tabId); } catch (e) { tabId = null; } }
  if (tabId == null) { const tab = await chrome.tabs.create({ url: navUrl, active: false }); tabId = tab.id; }
  else { await chrome.tabs.update(tabId, { url: navUrl, active: false }); }
  await chrome.storage.session.set({ workTabId: tabId });
  return tabId;
}

export async function openCalendar(tabId, calId, maxMs) {
  const start = Date.now(); let everFound = false, lastClick = 0;
  while (Date.now() - start < maxMs) {
    let url = ""; try { url = await exec(tabId, inj_url); } catch (e) {}
    if (url && url.indexOf("/design/calendar/") >= 0) return "OK";
    if (!lastClick || Date.now() - lastClick >= 5000) {
      const r = await exec(tabId, inj_findClick, [calId]);
      if (r === "CLICKED") { everFound = true; lastClick = Date.now(); }
    }
    await sleep(500);
  }
  return everFound ? "CLICK_NO_NAV" : "NOT_FOUND";
}

export async function openProgram(tabId, progId, maxMs) {
  const start = Date.now(); let everFound = false, lastClick = 0;
  while (Date.now() - start < maxMs) {
    let m = "NOMODAL"; try { m = await exec(tabId, inj_modal); } catch (e) {}
    if (m === "MODAL") return "OK";
    if (!lastClick || Date.now() - lastClick >= 2000) {
      const r = await exec(tabId, inj_findClick, [progId]);
      if (r === "CLICKED") { everFound = true; lastClick = Date.now(); }
    }
    await sleep(500);
  }
  return everFound ? "CLICK_NO_MODAL" : "NOT_FOUND";
}
