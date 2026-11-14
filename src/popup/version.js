// Step 1 version gate: compare the installed version with manifest.json on GitHub (main).
import { cmpVersion, manifestVersion } from "../core/version.js";
import { $ } from "./dom.js";

function gitErr(msg) { const e = $("gitErr"); e.textContent = msg || ""; e.classList.toggle("hide", !msg); }

// empty GitHub URL -> red message + Next disabled
export function syncGitUrlUi() {
  const empty = !$("gitUrl").value.trim();
  gitErr(empty ? "GitHub manifest URL is required." : "");
  $("toForm").disabled = empty;
}

// true = versions match, go on; false = stay on step 1 (mismatch -> version popup, failure -> red message)
export async function versionGate() {
  const btn = $("toForm"), label = btn.textContent, local = chrome.runtime.getManifest().version;
  btn.disabled = true; btn.textContent = "Checking version…"; gitErr("");
  try {
    const res = await fetch($("gitUrl").value.trim(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const remote = manifestVersion(await res.text());
    if (!remote) throw new Error("no valid \"version\" in that file");
    const c = cmpVersion(local, remote);
    if (c === 0) return true;
    $("verLocal").textContent = local; $("verGit").textContent = remote;
    $("verMsg").textContent = c < 0 ? "A newer version is on GitHub. Pull main, then Reload the extension." : "The installed version is ahead of GitHub (main).";
    $("verModal").classList.remove("hide"); $("verClose").focus();
    return false;
  } catch (e) {
    gitErr("Could not check the version: " + ((e && e.message) || e));
    return false;
  } finally { btn.textContent = label; btn.disabled = !$("gitUrl").value.trim(); }
}

$("gitUrl").addEventListener("input", syncGitUrlUi);
$("verClose").onclick = () => $("verModal").classList.add("hide");
