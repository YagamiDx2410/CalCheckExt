// Functions / snippets injected into the KM page (executeScript or .toString()).
// Chrome ships only the function body, so every inj_* MUST stay self-contained:
// no import, no call to anything declared outside the function.

// ============ injected (MAIN world) ============
export function inj_findClick(targetText) {
  var target = (targetText || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) return "NOTARGET";
  var nodes = document.querySelectorAll("a,span,div,td,th,p,button,li");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.children.length === 0) {
      var t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (t === target) {
        try { el.scrollIntoView({ block: "center" }); } catch (e) {}
        try { el.click(); } catch (e) { return "CLICKFAIL"; }
        return "CLICKED";
      }
    }
  }
  return "NOTFOUND";
}

export function inj_url() { return location.href; }

export function inj_modal() { return document.querySelector(".MuiDialog-paper") ? "MODAL" : "NOMODAL"; }

export function inj_closeModal() {
  var root = document.querySelector(".MuiDialog-paper");
  if (!root) return "NOMODAL";
  // try a close button first
  var btns = root.querySelectorAll('button[aria-label],button');
  for (var i = 0; i < btns.length; i++) {
    var al = (btns[i].getAttribute("aria-label") || "").toLowerCase();
    if (al.indexOf("close") >= 0) { try { btns[i].click(); return "CLOSED"; } catch (e) {} }
  }
  // else click the backdrop
  var bd = document.querySelector(".MuiBackdrop-root");
  if (bd) { try { bd.click(); return "CLOSED"; } catch (e) {} }
  // else press Escape
  try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true })); } catch (e) {}
  return "ESC";
}

function inj_rowCount() { return document.querySelectorAll("span.cursor-pointer.underline").length; }

export function inj_readModal() {
  var root = document.querySelector(".MuiDialog-paper");
  if (!root) return "NOMODAL";
  function cell(label) {
    var all = root.querySelectorAll("div,td,th,span,p");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && (el.textContent || "").trim() === label) {
        return el.parentElement ? el.parentElement.nextElementSibling : null;
      }
    }
    return null;
  }
  function gv(label) { var c = cell(label); return c ? (c.textContent || "").trim() : ""; }
  function gvLines(label) { var c = cell(label); if (!c) return ""; var t = (c.innerText || c.textContent || ""); return t.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).join("\n"); }
  function gvIds(label) {
    var c = cell(label); if (!c) return "";
    var chips = c.querySelectorAll(".MuiChip-label");
    if (chips.length) { var a = []; for (var j = 0; j < chips.length; j++) { var tx = (chips[j].textContent || "").trim(); if (tx) a.push(tx); } return a.join(", "); }
    return String(c.innerText || c.textContent || "").split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean).join(", ");
  }
  function gvChips(label) {
    var c = cell(label);
    if (!c) return "";
    var chips = c.querySelectorAll(".MuiChip-label");
    if (!chips.length) return (c.textContent || "").trim();
    var a = [];
    for (var j = 0; j < chips.length; j++) { var tx = (chips[j].textContent || "").trim(); if (tx) a.push(tx); }
    return a.join(", ");
  }
  var titleChips = root.querySelectorAll(".MuiDialogTitle-root .MuiChip-label");
  if (!titleChips.length) titleChips = root.querySelectorAll(".MuiChip-label"); // fallback if title markup differs
  var idT = "", flagT = "";
  for (var t = 0; t < titleChips.length; t++) {
    var tx = (titleChips[t].textContent || "").trim();
    if (!tx) continue;
    if (!idT && tx.indexOf(".") >= 0 && tx.indexOf(" ") < 0) { idT = tx; continue; }   // dotted -> program id
    if (!flagT && tx.indexOf("-") >= 0 && tx.indexOf(" ") < 0) { flagT = tx; continue; } // hyphen -> flag
  }
  if (!idT && titleChips[0]) idT = (titleChips[0].textContent || "").trim();
  if (!flagT && titleChips[1]) flagT = (titleChips[1].textContent || "").trim();
  return [idT, flagT, gvChips("Event IDs"), gvChips("Package Tags"),
          gvLines("When"), gv("Pre-Duration"), gv("Duration"), gv("Post-Duration"),
          gvChips("County Config IDs"), gvIds("Shard Tag"),
          gv("Global"), gvLines("Repeats"), gv("Ends after"), gvChips("Calendar IDs")].join("\u00A7\u00A7");
}

