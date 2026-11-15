// Popup DOM basics and field lists.
import { AI_FIELDS } from "../core/ai.js";

export const DEFAULT_URL = "https://design.km.globalworldwide.com/design/calendars";

export const $ = (id) => document.getElementById(id);

export const DEFAULT_GIT_URL = "https://raw.githubusercontent.com/YagamiDx2410/CalCheckExt/main/manifest.json";

export const FIELDS = ["url", "gitUrl", "jiraLink", "calId", "progId", "flag", "event", "tags", "date", "time", "pre", "dur", "post"];

export function esc(s) { return (s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }

// clear all comparison/nav fields (keep URL; jiraLink optional)
// (one list: core/ai.js AI_FIELDS, so the AI targets always follow the form fields)
export const CLEARABLE = AI_FIELDS.map(f => f.key);
