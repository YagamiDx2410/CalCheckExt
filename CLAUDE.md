# CalCheck — rules for any Claude session in this repo

Chrome extension (MV3), plain ES modules, no bundler, no build step.
Load unpacked from the **repo root** (`manifest.json` is at the root and points into `src/`).

## 1. Save tokens: do not rewrite what you do not need to
- **Never rewrite a whole file** to change part of it. Use targeted edits (Edit tool) on the exact lines.
- **Never re-create, re-split or re-format** existing modules. The split is done; do not "tidy" it again.
- **Read only what you need**: find the function with grep, then read that range. Do not read whole
  files "to get context" — the module map below is the context.
- Do not re-read a file you just edited, and do not echo full files back in chat.
- **No drive-by changes**: no renames, reordering, reformatting or comment clean-up outside the task.
- One task = the smallest diff that does it. If a change needs more than ~3 files, say why first.
- Do not create planning / analysis documents unless asked.

## 2. Module map — where code lives
`src/core/` — PURE: data in, data out. No `chrome.*`, no `document`, no `window`. Testable in Node.
| File | Holds |
|---|---|
| `core/text.js` | `norm`, `lc`, `splitCsv`, `safeName`, `errText` |
| `core/ids.js` | id / tag tokens: `hasId`, `idMatch`, `idWhy`, `evLev`, `splitTagTokens`, `gluedParts` |
| `core/duration.js` | `durSeconds`, `durVal`, `isBlankKM` |
| `core/dates.js` | `slashDate`, `normDate`, `parseDateParts`, `parseTimeToken`, `whenEntries` |
| `core/compare.js` | every `cmp*`, `flagRuleChecks`, `eventProgramCheck`, `calendarChecks`, `failLabels` |
| `core/layout.js` | screenshot / report geometry: `planListClip`, `topStackLayout`, `planCalendarParts` |
| `core/version.js` | `parseVersion`, `cmpVersion`, `manifestVersion` |
| `core/ai.js` | AI assist: `AI_FIELDS` (the one list of form / AI target fields), `buildAiPrompt`, `parseAiReply`, `aiCompare`, `aiMerge` |
| `core/adf.js` | Jira ADF readers: `adfCellLines`, `allTableRows`, `adfPlainText` |
| `core/parser/index.js` | `parseTicketV2` (picks the reader) + re-exports every parser |
| `core/parser/{table,offer,boss,shard,extras,legacy}.js` | one ticket layout / concern each |

`src/bg/` — service worker shell (calls `chrome.*`).
| File | Holds |
|---|---|
| `bg/run.js` | ENTRY: `runCheck`, `runBatch`, message router |
| `bg/check.js` | one case end to end: `checkOneCase`, `checkBossCase`, `checkCalendarCase` |
| `bg/capture.js` | screenshots via `chrome.debugger` (`dbg*`, `debuggerShot*`, `captureShot`) |
| `bg/report.js` | image composition (`composeReport`, `stackShots`, `stackWithTop`) |
| `bg/save.js` | save image / log, offscreen writer, notification |
| `bg/navigate.js` | work tab, `exec`, `openCalendar`, `openProgram`, `sleep` |
| `bg/state.js` | shared run state `RUN`, `CUR`, `CAP` + setters |
| `bg/injected.js` | every `inj_*` and injected string snippet |

`src/popup/` — popup shell (calls `document`, `chrome.*`).
| File | Holds |
|---|---|
| `popup/ui.js` | ENTRY: button handlers, run, render results, resume |
| `popup/jira.js` | `readJira`: fetch ticket, call parsers, fill the form |
| `popup/session.js` | popup state + setters, `saveState` / `loadState`, single / batch mode |
| `popup/version.js` | step 1 version gate: GitHub URL field, `versionGate`, version popup |
| `popup/ai.js` | AI assist toggle, review line, Detail popup, `askAi` (send / receive: still empty) |
| `popup/folder.js` | save-folder picker (File System Access + IndexedDB) |
| `popup/dom.js` | `$`, `FIELDS`, `CLEARABLE`, `esc` |