// Boss-spawn: on a calendar's PROGRAMS list, return the program-ID strings of every
// row whose Content column contains the given coc id. Rows are located generically:
// for each clickable ID (span.cursor-pointer.underline) climb to the smallest
// ancestor that contains the coc text AND exactly one ID (i.e. a single row).
export function inj_findRowsByContent(coc) {
  var want = (coc || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!want) return "[]";
  var ids = document.querySelectorAll("span.cursor-pointer.underline");
  var seen = {}, out = [];
  for (var i = 0; i < ids.length; i++) {
    var idEl = ids[i];
    var idText = (idEl.textContent || "").replace(/\s+/g, " ").trim();
    if (!idText) continue;
    var node = idEl.parentElement, hitNode = null;
    for (var up = 0; up < 12 && node; up++) {
      if ((node.textContent || "").toLowerCase().indexOf(want) >= 0) { hitNode = node; break; }
      node = node.parentElement;
    }
    if (hitNode) {
      var idCount = hitNode.querySelectorAll("span.cursor-pointer.underline").length;
      if (idCount === 1 && !seen[idText]) { seen[idText] = 1; out.push(idText); }
    }
  }
  return JSON.stringify(out);
}

export async function inj_shot(payload) {
  var root = document.querySelector(".MuiDialog-paper");
  if (!root) return "NOMODAL";
  if (typeof window.html2canvas !== "function") return "NOLIB";
  // Temporarily unclip scrollable areas so the FULL popup (all chips/rows) is
  // captured, not just the visible part; styles are restored right after.
  var saved = [], rootSaved = null;
  try {
    var scan = root.querySelectorAll("*");
    for (var qi = 0; qi < scan.length; qi++) {
      var el = scan[qi];
      if (el.scrollHeight > el.clientHeight + 2) {
        saved.push([el, el.style.overflow, el.style.maxHeight, el.style.height]);
        el.style.overflow = "visible"; el.style.maxHeight = "none"; el.style.height = "auto";
      }
    }
    rootSaved = [root.style.overflow, root.style.maxHeight, root.style.height];
    root.style.overflow = "visible"; root.style.maxHeight = "none"; root.style.height = "auto";
  } catch (e) { /* expansion best-effort */ }
  var mc = null;
  try { mc = await window.html2canvas(root, { backgroundColor: "#ffffff", scale: 2, logging: false, useCORS: true }); } catch (e) { mc = null; }
  // restore styles no matter what
  try {
    for (var ri = saved.length - 1; ri >= 0; ri--) { saved[ri][0].style.overflow = saved[ri][1]; saved[ri][0].style.maxHeight = saved[ri][2]; saved[ri][0].style.height = saved[ri][3]; }
    if (rootSaved) { root.style.overflow = rootSaved[0]; root.style.maxHeight = rootSaved[1]; root.style.height = rootSaved[2]; }
  } catch (e) {}
  // if the expanded capture failed, retry once with the modal as-is
  if (!mc) { try { mc = await window.html2canvas(root, { backgroundColor: "#ffffff", scale: 2, logging: false, useCORS: true }); } catch (e) { mc = null; } }
  if (mc && payload.highlight && payload.highlight.length) {
    try {
      var pb = root.getBoundingClientRect(), k2 = mc.width / (pb.width || mc.width), c2 = mc.getContext("2d");
      var rowOf = function (label) { var all = root.querySelectorAll("div,td,th,span,p"); for (var i = 0; i < all.length; i++) { var el = all[i]; if (el.children.length === 0 && (el.textContent || "").trim() === label) { var lc = el.parentElement; return lc && lc.parentElement ? lc.parentElement : lc; } } return null; };
      c2.strokeStyle = "#e01e1e"; c2.lineWidth = Math.max(3, Math.round(2.5 * k2));
      payload.highlight.forEach(function (l) {
        var el = null;
        if (l === "__flag") { var cs = root.querySelectorAll(".MuiDialogTitle-root .MuiChip-root"); el = cs.length > 1 ? cs[1] : root.querySelector(".MuiDialogTitle-root"); }
        else el = rowOf(l);
        if (el) { var b = el.getBoundingClientRect(); if (b.width && b.height) c2.strokeRect((b.left - pb.left) * k2 + 2, (b.top - pb.top) * k2 + 2, b.width * k2 - 4, b.height * k2 - 4); }
      });
    } catch (e) {}
  }
  var S = 2, pad = 20 * S;
  var overall = payload.overall, baseName = payload.progId, ts = payload.ts;
  var resultLines = payload.resultLines || [], actualLines = payload.actualLines || [];
  var color = overall === "PASS" ? "#0a7d28" : (overall === "FAIL" ? "#c00" : "#555");
  var head = [];
  head.push({ t: "CalCheck \u2014 RESULT: " + overall, c: color, b: true, s: 22 });
  head.push({ t: "Program: " + baseName + "   (" + ts + ")", c: "#333", s: 14 });
  head.push({ t: "", s: 8 });
  resultLines.forEach(function (l) { head.push({ t: l.line, b: !!l.bold, c: l.pass === false ? "#c00" : (l.pass === true ? "#0a7d28" : "#333"), s: 15 }); });
  head.push({ t: "", s: 8 });
  actualLines.forEach(function (l) { head.push({ t: l, c: "#555", s: 13 }); });
  if (!mc) head.push({ t: "(KM modal image unavailable \u2014 text report only)", c: "#c00", s: 13 });
  var lh = function (o) { return (o.s || 15) * S * 1.5; };
  var headerH = pad * 2 + head.reduce(function (a, o) { return a + lh(o); }, 0);
  var W = Math.max(mc ? mc.width : 0, 1100 * S);
  var out = document.createElement("canvas");
  out.width = W; out.height = Math.round(headerH) + (mc ? mc.height : 0);
  var ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = "top";
  var y = pad;
  head.forEach(function (o) {
    var sz = (o.s || 15) * S;
    ctx.fillStyle = o.c || "#333";
    ctx.font = (o.b ? "700 " : "") + sz + "px -apple-system, system-ui, Arial";
    if (o.t) ctx.fillText(o.t, pad, y);
    y += lh(o);
  });
  if (mc) {
    ctx.strokeStyle = "#e0e0e0"; ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(out.width, headerH); ctx.stroke();
    ctx.drawImage(mc, 0, Math.round(headerH));
  }
  return out.toDataURL("image/png");
}

