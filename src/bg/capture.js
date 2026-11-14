// Evidence screenshots through chrome.debugger (CDP), html2canvas as fallback.
import { HL_FN, inj_calScroll, inj_readCalendarPage, inj_readListRow, inj_shot, TITLE_RESTORE, TITLE_SET } from "./injected.js";
import { exec, injectFile, sleep } from "./navigate.js";
import { composeReport, stackShots, stackWithTop } from "./report.js";
import { CAP, capReset, progressNote } from "./state.js";
import { planCalendarParts, planListClip } from "../core/layout.js";
import { errText } from "../core/text.js";

let lastHl = null;

export async function debuggerShotList(tabId, calId) {
  if (CAP) CAP.method = "debugger";
  if (!(await dbgAttach(tabId))) { CAP.reason = "debugger attach failed"; return { url: "" }; }
  const T = { tabId }; await dbgTitle(T);
  const expr = "(" + inj_readListRow.toString() + ")(" + JSON.stringify(calId) + ")";
  try {
    await warmShot(T); dbgWarm = tabId;                 // every list page is freshly opened: warm it up first
    for (let attempt = 0; attempt < 3; attempt++) {
      CAP.tries = attempt + 1;
      const bad = async (why) => { CAP.reason = why; CAP.notes.push("list try " + (attempt + 1) + " rejected: " + why); await sleep(350); };
      if (attempt > 0) { progressNote("capture retry " + (attempt + 1) + "/3 (calendar list)"); CAP.notes.push("calendar list capture try " + (attempt + 1) + (attempt === 1 ? " (re-warmed)" : " (tab shown briefly)")); await warmShot(T); }
      await dbgStable(T, 2000);
      // wait until the table stops moving (two identical reads in a row)
      let m = null, prev = null;
      for (let k = 0; k < 8; k++) {
        m = await dbgEval(T, expr);
        if (m && m.found && prev && Math.abs(m.tagRect.y - prev.tagRect.y) < 0.5 && Math.abs(m.rowsBottom - prev.rowsBottom) < 0.5) break;
        prev = (m && m.found) ? m : null; await sleep(250);
      }
      if (!m || !m.found) { await bad("calendar row not found in the list"); continue; }
      const clip = planListClip(m);
      let shot = null;
      try { shot = await capClip(T, tabId, clip, attempt); } catch (e) { await bad("capture error: " + errText(e)); continue; }
      const m2 = await dbgEval(T, expr);
      if (!shot || !shot.data) { await bad("empty capture (list)"); continue; }
      if (!m2 || !m2.found || Math.abs(m2.tagRect.y - m.tagRect.y) > 1) { await bad("list moved during capture"); continue; }
      const url = "data:image/png;base64," + shot.data;
      if (!(await shotSizeOk(url, clip.width, clip.height, m.dpr || 1))) { await bad("wrong image size " + CAP.img + " (list)"); continue; }
      if (await shotTiled(url, true)) { await bad("tiled image rejected (list)"); continue; }
      const rel = r => r ? { x: r.x - clip.x, y: r.y - clip.y, w: r.w, h: r.h } : null;
      CAP.reason = attempt > 0 ? "ok on try " + (attempt + 1) : "";
      return { url, clip, tagRect: rel(m.tagRect), flagRect: rel(m.flagRect) };
    }
    return { url: "" };
  } catch (e) { CAP.reason = "error: " + errText(e); return { url: "" }; }
}

