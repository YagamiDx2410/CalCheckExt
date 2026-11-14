// Popup DOM basics and field lists.

export const DEFAULT_URL = "https://design.km.globalworldwide.com/design/calendars";

export const $ = (id) => document.getElementById(id);

export const FIELDS = ["url", "jiraLink", "calId", "progId", "flag", "event", "tags", "date", "time", "pre", "dur", "post"];

export function esc(s) { return (s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }

// clear all comparison/nav fields (keep URL; jiraLink optional)
export const CLEARABLE = ["calId", "progId", "flag", "event", "tags", "date", "time", "pre", "dur", "post"];
