// Save-folder picker (File System Access API + IndexedDB).
import { $ } from "./dom.js";

// ===== save-folder module (File System Access API + IndexedDB) =====
export let dirHandle = null; // in-memory handle for this popup session

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("calcheck", 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("kv")) open.result.createObjectStore("kv"); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const store = db.transaction("kv", mode).objectStore("kv");
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

const idbGet = (k) => idb("readonly", s => s.get(k));

const idbSet = (k, v) => idb("readwrite", s => s.put(v, k));

const idbDel = (k) => idb("readwrite", s => s.delete(k));

function updateLocUI() {
  const name = dirHandle ? dirHandle.name : "";
  $("locName").textContent = dirHandle ? name : "Downloads/CalCheck (default)";
  $("resetDir").classList.toggle("hide", !dirHandle);
}

export async function loadDir() {
  try { const h = await idbGet("saveDir"); if (h) { dirHandle = h; } } catch (e) {}
  updateLocUI();
}

export async function ensureDirPermission() {
  if (!dirHandle) return false;
  try {
    const q = await dirHandle.queryPermission({ mode: "readwrite" });
    if (q === "granted") return true;
    const r = await dirHandle.requestPermission({ mode: "readwrite" }); // needs user gesture
    return r === "granted";
  } catch (e) { return false; }
}

export async function writeToDir(handle, baseName, dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const safe = baseName.replace(/[\/\\:*?"<>|]+/g, "_");
  const dot = safe.lastIndexOf(".");
  const stem = dot >= 0 ? safe.slice(0, dot) : safe;
  const ext = dot >= 0 ? safe.slice(dot) : "";
  let name = safe, i = 1;
  while (true) {
    let exists = false;
    try { await handle.getFileHandle(name, { create: false }); exists = true; } catch (e) { exists = false; }
    if (!exists) break;
    name = stem + " (" + (i++) + ")" + ext;
  }
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return name;
}

$("pickDir").onclick = async () => {
  if (!window.showDirectoryPicker) { $("locHint").textContent = "This Chrome doesn't support folder picking. Screenshots will save to Downloads/CalCheck."; return; }
  try {
    const h = await window.showDirectoryPicker({ mode: "readwrite" });
    dirHandle = h;
    await idbSet("saveDir", h);
    updateLocUI();
    $("locHint").textContent = "\u2705 Screenshots will save to this folder. After a Chrome restart you may need to click Allow once.";
  } catch (e) { /* user cancelled */ }
};

$("resetDir").onclick = async () => {
  dirHandle = null;
  try { await idbDel("saveDir"); } catch (e) {}
  updateLocUI();
  $("locHint").textContent = "Reset to default: Downloads/CalCheck.";
};