// The first frame after a page is opened can be stale: take one throw-away shot, then let it settle.
async function warmShot(T) { try { await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png" }); } catch (e) {} await sleep(300); }

async function capClip(T, tabId, clip, attempt) {
  const params = { format: "png", clip: Object.assign({ scale: 1 }, clip) };   // Chrome rejects a clip without "scale"
  let prevActive = null;
  if (attempt >= 2) {
    try {
      const wt = await chrome.tabs.get(tabId); const act = await chrome.tabs.query({ active: true, windowId: wt.windowId });
      if (act && act[0] && act[0].id !== tabId) prevActive = act[0].id;
      if (!wt.active) { await chrome.tabs.update(tabId, { active: true }); await sleep(450); }
    } catch (e) {}
  }
  try { return await chrome.debugger.sendCommand(T, "Page.captureScreenshot", params); }
  finally { if (prevActive != null) { try { await chrome.tabs.update(prevActive, { active: true }); } catch (e) {} } }
}

// Evidence for the calendar row = header (Flag / Tag) stacked above the ticket's program
// rows. Plain viewport captures only (resizing the viewport of a hidden tab made Chrome
// return a tiled image); each part is size-checked and rejected if tiled.
export async function debuggerShotCalendar(tabId, names, hl) {
  if (CAP) CAP.method = "debugger";
  if (!(await dbgAttach(tabId))) { CAP.reason = "debugger attach failed"; return { url: "" }; }
  const T = { tabId }; await dbgTitle(T);
  const fnSrc = inj_readCalendarPage.toString(), nm = JSON.stringify(names || []);
  const readTop = "(" + fnSrc + ")(" + nm + ", false)", readKeep = "(" + fnSrc + ")(" + nm + ", true)";
  const scrollExpr = "(" + inj_calScroll.toString() + ")(" + nm + ")";
  try {
    await warmShot(T); dbgWarm = tabId;
    const notes = ["normal", "re-warmed", "tab shown briefly"];
    for (let attempt = 0; attempt < 3; attempt++) {
      CAP.tries = attempt + 1;
      if (attempt > 0) { progressNote("capture retry " + (attempt + 1) + "/3"); CAP.notes.push("calendar capture try " + (attempt + 1) + ": " + notes[attempt]); await warmShot(T); }
      await dbgStable(T, 2000);
      const mTop = await dbgEval(T, readTop); if (!mTop || !mTop.progs) { CAP.reason = "calendar page not readable"; return { url: "" }; }
      CAP.viewport = Math.round(mTop.vw) + "x" + Math.round(mTop.vh) + (dbgLock ? " locked" : "");
      const planA = planCalendarParts(mTop, null, hl);
      // part A: header (scrolled to top)
      let shotA = null;
      try { shotA = await capClip(T, tabId, planA.clipA, attempt); } catch (e) { CAP.reason = "capture error: " + errText(e); CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      const mTop2 = await dbgEval(T, readKeep);
      const movedA = !mTop2 || (mTop.flag.rect && mTop2.flag.rect && Math.abs(mTop.flag.rect.y - mTop2.flag.rect.y) > 1);
      if (!shotA || !shotA.data) { CAP.reason = "empty capture"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      if (movedA) { CAP.reason = "page moved during capture"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      const urlA = "data:image/png;base64," + shotA.data;
      if (!(await shotSizeOk(urlA, planA.clipA.width, planA.clipA.height, mTop.dpr || 1))) { CAP.reason = "wrong image size " + CAP.img + " (header)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      if (await shotTiled(urlA, true)) { CAP.reason = "tiled image rejected (header)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      // part B: the ticket's program rows (scrolled into view)
      await dbgEval(T, scrollExpr); await sleep(400);
      const mRows = await dbgEval(T, readKeep);
      const plan = planCalendarParts(mTop, mRows, hl);
      let urlB = "";
      if (plan.clipB) {
        let shotB = null;
        try { shotB = await capClip(T, tabId, plan.clipB, attempt); } catch (e) { CAP.reason = "capture error (rows): " + errText(e); CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        const mRows2 = await dbgEval(T, readKeep);
        const w1 = (mRows.progs || []).filter(q => q.want), w2 = mRows2 && (mRows2.progs || []).filter(q => q.want);
        const movedB = !w2 || !w2.length || !w1.length || Math.abs(w2[0].rect.y - w1[0].rect.y) > 1;
        if (!shotB || !shotB.data) { CAP.reason = "empty capture (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        if (movedB) { CAP.reason = "page moved during capture (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        urlB = "data:image/png;base64," + shotB.data;
        if (!(await shotSizeOk(urlB, plan.clipB.width, plan.clipB.height, mTop.dpr || 1))) { CAP.reason = "wrong image size " + CAP.img + " (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
        if (await shotTiled(urlB, true)) { CAP.reason = "tiled image rejected (rows)"; CAP.notes.push("calendar try " + (attempt + 1) + " rejected: " + CAP.reason); await sleep(350); continue; }
      }
      try { await dbgEval(T, readTop); } catch (e) {} // leave the page scrolled to the top
      const url = await stackShots(urlA, urlB, plan.sep, plan.clipA.width);
      CAP.reason = attempt > 0 ? CAP.reason + " -> ok on try " + (attempt + 1) : "";
      return { url, hl: { rects: plan.rects, clipW: plan.clipA.width } };
    }
    return { url: "" };
  } catch (e) { CAP.reason = "error: " + ((e && e.message) || e); return { url: "" }; }
}

// ---- Method 2: capture via chrome.debugger (CDP). Works on a hidden tab with no
// tab flicker; attaches once per run (one "debugging" banner), detaches at the end.
let dbgTab = null, dbgWarm = null, dbgLock = null;

export async function dbgTitle(T) { try { await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: TITLE_SET }); } catch (e) {} }

export async function dbgAttach(tabId) {
  if (dbgTab === tabId) return true;
  if (dbgTab != null) await dbgDetach();
  try { await chrome.debugger.attach({ tabId }, "1.3"); await chrome.debugger.sendCommand({ tabId }, "Page.enable", {}); dbgTab = tabId; dbgWarm = null; return true; }
  catch (e) { dbgTab = null; return false; }
}

export async function dbgDetach() {
  if (dbgTab == null) return;
  const t = dbgTab, T = { tabId: t }; dbgTab = null; dbgWarm = null; dbgLock = null;
  try { await chrome.debugger.sendCommand(T, "Input.setIgnoreInputEvents", { ignore: false }); } catch (e) {}
  try { await chrome.debugger.sendCommand(T, "Emulation.clearDeviceMetricsOverride", {}); } catch (e) {}
  try { await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: TITLE_RESTORE }); } catch (e) {}
  try { await chrome.debugger.detach({ tabId: t }); } catch (e) {}
}

// Wait until the viewport size stops changing (3 equal reads ~150ms apart). The
// debugging banner appears asynchronously after attach and resizes the viewport.
export async function dbgStable(T, maxMs) {
  let prev = null, same = 0; const t0 = Date.now();
  while (Date.now() - t0 < (maxMs || 3000)) {
    let v = null; try { v = await dbgEval(T, "JSON.stringify({w:window.innerWidth,h:window.innerHeight})"); } catch (e) {}
    if (v && prev && v.w === prev.w && v.h === prev.h) { if (++same >= 2) return true; } else same = 0;
    prev = v; await sleep(150);
  }
  return false;
}

// Attach at run start (before the first popup is opened) and give the banner time to land.
export async function dbgEarly(tabId) {
  try {
    if (!(await dbgAttach(tabId))) return;
    const T = { tabId };
    await sleep(900); await dbgStable(T, 2500);
    // Lock the viewport size AND device-pixel-ratio for the whole run so layout and
    // capture always use the same scale (a never-shown tab otherwise renders its
    // first frame at x1 while laying out at x2 -> tiled/offset first screenshot).
    const v = await dbgEval(T, "JSON.stringify({w:window.innerWidth,h:window.innerHeight,dpr:window.devicePixelRatio||1})");
    if (v && v.w && v.h) {
      await chrome.debugger.sendCommand(T, "Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: false });
      dbgLock = { w: v.w, h: v.h, dpr: v.dpr };
      await sleep(300);
    }
    // Block the user's mouse/keyboard on this tab (the tool drives the page from inside,
    // not via input events, so it keeps working); mark the tab title.
    try { await chrome.debugger.sendCommand(T, "Input.setIgnoreInputEvents", { ignore: true }); } catch (e) {}
    await dbgTitle(T);
  } catch (e) {}
}

async function dbgEval(T, expr) {
  const ev = await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: expr, returnByValue: true });
  const v = ev && ev.result ? ev.result.value : null;
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

// Size check: a good capture is clip size x devicePixelRatio (or x1).
async function shotSizeOk(dataUrl, w, h, dpr) {
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    if (CAP) CAP.img = bmp.width + "x" + bmp.height;
    const near = (a, b) => Math.abs(a - b) <= Math.max(4, b * 0.02);
    return (near(bmp.width, w * dpr) && near(bmp.height, h * dpr)) || (near(bmp.width, w) && near(bmp.height, h));
  } catch (e) { return false; }
}

// Tiled-image guard: a duplicated capture has identical left/right (or top/bottom)
// halves. Compare the halves on a small downscale; ~0 difference = tiled -> reject.
async function shotTiled(dataUrl, both) {
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const W = 96, H = 96, c = new OffscreenCanvas(W, H), x = c.getContext("2d");
    x.drawImage(bmp, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, at = (i, j) => (j * W + i) * 4;
    const diff = (p, q) => (Math.abs(d[p] - d[q]) + Math.abs(d[p + 1] - d[q + 1]) + Math.abs(d[p + 2] - d[q + 2])) / 3;
    let lr = 0, tb = 0, n1 = 0, n2 = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W / 2; i++) { lr += diff(at(i, j), at(i + W / 2, j)); n1++; }
    for (let j = 0; j < H / 2; j++) for (let i = 0; i < W; i++) { tb += diff(at(i, j), at(i, j + H / 2)); n2++; }
    lr /= n1; tb /= n2;
    if (CAP) CAP.tile = lr.toFixed(1) + "/" + tb.toFixed(1);
    return both ? (lr < 1.5 && tb < 1.5) : (lr < 1.5 || tb < 1.5);
  } catch (e) { return false; }
}

// Capture the KM popup via CDP without touching the page layout. Viewport + DPR are
// locked for the run (dbgEarly); each try waits for a stable viewport, measures,
// captures, re-measures, and rejects moved / wrong-size / tiled images (max 3 tries).
// Program picture: the whole visible page (breadcrumb "Design / Calendars / <calendar> / <flag>", the
// dimmed background and the popup) so the picture itself shows which calendar is being checked.
// If a full-page shot is rejected twice, the last try falls back to the popup only.
const FULL_PAGE_SHOT = true;

async function debuggerShotModal(tabId, labels) {
  lastHl = null;
  if (CAP) CAP.method = "debugger";
  if (!(await dbgAttach(tabId))) { if (CAP) CAP.reason = "debugger attach failed"; return ""; }
  const T = { tabId };
  await dbgTitle(T);
  const measure = "(function(){var r=document.querySelector('.MuiDialog-paper');if(!r)return 'null';var b=r.getBoundingClientRect();var ov=Math.max(0,r.scrollHeight-r.clientHeight),e=r.querySelectorAll('*');for(var i=0;i<e.length;i++){var x=e[i];if(x.scrollHeight>x.clientHeight+2){var oy=getComputedStyle(x).overflowY;if(oy==='auto'||oy==='scroll')ov=Math.max(ov,x.scrollHeight-x.clientHeight);}}return JSON.stringify({x:b.left+window.scrollX,y:b.top+window.scrollY,w:b.width,h:b.height,sh:r.scrollHeight,ov:ov,vw:window.innerWidth,vh:window.innerHeight,dpr:window.devicePixelRatio||1});})()";
  // last resort only: unclip inner scroll areas (restored right after the capture)
  const EXPAND = "(function(){var s=[],r=document.querySelector('.MuiDialog-paper');if(!r)return 0;var e=[r].concat([].slice.call(r.querySelectorAll('*')));e.forEach(function(x){if(x.scrollHeight>x.clientHeight+2){var oy=getComputedStyle(x).overflowY;if(oy==='auto'||oy==='scroll'||x===r){s.push([x,x.style.overflow,x.style.maxHeight,x.style.height]);x.style.overflow='visible';x.style.maxHeight='none';x.style.height='auto';}}});window.__ccExp=s;return s.length;})()";
  const UNEXPAND = "(function(){var s=window.__ccExp||[];s.forEach(function(a){a[0].style.overflow=a[1];a[0].style.maxHeight=a[2];a[0].style.height=a[3];});window.__ccExp=null;return s.length;})()";
  let overridden = false, expanded = false;
  try {
    let m = await dbgEval(T, measure);
    if (!m || !m.w || !m.h) { CAP.reason = "popup not found"; return ""; }
    CAP.viewport = Math.round(m.vw) + "x" + Math.round(m.vh) + " @" + m.dpr + "x" + (dbgLock ? " locked" : "");
    if (m.ov > 2 || m.sh > m.h + 2 || m.h > m.vh - 8) {
      // popup body scrolls inside the popup -> make the viewport taller by the hidden
      // part; the KM popup grows with the window, so all rows become visible
      const H = Math.ceil(m.vh + Math.max(m.ov, m.sh - m.h, 0) + 120);
      await chrome.debugger.sendCommand(T, "Emulation.setDeviceMetricsOverride", { width: dbgLock ? dbgLock.w : Math.ceil(m.vw), height: H, deviceScaleFactor: dbgLock ? dbgLock.dpr : 0, mobile: false });
      overridden = true; CAP.notes.push("popup had hidden rows (" + Math.round(m.ov) + "px) -> viewport enlarged to " + H + "px");
      await sleep(450); await dbgStable(T, 2000);
      m = await dbgEval(T, measure);
      if (!m || !m.w || !m.h) { CAP.reason = "popup not found after enlarge"; return ""; }
      if (m.ov > 2) {
        const n = await dbgEval(T, "JSON.stringify(" + EXPAND + ")");
        expanded = true; CAP.notes.push("still " + Math.round(m.ov) + "px hidden after enlarge -> unclipped " + n + " scroll area(s)");
        await sleep(350); await dbgStable(T, 2000);
        m = await dbgEval(T, measure);
        if (!m || !m.w || !m.h) { CAP.reason = "popup not found after unclip"; return ""; }
      }
    }
    if (dbgWarm !== tabId) {
      try { await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png" }); } catch (e) {}
      dbgWarm = tabId;
      await sleep(250);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      CAP.tries = attempt + 1;
      if (attempt > 0) progressNote("capture retry " + (attempt + 1) + "/3");
      await dbgStable(T, 2500);
      const m1 = await dbgEval(T, measure);
      if (!m1 || !m1.w || !m1.h) { CAP.reason = "popup not found"; return ""; }
      const full = FULL_PAGE_SHOT && attempt < 2;       // tries 1-2: whole page; try 3: popup only
      if (FULL_PAGE_SHOT && attempt === 2) CAP.notes.push("full-page picture rejected twice -> popup only");
      const clip = full ? { x: 0, y: 0, width: Math.ceil(m1.vw), height: Math.ceil(m1.vh), scale: 1 }
        : { x: Math.max(0, Math.floor(m1.x)), y: Math.max(0, Math.floor(m1.y)), width: Math.ceil(m1.w), height: Math.ceil(m1.h), scale: 1 };
      const shot = await chrome.debugger.sendCommand(T, "Page.captureScreenshot", { format: "png", clip });
      const m2 = await dbgEval(T, measure);
      const moved = !m2 || Math.abs(m2.x - m1.x) > 1 || Math.abs(m2.y - m1.y) > 1 || Math.abs(m2.w - m1.w) > 1 || Math.abs(m2.h - m1.h) > 1;
      if (!shot || !shot.data) { CAP.reason = "empty capture"; await sleep(350); continue; }
      if (moved) { CAP.reason = "popup moved during capture"; await sleep(350); continue; }
      const url = "data:image/png;base64," + shot.data;
      if (!(await shotSizeOk(url, clip.width, clip.height, m1.dpr))) { CAP.reason = "wrong image size " + CAP.img; await sleep(350); continue; }
      if (await shotTiled(url, full)) { CAP.reason = "tiled image rejected"; await sleep(350); continue; }
      CAP.reason = attempt > 0 ? CAP.reason + " -> ok on try " + (attempt + 1) : "";
      if (labels && labels.length) {
        try {
          const rects = await dbgEval(T, "JSON.stringify((" + HL_FN + ")(" + JSON.stringify(labels) + "))");
          // the boxes are measured from the popup's corner; in a full-page picture the popup sits at (m1.x, m1.y)
          lastHl = { rects: (rects || []).map(r => full ? { x: r.x + m1.x, y: r.y + m1.y, w: r.w, h: r.h } : r), clipW: clip.width };
        } catch (e) {}
      }
      return url;
    }
    return "";
  } catch (e) { CAP.reason = "error: " + ((e && e.message) || e); return ""; }
  finally {
    if (expanded) { try { await chrome.debugger.sendCommand(T, "Runtime.evaluate", { expression: UNEXPAND }); } catch (e) {} }
    if (overridden) {
      try {
        if (dbgLock) await chrome.debugger.sendCommand(T, "Emulation.setDeviceMetricsOverride", { width: dbgLock.w, height: dbgLock.h, deviceScaleFactor: dbgLock.dpr, mobile: false });
        else await chrome.debugger.sendCommand(T, "Emulation.clearDeviceMetricsOverride", {});
      } catch (e) {}
    }
  }
}

export async function captureShot(tabId, payload) {
  capReset();
  (payload.preNotes || []).forEach(n => CAP.notes.push(n));
  // Primary: chrome.debugger capture (no flicker, works on a hidden tab).
  try { const modal = await debuggerShotModal(tabId, payload.highlight); if (modal) {
      let img = modal, hl = lastHl;
      if (payload.listShot && payload.listShot.url) { try { const st = await stackWithTop(payload.listShot, modal, lastHl, !!payload.tagFail); img = st.url; hl = st.hl; } catch (e) { CAP.notes.push("could not stack the list picture: " + ((e && e.message) || e)); } }
      const composed = await composeReport(img, payload, hl); if (composed) return composed; CAP.reason = "compose failed"; } } catch (e) { CAP.reason = "error: " + ((e && e.message) || e); }
  CAP.notes.push("debugger capture failed (" + (CAP.reason || "unknown") + ")");
  CAP.method = "html2canvas";
  // Fallback: html2canvas (needs the tab visible for an instant).
  let prevActiveId = null;
  try { const wt = await chrome.tabs.get(tabId); const act = await chrome.tabs.query({ active: true, windowId: wt.windowId }); if (act && act[0] && act[0].id !== tabId) prevActiveId = act[0].id; if (!wt.active) { await chrome.tabs.update(tabId, { active: true }); await sleep(260); } } catch (e) {}
  let dataUrl = "";
  try { await injectFile(tabId, "src/lib/html2canvas.min.js"); dataUrl = await exec(tabId, inj_shot, [payload]); } catch (e) { dataUrl = ""; }
  try { if (prevActiveId != null) await chrome.tabs.update(prevActiveId, { active: true }); } catch (e) {}
  if (!(typeof dataUrl === "string" && dataUrl.indexOf("data:image/png") === 0)) { CAP.method = "none"; CAP.notes.push("html2canvas fallback failed"); }
  return dataUrl;
}