// in-page: rects (relative to the popup) of the rows/chips to highlight
export const HL_FN = "function(labels){var r=document.querySelector('.MuiDialog-paper');if(!r)return [];var pb=r.getBoundingClientRect();function rowOf(label){var all=r.querySelectorAll('div,td,th,span,p');for(var i=0;i<all.length;i++){var el=all[i];if(el.children.length===0&&(el.textContent||'').trim()===label){var lc=el.parentElement;return lc&&lc.parentElement?lc.parentElement:lc;}}return null;}var out=[];(labels||[]).forEach(function(l){var el=null;if(l==='__flag'){var cs=r.querySelectorAll('.MuiDialogTitle-root .MuiChip-root');el=cs.length>1?cs[1]:r.querySelector('.MuiDialogTitle-root');}else el=rowOf(l);if(el){var b=el.getBoundingClientRect();if(b.width&&b.height)out.push({x:b.left-pb.left,y:b.top-pb.top,w:b.width,h:b.height});}});return out;}";

// ===== Picture 1 of the report: the calendars list filtered by the calendar id =====
// (what you see when you search the calendar by hand: ID | Flag | Tag ...). The Tag / Flag of the
// calendar are read from that row; the picture is stacked above the program popup.
export function inj_readListRow(calId) {
  var all = document.querySelectorAll("div,span,p,td,th,a"), L = [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i]; if (e.children.length) continue;
    var t = (e.textContent || "").trim(); if (!t) continue;
    var b = e.getBoundingClientRect(); if (b.width) L.push({ t: t, b: b });
  }
  function rc(b) { return { x: b.left, y: b.top, w: b.width, h: b.height }; }
  var hdr = {};
  ["ID", "Flag", "Tag"].forEach(function (name) { for (var k = 0; k < L.length; k++) if (L[k].t === name && L[k].b.top > 100 && L[k].b.top < 360) { hdr[name] = L[k].b; break; } });
  if (!hdr.ID || !hdr.Tag) return JSON.stringify({ found: false });
  var idc = null;
  for (var j = 0; j < L.length; j++) if (L[j].t === calId && L[j].b.top > hdr.ID.bottom - 2) { idc = L[j]; break; }
  if (!idc) return JSON.stringify({ found: false });
  var mid = idc.b.top + idc.b.height / 2, cells = L.filter(function (c) { return Math.abs(c.b.top + c.b.height / 2 - mid) < 20; });
  function under(name) {
    var h = hdr[name]; if (!h) return null; var best = null;
    cells.forEach(function (c) { var ov = Math.min(c.b.right, h.right + 40) - Math.max(c.b.left, h.left - 10); if (ov > 0 && (!best || Math.abs(c.b.left - h.left) < Math.abs(best.b.left - h.left))) best = c; });
    return best;
  }
  var fl = under("Flag"), tg = under("Tag");
  var ids = L.filter(function (c) { return /^cal\./i.test(c.t) && Math.abs(c.b.left - hdr.ID.left) < 14 && c.b.top > hdr.ID.bottom - 2; }).sort(function (a, b) { return a.b.top - b.b.top; }).slice(0, 4);
  var rowsBottom = idc.b.bottom; ids.forEach(function (c) { if (c.b.bottom > rowsBottom) rowsBottom = c.b.bottom; });
  if (tg && tg.b.bottom > rowsBottom) rowsBottom = tg.b.bottom;
  var tagRect = tg ? rc(tg.b) : { x: hdr.Tag.left - 6, y: idc.b.top - 6, w: hdr.Tag.width + 20, h: idc.b.height + 12 };
  return JSON.stringify({ found: true, flag: fl ? fl.t : "", tag: tg ? tg.t : "", flagRect: fl ? rc(fl.b) : null, tagRect: tagRect, hdrLeft: hdr.ID.left, hdrTop: hdr.ID.top, rowsBottom: rowsBottom, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 });
}

