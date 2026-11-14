// Screenshot / report geometry and list-URL helpers (pure).
import { lc } from "./text.js";

// pure: the part of the page to photograph (table header + the matching rows)
export function planListClip(m) {
  const x = Math.max(0, Math.floor(m.hdrLeft - 40)), y = Math.max(0, Math.floor(m.hdrTop - 16));
  const width = Math.max(200, Math.floor(m.vw - x - 8));
  const height = Math.min(Math.max(60, Math.ceil(m.rowsBottom - y + 18)), Math.floor(m.vh - y));
  return { x, y, width, height, scale: 1 };
}

// pure: how the list picture and the popup picture are stacked, and where the red boxes land
export const TOP_SEP = 8;

export function topStackLayout(listPxW, listPxH, listClipW, modalPxW, modalPxH) {
  const k = listPxW / listClipW, sepPx = Math.round(TOP_SEP * k);
  const W = Math.max(listPxW, modalPxW);
  return { k, sepPx, W, H: listPxH + sepPx + modalPxH, yB: listPxH + sepPx, hAcss: listPxH / k, clipW: W / k };
}

export function topStackBoxes(lay, listShot, modalHl, tagFail) {
  const rects = [];
  if (tagFail && listShot && listShot.tagRect) rects.push(listShot.tagRect);
  ((modalHl && modalHl.rects) || []).forEach(r => rects.push({ x: r.x, y: r.y + lay.hAcss + TOP_SEP, w: r.w, h: r.h }));
  return rects;
}

// The calendars list holds hundreds of rows, sorted by Updated At and paged by 25: an older calendar is NOT on page 1
// of the plain list, so every lookup opens the list filtered by the calendar id (?term=<id>).
export function listUrlFor(navUrl, calId) { return calId ? withTerm(navUrl, calId) : navUrl; }

export function withTerm(url, term) {
  try { const u = new URL(url); u.searchParams.set("term", term); return u.toString(); }
  catch (e) { return url + (url.indexOf("?") >= 0 ? "&" : "?") + "term=" + encodeURIComponent(term); }
}

// pure: where to cut the two evidence parts (header / ticket rows) and where the red boxes
// land inside the stacked image. Both parts are plain viewport captures (no resizing).
export function planCalendarParts(mTop, mRows, hl) {
  const vh = mTop.vh, vw = mTop.vw;
  const ys = (mTop.progs || []).map(q => q.rect.y).filter(y => y > 0);
  const firstY = ys.length ? Math.min.apply(null, ys) : 420;
  const hA = Math.ceil(Math.min(vh, Math.max(320, firstY)));
  const clipA = { x: 0, y: 0, width: Math.ceil(vw), height: hA, scale: 1 };
  const rowsB = ((mRows && mRows.progs) || []).filter(q => q.want);
  let clipB = null;
  if (rowsB.length) {
    const top = Math.max(0, Math.floor(Math.min.apply(null, rowsB.map(q => q.rect.y)) - 30));
    const bottom = Math.min(vh, Math.ceil(Math.max.apply(null, rowsB.map(q => q.rect.y + q.rect.h)) + 20));
    if (bottom - top >= 40) clipB = { x: 0, y: top, width: Math.ceil(vw), height: bottom - top, scale: 1 };
  }
  const sep = 8, rects = [];
  if (hl && hl.flag && mTop.flag && mTop.flag.rect) rects.push(mTop.flag.rect);
  if (hl && hl.tag && mTop.tag && mTop.tag.rect) rects.push(mTop.tag.rect);
  if (clipB) ((hl && hl.rows) || []).forEach(id => { const pr = mRows.progs.find(q => lc(q.id) === lc(id)); if (pr) rects.push({ x: pr.rect.x, y: pr.rect.y - clipB.y + hA + sep, w: pr.rect.w, h: pr.rect.h }); });
  return { clipA, clipB, sep, rects };
}

// Compose the text report (verdict + check lines + actual data) above the modal
// screenshot, entirely in the service worker via OffscreenCanvas.
// text size follows the picture width (a wide full-page picture gets bigger text); the final image is
// scaled down to at most REPORT_MAX_W pixels wide to keep the files small
export const REPORT_MAX_W = 2400;

export function reportScale(imgPxW) { return Math.min(4, Math.max(2, (imgPxW || 0) / 1000)); }

export function reportOutSize(w, h) { const f = w > REPORT_MAX_W ? REPORT_MAX_W / w : 1; return { w: Math.round(w * f), h: Math.round(h * f), f }; }
