// Run state shared by the background modules (single owner; others use the setters).

// state of the current / last run (single or batch); the popup polls it to resume
export let RUN = { active: false, mode: "", saveMode: "", progress: null, result: null, at: 0 };

// capture diagnostics of the last screenshot (for the log / badges) + current case
export let CAP = null, CUR = { i: 1, n: 1, progId: "" };

export function capReset() { CAP = { method: "", tries: 0, reason: "", img: "", viewport: "", tile: "", notes: [] }; }

export function progressNote(note) {
  try { if (RUN && RUN.progress) RUN.progress.note = note; } catch (e) {}
  try { chrome.runtime.sendMessage({ type: "batchProgress", i: CUR.i, n: CUR.n, progId: CUR.progId, phase: "running", note }); } catch (e) {}
}

// ---- setters: an imported binding is read-only, so other modules assign through these ----
export function setRUN(v) { RUN = v; }
export function setCUR(v) { CUR = v; }
