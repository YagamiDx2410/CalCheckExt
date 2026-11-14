// Image composition: stack shots, draw the report picture.
import { reportOutSize, reportScale, topStackBoxes, topStackLayout } from "../core/layout.js";

export async function stackWithTop(listShot, modalUrl, modalHl, tagFail) {
  const bmA = await createImageBitmap(await (await fetch(listShot.url)).blob());
  const bmB = await createImageBitmap(await (await fetch(modalUrl)).blob());
  const lay = topStackLayout(bmA.width, bmA.height, listShot.clip.width, bmB.width, bmB.height);
  const cv = new OffscreenCanvas(lay.W, lay.H), cx = cv.getContext("2d");
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, lay.W, lay.H);
  cx.drawImage(bmA, 0, 0);
  cx.fillStyle = "#c9ced8"; cx.fillRect(0, bmA.height + Math.floor(lay.sepPx / 2) - 1, lay.W, 2);
  cx.drawImage(bmB, 0, lay.yB);
  const url = abToDataUrl(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { url, hl: { rects: topStackBoxes(lay, listShot, modalHl, tagFail), clipW: lay.clipW } };
}

export async function stackShots(urlA, urlB, sepCss, clipW) {
  const bmA = await createImageBitmap(await (await fetch(urlA)).blob());
  const bmB = urlB ? await createImageBitmap(await (await fetch(urlB)).blob()) : null;
  const k = bmA.width / clipW, sepPx = Math.round(sepCss * k);
  const W = Math.max(bmA.width, bmB ? bmB.width : 0), H = bmA.height + (bmB ? sepPx + bmB.height : 0);
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext("2d");
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, W, H);
  cx.drawImage(bmA, 0, 0);
  if (bmB) { cx.fillStyle = "#c9ced8"; cx.fillRect(0, bmA.height + Math.floor(sepPx / 2) - 1, W, 2); cx.drawImage(bmB, 0, bmA.height + sepPx); }
  return abToDataUrl(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
}

function abToDataUrl(buf) { const bytes = new Uint8Array(buf); let bin = ""; const ch = 0x8000; for (let i = 0; i < bytes.length; i += ch) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + ch)); return "data:image/png;base64," + btoa(bin); }

export async function composeReport(modalDataUrl, payload, hl) {
  let bmp = null, mw = 0, mh = 0;
  try { const blob = await (await fetch(modalDataUrl)).blob(); bmp = await createImageBitmap(blob); mw = bmp.width; mh = bmp.height; } catch (e) {}
  const S = reportScale(mw), pad = 22 * S;
  const vc = payload.overall === "PASS" ? "#0a7d28" : payload.overall === "FAIL" ? "#c0392b" : "#555";
  const head = [{ t: "CalCheck \u2014 RESULT: " + payload.overall, b: true, s: 19, c: vc }, { t: "Program: " + (payload.progId || "") + "  (" + (payload.ts || "") + ")", s: 12, c: "#555" }, { t: "", s: 6 }];
  (payload.resultLines || []).forEach(l => head.push({ t: l.line, s: 13, b: !!l.bold, c: l.pass === false ? "#c0392b" : l.pass === true ? "#0a7d28" : (l.bold ? "#222" : "#555") }));
  head.push({ t: "", s: 6 });
  (payload.actualLines || []).forEach(l => head.push({ t: l, s: 12, c: "#555" }));
  const lh = o => (o.s || 14) * S * 1.5;
  const headerH = Math.round(pad * 2 + head.reduce((a, o) => a + lh(o), 0));
  const W = Math.max(mw, 1000 * S);
  const canvas = new OffscreenCanvas(W, headerH + mh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textBaseline = "top";
  let y = pad;
  for (const o of head) { const sz = (o.s || 14) * S; ctx.fillStyle = o.c || "#333"; ctx.font = (o.b ? "700 " : "") + sz + "px -apple-system, system-ui, Arial, sans-serif"; if (o.t) ctx.fillText(o.t, pad, y); y += lh(o); }
  if (bmp) { ctx.strokeStyle = "#e0e0e0"; ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(canvas.width, headerH); ctx.stroke(); ctx.drawImage(bmp, 0, headerH); }
  // red boxes around the failed fields of the KM popup
  if (bmp && hl && hl.rects && hl.rects.length) {
    const k = bmp.width / (hl.clipW || bmp.width);
    ctx.strokeStyle = "#e01e1e"; ctx.lineWidth = Math.max(3, Math.round(2.5 * k));
    hl.rects.forEach(r => ctx.strokeRect(r.x * k + 2, headerH + r.y * k + 2, Math.max(4, r.w * k - 4), Math.max(4, r.h * k - 4)));
  }
  const osz = reportOutSize(canvas.width, canvas.height);
  let outCanvas = canvas;
  if (osz.f < 1) { outCanvas = new OffscreenCanvas(osz.w, osz.h); const c2 = outCanvas.getContext("2d"); c2.imageSmoothingQuality = "high"; c2.drawImage(canvas, 0, 0, osz.w, osz.h); }
  const outBlob = await outCanvas.convertToBlob({ type: "image/png" });
  return abToDataUrl(await outBlob.arrayBuffer());
}
