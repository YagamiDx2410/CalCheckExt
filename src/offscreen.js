// CalCheck offscreen writer: writes evidence screenshots into the folder the user
// chose in the popup, so saving no longer depends on the popup staying open.
// The folder handle is shared through the extension's IndexedDB (calcheck/kv/saveDir).
function idbGet(key) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("calcheck", 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("kv")) open.result.createObjectStore("kv"); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction("kv", "readonly").objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
async function writeFile(baseName, dataUrl) {
  const handle = await idbGet("saveDir");
  if (!handle) return { ok: false, reason: "no folder chosen" };
  let perm = "";
  try { perm = await handle.queryPermission({ mode: "readwrite" }); } catch (e) { return { ok: false, reason: "permission check failed: " + ((e && e.message) || e) }; }
  if (perm !== "granted") return { ok: false, reason: "folder permission is " + perm };
  const blob = await (await fetch(dataUrl)).blob();
  const safe = String(baseName || "calcheck.png").replace(/[\/\\:*?"<>|]+/g, "_");
  const dot = safe.lastIndexOf("."), stem = dot >= 0 ? safe.slice(0, dot) : safe, ext = dot >= 0 ? safe.slice(dot) : "";
  let name = safe, i = 1;
  while (true) {                      // never overwrite: "name (1).png", "name (2).png", ...
    let exists = false;
    try { await handle.getFileHandle(name, { create: false }); exists = true; } catch (e) { exists = false; }
    if (!exists) break;
    name = stem + " (" + (i++) + ")" + ext;
  }
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return { ok: true, name, folder: handle.name };
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "writeFile") {
    writeFile(msg.name, msg.dataUrl).then(sendResponse).catch(e => sendResponse({ ok: false, reason: String((e && e.message) || e) }));
    return true;
  }
});