Dependencies go one way only: `bg -> core`, `popup -> core`. `core` never imports a shell.
`bg` and `popup` never import each other (they talk through `chrome.runtime` messages). No import cycles.

## 3. Adding a function or a feature
1. Decide: does it touch `chrome.*` / `document`? **No -> `core/`. Yes -> shell.** If a feature has both,
   split it: logic in `core/`, a thin caller in the shell.
2. Put it in the existing file whose row above matches. Create a new file only for a genuinely new
   concern (e.g. a new ticket layout -> `core/parser/<name>.js`, then wire it in `parser/index.js`).
3. Add `export` on the declaration and one `import { ... }` line in the caller. Keep import lists alphabetical.
4. New `core/` function -> add a case in `tests/core.test.js`.
5. New comparison -> `core/compare.js`, returning the usual row `{ label, pass, line }`; call it from `bg/check.js`.
6. New form field that AI assist should also read -> one line in `AI_FIELDS` (`core/ai.js`) plus its input in `popup.html`.
7. New field read from KM -> inside the relevant `inj_*` in `bg/injected.js`.

## 4. Hard rules (break these and the extension breaks)
- **`inj_*` must stay self-contained.** They are shipped to the KM page as text (`executeScript` /
  `.toString()`): no `import`, no call to anything declared outside the function body.
- **Shared state is assigned through its setter** (`setRUN`, `setCUR`, `setBatchSel`, ...). An imported
  binding is read-only; `RUN = ...` outside `bg/state.js` throws. Mutating a property (`CAP.method = ...`) is fine.
- **Extension paths start at the repo root** (`src/...`). `executeScript` `files` take them as is
  (`"src/lib/html2canvas.min.js"`); everywhere else wrap them in `chrome.runtime.getURL("src/...")` — a bare
  relative URL is resolved against the calling script (`src/bg/`), not the root (notification icon, offscreen page). Import paths are relative to the importing file and need the `.js` extension.
- Modules are always strict mode: declare every variable.
- Do not edit `src/lib/html2canvas.min.js`.

## 5. Before you say "done"
- `npm test` (Node 18+) when `core/` changed.
- Shell changes cannot be tested from the terminal: say plainly that it needs a Reload in
  `chrome://extensions` and a manual run, and what to click.
- Version: see section 7.
- Append a short entry to `improvement.txt` describing what changed (used as the push comment).

## 6. `improvement.txt` — one push = one milestone
- It holds ONLY what changed since the last `git push`. The user pastes it as the push comment.
- At the start of a task run `git status -sb`: if the branch is level with its remote and `improvement.txt`
  is unchanged, its content was already pushed — **replace it** with a fresh file for the new work.
  If there are unpushed commits or uncommitted changes to it, **append** instead.
- Keep it short: title line, `Làm gì`, `Kiểm tra`, `Chưa kiểm / lưu ý`. Written in Vietnamese.

## 7. Branches and version
- `main` = the released extension. Every other branch = a prototype / feature still in development.
- **Never change `version` in `manifest.json` on a branch.** The version changes only with a commit on `main`.
- **Auto-bump on `main`:** when a task on `main` changes the extension (anything under `src/` or `manifest.json`),
  compare the local `version` with the pushed one (`git show origin/main:manifest.json`). Equal = the last
  version is already on GitHub -> raise the middle number by one and reset the last (`2.33.0` -> `2.34.0`),
  once, without asking. Local already higher = this milestone is bumped; leave it. Docs-only changes: no bump.
  Say in the reply and in `improvement.txt` that the version changed (until it is pushed, the step-1 version
  check reports a mismatch on that copy).
- So `version` on `main` is the single source of truth for "latest version".
- Check `git status -sb` before editing so you know which branch you are on; do not switch branches yourself.