// ===== KvK calendar-level check: Flag + Tag on the calendar page, events across its programs =====
// Injected into the calendar page: header Flag/Tag (found by column position under their
// labels) and the programs list (id + ev.* ids per row, with on-screen rectangles).
export function inj_readCalendarPage(names, keepScroll) {
  var want = {}; (names || []).forEach(function (n) { want[String(n).toLowerCase()] = 1; });
  var ids = document.querySelectorAll("span.cursor-pointer.underline");
  if (!keepScroll) {
    try { window.scrollTo(0, 0); } catch (e) {}
    for (var q = 0; q < ids.length && q < 3; q++) { var a = ids[q].parentElement; while (a) { if (a.scrollTop) a.scrollTop = 0; a = a.parentElement; } }
  }
  var all = document.querySelectorAll("div,span,p,td,th,a"), L = [];
  for (var i = 0; i < all.length; i++) { var e = all[i]; if (e.children.length === 0 && (e.textContent || "").trim()) L.push(e); }
  function rect(el) { var b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }
  function first(t) { for (var k = 0; k < L.length; k++) if ((L[k].textContent || "").trim() === t && L[k].getBoundingClientRect().width) return L[k]; return null; }
  var labs = [];
  ["Flag", "Tag", "Calendar Type", "Notes"].forEach(function (t) { var el = first(t); if (el) labs.push({ t: t, el: el, r: el.getBoundingClientRect() }); });
  labs.sort(function (x, y) { return x.r.left - y.r.left; });
  function under(t) {
    var k = -1; for (var m = 0; m < labs.length; m++) if (labs[m].t === t) k = m;
    if (k < 0) return { v: "", rect: null };
    var lb = labs[k].r, lo = lb.left - 14, hi = (k + 1 < labs.length) ? labs[k + 1].r.left - 6 : lb.left + 320, best = null;
    for (var j = 0; j < L.length; j++) {
      var b = L[j].getBoundingClientRect(), tx = (L[j].textContent || "").trim();
      if (!b.width || !tx) continue;
      if (b.top < lb.bottom - 2 || b.top > lb.bottom + 140) continue;
      if (b.left < lo || b.left >= hi) continue;
      if (!best || b.top < best.b.top - 1 || (Math.abs(b.top - best.b.top) <= 1 && b.left < best.b.left)) best = { el: L[j], b: b, tx: tx };
    }
    return best ? { v: best.tx, rect: rect(best.el) } : { v: "", rect: rect(labs[k].el) };
  }
  var progs = [], seen = {};
  for (var p = 0; p < ids.length; p++) {
    var idEl = ids[p], idText = (idEl.textContent || "").replace(/\s+/g, " ").trim();
    if (!idText || seen[idText]) continue; seen[idText] = 1;
    var best2 = idEl.parentElement, node = idEl.parentElement;
    while (node && node !== document.body) { var c = node.querySelectorAll("span.cursor-pointer.underline").length; if (c === 1) best2 = node; else if (c > 1) break; node = node.parentElement; }
    var evs = []; String(best2.innerText || "").split(/\n+/).forEach(function (ln) { var mm = ln.match(/(?<![A-Za-z0-9._-])ev\.[a-z0-9._-]+/ig); if (mm) mm.forEach(function (x) { x = x.replace(/[._-]+$/, ""); if (evs.indexOf(x) < 0) evs.push(x); }); });
    progs.push({ id: idText, events: evs, rect: rect(best2), want: !!want[idText.toLowerCase()] });
  }
  return JSON.stringify({ flag: under("Flag"), tag: under("Tag"), progs: progs, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 });
}

// Scroll the ticket's program rows to the middle of the screen (page or inner scroller).
export function inj_calScroll(names) {
  var want = {}; (names || []).forEach(function (n) { want[String(n).toLowerCase()] = 1; });
  var ids = document.querySelectorAll("span.cursor-pointer.underline"), hits = [];
  for (var i = 0; i < ids.length; i++) if (want[(ids[i].textContent || "").replace(/\s+/g, " ").trim().toLowerCase()]) hits.push(ids[i]);
  if (!hits.length) return "0";
  hits[Math.floor(hits.length / 2)].scrollIntoView({ block: "center" });
  return "1";
}

export const TITLE_SET = "(function(){if(document.title.indexOf('CalCheck running')<0)window.__ccTitle=document.title;document.title='\u23F3 CalCheck running \u2014 do not use';})()";

export const TITLE_RESTORE = "(function(){if(window.__ccTitle)document.title=window.__ccTitle;})()";
