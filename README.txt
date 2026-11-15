CALCHECK v2 — Chrome Extension for Calendar/Program verification
================================================================

A Chrome extension (NOT a macOS app -> no Gatekeeper, no OS permissions,
no cost). It runs inside your own signed-in Chrome session. Your data
NEVER leaves your machine: it only talks to Jira and KM Design directly,
using host_permissions limited to those two domains.
The only other request is a read-only download of manifest.json from
GitHub (step 1 version check); nothing is sent to it.

WHAT IT DOES
------------
1. You paste a Jira ticket link. The tool reads the ticket via the Jira
   REST API (fields.description ADF) and AUTO-FILLS the values to check:
   Calendar ID, Program ID, Flag, Event IDs, Package Tags, Date, Time,
   Pre/Duration/Post.
2. It opens a hidden KM Design tab, navigates Calendar ID -> Program ID,
   reads the program detail popup, and compares every filled field with
   EXACT match (no tolerance).
3. It saves a PNG screenshot as evidence (Downloads/CalCheck by default,
   or a folder you pick).
   - 1 program  -> single mode.
   - >1 program -> batch mode (checks every program, one summary).

SUPPORTED TICKET LAYOUTS
------------------------
- Fund/Event standard (single program; ID + Program Name in one table).
- Position-changed / stacked (programs stacked in single cells; read by
  column label, not position).
- KvK (program-per-row; Content column split into ev.*/tag.*; combined
  Start Date; Calendar ID taken by cal.* pattern when there is no ID col).
- Offer / Store Window / Shop (label|value; scheduling embedded as text;
  DD-Mon-YYYY dates). Auto-checks Flag / Date / Duration only. store.*
  items, Store Window (sw.*), prices and brackets are OUT OF SCOPE.
- Boss-spawn v3/v4 (a "County Config (if Applicable)" table). Adds v3/v4
  programs, located on KM by their coc id, checked for config-id
  placement, Shard Tag, Flag, Date, Time, Duration.
- Onboarding-calendar tickets (Calendar ID | Shard Tags | Program ID |
  Content | Start Time). Content is classified by prefix and each token is
  checked in the right KM field: ev.* -> Event IDs, tag.* -> Package Tags,
  coc.* -> County Config IDs, cal.*/mission(s).* -> Calendar IDs.

INSTALL / UPDATE
----------------
Only Chrome is needed. No Node, no Homebrew, no git, no build step.

0. Get the folder: on GitHub click Code -> Download ZIP and unzip it
   (the folder is then named CalCheckExt-main), or clone the repo.
1. Chrome -> chrome://extensions
2. Enable "Developer mode" (top-right).
3. First install: "Load unpacked" -> select the folder that contains
   manifest.json (CalCheckExt / CalCheckExt-main), NOT the src folder.
   Update: replace the folder with the new download (or git pull), then
   click the Reload icon on the CalCheck card.
4. The version on the card must equal the version on GitHub (main);
   step 1 of the popup checks this when you click Next.

Node is only for developers who run the tests (npm test). Do not leave a
node_modules folder, or any file/folder whose name starts with "_", inside
the extension folder: Chrome refuses to load it.

NOTES
-----
- You must already be signed in to BOTH Jira and KM Design in Chrome.
- Empty fields are skipped (not counted as Pass/Fail).
- Date is normalized to KM Design's M/D order (e.g. "21 Sept 2026" ->
  "9/21/2026"; "25 Sep" with no year -> "9/25"), so it matches the
  popup's "When" value via a contains check.

CHANGELOG
---------
v2.33.0
- KM-63623 (Titan Elf Bounty Board + Shop): a ticket with ONE event, event programs and store programs, a Store Windows
  row and a schedule table that has fewer rows than programs and no program column.
  * Event: when the ticket lists exactly one event, programs whose name contains "event" get it; programs whose name
    contains "store" / "shop" have no event (they carry package tags). Several events -> the old "Could not map Event"
    warning (ambiguous).
  * Package Tags of store programs: from the ticket's "Store Windows" row, sw.X -> tag.X (sw.titanshop.elf.v2 ->
    tag.titanshop.elf.v2). The report has a Note saying so. A store program that lists its own tags keeps them.
  * Shard Tag: a "Shard Tag | value" label row (one value cell) is now checked on every program (whole-id match in the
    Shard Tag field). A row with several value cells (the v3 | v4 County Config table) is not read this way.
  * Schedule: when the schedule table has fewer rows than programs and no program column, the rows are mapped by the
    week token in the program names (wk1, wk3 ...): the smallest week uses the first row, the next week the second row,
    event and store of the same week share a row. A Note names the row used. If the number of week tokens differs from
    the number of rows (or a name has none), nothing is guessed: a warning is shown instead.
  * Flag stays record-only for this ticket type (not compared).
v2.32.1
- Fix (KM-62877): "could not find calendar: cal.bp42.championxp.missions" although the calendar exists. The tool opened
  the PLAIN calendars list and looked for the calendar id in it, but that list has hundreds of rows (474), is sorted by
  "Updated At" and shows 25 per page - a calendar not updated recently (this one: 10/6) is not on page 1. Every calendar
  lookup (program rows, CAL rows, boss rows) now opens the list filtered by the id (?term=<calendar id>), as the
  calendar-tag layout already did. The not-found message says the list was searched by id.
v2.32.0
- Several calendars listed in a small table of their own (cal-id + its Tag per row, no ID column in the program
  table - KM-63509: cal.kvk.nov26.e004.d012 / kvk-e004-d012 and cal.kvk.nov26.d013.d014 / kvk-d013-d014):
  every program is now checked in EACH listed calendar (before, only the first calendar was read - the second
  was silently skipped). Order: CAL row of calendar 1, its programs, CAL row of calendar 2, its programs
  (2 calendars x 38 programs = 78 rows). The CAL row checks that calendar's Tag on the calendar page (exact match;
  a calendar without a Tag in the ticket is not compared; the flag is only recorded). Program rows are headed
  "<program> @ <calendar> . shard <E004/D012>". A ticket that lists a single calendar behaves as before.
- A CAL row that lists no programs takes a header-only calendar picture.
v2.31.1
- Fix (KM-63509): ids that contain "ev." / "tag." inside, e.g. ev.ftev.kvk.v2 and tag.kvk.ftev.shop.v2, were
  split in two by the "glued ids" rule, giving false FAILs (ev.ft, ev.kvk.v2, ev.shop.v2, tag.kvk.ft). Now KM
  decides: when the glued form exists on KM as ONE id in its own field it is kept as one id and the split parts are
  not checked (a Note says so). When KM holds two separate ids (the Fund case the rule was made for) nothing changes.
  Single mode gets the same treatment.
- Content cell note "(required shard tag: kvk-winner)" is now read as a Shard Tag the program must have (whole-id
  match in the Shard Tag field); the note text is no longer ignored.
- The log now lists the checks that PASSED for every row ("ok: Flag, Package Tag x2, Date, Duration"), not only the
  failures, so it is visible that a tag / event was compared.
v2.31.0
- Program picture = the whole visible page, like a manual screenshot: the breadcrumb "Design /
  Calendars / <calendar> / <flag>", the dimmed page and the popup, so the picture itself shows which
  calendar is being checked. Red boxes on failed fields are shifted to their place in the page.
  The picture is checked with the strict 2x2 tile test; rejected twice -> the 3rd try falls back to
  the popup only (noted in the log). A very wide report is scaled down to 2400 px, and the report
  text grows with the picture so it stays readable.
- Report header names the calendar and the shard for KvK rows:
  "Program: 1.prep.4.day4  @  cal.kvk.nov26.f001.e003  .  shard F001/E003" (CAL rows too).
  Other ticket types keep "Program: <name>".
v2.30.0
- KvK tickets now COMPARE the flag with the ticket's Flag row (other ticket types still only record
  it): the CAL row ("Calendar Flag") and every program row of a calendar-grouped ticket (KM-62668,
  KM-63219), and the program rows of the calendar-tag layout (KM-63232; its calendar flag is not in
  the ticket, so it stays record-only). Same flag -> one line: Flag: expected "kvk015-evts" | actual
  "kvk015-evts" (not tbd / ignore); a different flag fails with both values shown (the flag cell is
  boxed); an empty / tbd / ignore flag on KM still fails by the rule. The ticket has no Flag row ->
  nothing to compare, the flag is only recorded.
v2.29.1
- Fix (KM-63219): the CAL rows of calendar-grouped tickets could never take their calendar-page
  picture: Page.captureScreenshot rejects a clip without "scale" ("Failed to deserialize
  params.clip.scale"). The clips now carry scale 1, and the capture helper adds it whenever it is
  missing. (The test Chrome now rejects such a clip too, so this cannot slip through again.)
- Fix (KM-63219): "TICKET DATA ERROR - Event Prototype has no section labeled for F001/E003".
  A section heading such as "E004/D012, D013/D014" lists TWO calendars (groups separated by a
  comma), but it was read as one set of four brackets. Headings and schedule labels are now read
  as groups: a calendar matches when its brackets equal one group (order inside a group does not
  matter). A calendar that is in no listed group still gets the data error, naming the sections.
v2.29.0
- Package Tags typed by hand: the batch screen has a "Package Tags to check on every program"
  field (comma / semicolon / space separated). A note under it says whether the ticket lists
  Package Tags: none -> "type them here to add a check" (left empty, the report only shows the
  bold Note with the tags found on KM); listed -> typed tags are checked IN ADDITION.
  * Every ticked program row gets the typed tags as an extra Package Tag check (whole-id match,
    must sit in the Package Tags field); the report marks them "(added manually)".
  * The field is saved with the session (survives closing the popup), cleared when another ticket
    is read, by Clear and by Reset. CAL rows and boss rows are not affected.
v2.28.1
- Fix: the calendars-list picture failed on every row after the first (log: "capture strategy 2 ...
  Only screenshots from surface are allowed"). Two causes, both in the tool:
  * the 2nd retry used Page.captureScreenshot fromSurface:false, which this Chrome rejects, and
    the error stopped the whole retry chain. That strategy is gone; every try is now wrapped so
    an error only fails that try, and the chain continues (try 2 = re-warmed, try 3 = tab shown
    briefly).
  * only the first row of a run got a throw-away "warm-up" shot; a freshly opened list page can
    give a stale first frame. Each list / calendar picture now starts with a warm-up shot and
    waits until the table stops moving.
- The log now writes WHY a try was rejected ("list try 1 rejected: ...") for the list and
  calendar pictures, so a retry can be diagnosed from the log.
v2.28.0
- KM-63232 layout (one calendar per row, the Tags column = the calendar's Tag) now gives ONE
  row per calendar instead of two. The calendar Tag is checked inside the program's row:
  * the tool opens the calendars list filtered by the calendar id (calendars?term=<id>),
    reads that row's Flag and Tag, and takes picture 1 (table header + the matching row);
  * then it opens the calendar and the program popup (picture 2);
  * the report image is: report text, picture 1 (calendars list), picture 2 (program popup).
  * report: the "Calendar Tag" line is in bold (exact match; a wrong Tag fails the row, the
    Tag cell in picture 1 is boxed in red and the file name starts with "FAILED - ").
    "Calendar Flag on KM" is recorded (not compared). The header names the calendar:
    "Program: 3.fund.champion @ cal.kvk.nov26.f001.e003".
  * if picture 1 cannot be taken, the report keeps the popup picture and logs why.
- KvK calendar-grouped tickets (KM-62668) keep their separate CAL rows.
v2.27.0
- KM-63232 layout (the same program under several calendars, one calendar per row, the
  Tags column = each calendar's Tag): the batch has a CAL row per calendar (Calendar Tag
  checked on the calendar page, exact match) followed by its program row. The program's
  Shard Tag / Package Tags are NOT compared with that Tags column. One event listed in the
  ticket is applied to every row; Duration is shared.
- A schedule cell with blocks labelled by shard keyword ("(Fshards,Eshards,Dshards)",
  "(Cshards)") is resolved per calendar from the shard letters in its id
  (cal.kvk.nov26.f001.e003 -> F and E, c033 -> C). Any "<letter>shards" keyword works
  (Bshards, ...). A calendar whose letter is not labelled gets a TICKET DATA ERROR and the
  field is not compared; an unknown label is never read as a date.
- Dates written day/month: when the text has a weekday ("Tuesday, 03/11/2026"), the weekday
  decides - if it only fits day/month the date is read as 11/3/2026 (what KM shows).
  25/11/2026 is read as day/month; without a weekday and ambiguous, month/day as before.
- CAL rows no longer show the ticket flag (the calendar flag is only recorded).
v2.26.1
- Fix: tickets whose program table has a MERGED calendar-id cell (the id written once
  and spanning several rows, e.g. KM-63070) lost every program after the first. Merged
  (rowspan) cells are now carried into the rows below, so all programs are read.
- Fix: Event Prototype split into one column per version (v3 | v4 | v5) - every column
  is read, and a program whose name ends in .vN gets the event of column vN
  (fos26.koth.alb.v4 -> ev.fos26.koth.v4.alb). A single program of such a ticket gets
  only its own version's event.
- KM-63070 now gives 3 checks (v3, v4, v5): event per version, shard tag slb-mapvN,
  flag, 10/30/2026 02:00:00 UTC, Pre 1d / Duration 2d / Post 12h.
v2.26.0
- When with several entries: a KM program can list many When entries (one date + time
  each). The ticket's date/time now only has to be ONE of them; extra entries on KM
  are ignored (a Note says how many there are). Before, only the first entry was
  compared, so a ticket whose date was not the first one failed.
  * Date: PASS if any entry has the date (year compared only when the ticket has it);
    FAIL lists the entries KM has.
  * Time: checked inside the entry of the matching date - the date of one entry is
    never paired with the time of another. Ticket with only a time matches any entry.
  * Pre / Duration / Post stay single values.
v2.25.0
- Pick which programs to check: every row of the batch list has a tick box
  (all ticked by default), with "Select all", an "n of N selected" counter and a
  "CHECK SELECTED (n)" button. Only the ticked rows are sent to the run.
- Re-check only what failed: after a run the result screen shows "Re-check failed
  (n)" (programs that FAILED or errored). It runs just those and leaves your ticks
  as they were. The new results REPLACE only the re-checked rows, so the verdict
  covers the whole list ("4 PASS - 0 FAIL (total 7, 3 not checked)"); untouched
  rows are marked "earlier run".
- The list shows "last: PASS / FAIL" next to each checked program, and a "Select
  failed (n)" button ticks exactly the failed ones. Ticks and the last results are
  part of the saved session, so they survive closing the popup. Reading a new ticket
  starts clean.
v2.24.0
- Session memory: closing the popup (click outside, switch window, close Chrome) no
  longer loses your work. Everything is saved as you go - every keystroke in a
  field, the step you are on, the link, the ticket list read from Jira and its
  messages/warnings - and restored when you reopen (a short "Restored your last
  session" note shows the ticket and time). Typing is saved immediately, so no
  Next / Check is needed first.
- A saved session expires after 12 hours (the old values and list are dropped; the
  link and calendars URL are kept).
- Reading a DIFFERENT ticket while a session is saved asks "Start a new session
  for KM-xxxxx?" (OK clears the old list and values, Cancel keeps them).
- New "Reset" button in the header clears the saved session (asks first).
- Works together with background runs: reopening shows live progress / the finished
  result, and "Back to list" still has the full list.
v2.23.1
- Flag is no longer compared with the ticket (programs of one ticket can carry
  different flags). The flag found on KM is only RECORDED in the report ("Flag on
  KM: '<value>' - recorded"), and checked against the rule: it must not be empty
  and must not contain "tbd" or "ignore" (otherwise FAIL, red box, and the file
  name starts with "FAILED - flag-<value> - "). Applies to program rows, boss
  rows and the calendar row of KvK tickets ("Calendar Flag").
v2.23.0
- Calendar fan-out (KM-62686): when a program's ID cell lists several cal-ids, the
  program is checked once per calendar (calendar x program), all sharing the
  ticket's event / tag / flag / schedule. Previously only the first calendar was
  read and the others were silently dropped. Checks are ordered by calendar.
- Ids are now compared as WHOLE ids in every ticket type (Event ID, Package Tag,
  County Config ID, Calendar ID, Shard Tag). Before, an id only had to be
  *contained* in the KM field, so an extra character or a suffix (e.g.
  "...zulrashards", "...zulrashard.old", "kvk-c033" vs "kvk-c033-b072") still
  passed. Near misses are explained ("1 extra character", "4 extra characters",
  "1 missing character"); an id that sits in another field still says WRONG field.
- The popup's Shard Tag is read as a clear list of ids (chips / one per line).
v2.22.2
- Pre / Duration / Post are now compared by VALUE, not by characters: spaces, case
  and unit layout no longer matter ("23h50m" = "23h 50m" = "23 h 50 m",
  "1d23h45m" = "1d 23h 45m", "24h" = "1d", a unit-less number after "h" is minutes).
  Different durations still fail. Ids, flags and tags stay character-exact.
v2.22.1
- Fix the calendar-row screenshot coming out as 4 tiled copies (Chrome returned a
  wrongly sized frame). The evidence is now two plain viewport captures stacked:
  the calendar header (Flag / Tag) and the ticket's program rows (scrolled into
  view). Each part is size-checked and rejected when tiled (strict 2x2 check);
  retries escalate: normal -> fromSurface:false -> tab shown briefly. No more
  viewport resizing on the hidden tab. Failed areas are still boxed in red.
- Report wording: the calendar row says which field events sit in is checked on
  each program row; a program's PASS line says its events are in the Event IDs
  field, match exactly and none sit in another field. An event in Package Tags /
  Calendar IDs / County Config IDs / Shard Tag still fails (missing from Event IDs
  + the wrong field is named).
v2.22.0
- KvK calendar-grouped tickets: each program's Event IDs on KM must equal, character
  by character, the events the ticket lists for it. The ticket's section for the
  calendar (B072/B073, C033, ...) is the list - for EVERY bracket, whatever the
  scope word in the id is (bcshards / cshard / acshard / c033 ...).
  Which program holds which event: the dayN in the event must equal the dayN in
  the program name; the event type (last segment) picks the program: sms/ams/alb
  -> *.0.events, slb -> *.1.slbs, rlb -> the parent program (...dayN).
  Extra / missing events are FAIL; a near-miss is explained ("1 extra
  character", "different day"); an event of another bracket is reported with the
  list it belongs to. Programs/events the rule cannot map get a Note only.
- The calendar row now checks events strictly for B072/B073 too (all ticket
  events present, no other events).
v2.21.0
- KvK "calendar-grouped" tickets (KM-62668): a calendar row that lists several
  programs, with the schedule in a second table keyed by program name. The batch
  gets one row per calendar (CAL) plus one row per (calendar, program).
  * CAL row: opens the calendar page and checks its Flag and Tag (exact tokens)
    and, for brackets whose event ids carry the bracket label (e.g. C033), that
    all of the ticket's events are in the calendar's programs and no other event
    is; for B072/B073 (ids carry no label) events are only noted. The screenshot
    shows the calendar header and the ticket's program rows, failed areas boxed.
  * Program rows: Date, Time, Pre/Dur/Post (values picked by the calendar id's
    bracket labels, e.g. "(B072/B073)" vs "(C033)"), flag rule, Global must be
    Yes when the program has events (ticket "Global Event: YES"), ticket events
    must not sit in the wrong field, plus a Note listing the program's events.
  * If the calendar id has bracket labels that the ticket does not label (e.g.
    c033.b072), the field is reported as TICKET DATA ERROR (FAIL) naming the
    calendar/program/field, so the ticket can be fixed.
- Event Prototype: an id is an event only when "ev." has NO prefix ("lb.ev.",
  "q.ev.", "list.ev." are other ids); sections headed "B072/B073", "C033 (SOLO)"
  are kept per bracket.
- Schedule tables headed just "Program" are recognised.
v2.20.0
- Flag rule (always on): every program must have a flag on KM, and the flag must
  not contain "tbd" or "ignore" (case-insensitive). Empty or tbd/ignore = FAIL
  with the reason in the report.
- The batch result list now shows WHY a program failed (its failed check lines)
  right under the program name. The log is also saved when any program fails,
  with a "fail:" line per failed check.
- Failed screenshots: the failed fields of the KM popup are boxed in red, and the
  file name starts with "FAILED - " ("FAILED - flag-<value> - " when the flag
  rule failed), e.g. "FAILED - flag-tbd - cal.kvk.valorshop - 4.winner.png".
- Calendar / program not found (also boss programs by config id) is now a FAIL
  shown as "FAILED - could not find ...", with a screenshot of the page saved as
  "FAILED - could not find - <calendar> - <program>.png".
v2.19.0
- Ticket type is chosen by scanning the whole ticket: schedule sentences with
  "program id:" (or an offer/LTO title, or a Store Window row) use the sentence
  reader; program tables use the table reader; when both exist they are merged.
  Fixes shop tickets like KM-62694 that have a Store Window row AND program
  tables (previously 0 programs).
- Calendar ID per program row; a second table that also lists programs (e.g.
  Tags in one table, Start Date/Duration in another) is joined by (calendar,
  program name), so same-named programs in different calendars stay separate.
- Tags column values are classified by format: tag.* -> Package Tags,
  hyphenated ids without a dot (valor-shop, kvk-winner) -> Shard Tag; each must
  be present in the right KM field.
- Package Tags are only checked when the ticket lists them on the program's own
  row; otherwise the report shows a bold Note with KM's value (not scored).
v2.18.1
- Offer / Store Window tickets now also check Time and, per program line,
  Repeats + Ends after ("repeat every 1 day, 4 occurrences" on that line only;
  other lines are not repeat-checked). The common typo "occurences" is accepted.
  Package Tags: checked when the ticket lists them (on the program's line or in
  a "Package Tags" row); otherwise the report shows a Note with KM's value.
- Screenshot no longer cut at the bottom when the popup body scrolls inside the
  popup: the hidden rows are measured and the viewport is made taller so the
  popup shows everything; if rows are still hidden, the scroll areas are
  unclipped for the capture and restored right after (noted in the log).
- Report shows a multi-line Repeats value as "Every 1 day / Ends after N
  occurrences" instead of run-together text.
v2.18.0
- Saving no longer depends on the popup: screenshots for a chosen folder are
  written by a hidden extension page (offscreen document) as soon as each one is
  captured, so you can close the popup or switch tabs and every image is still
  saved. If the folder cannot be written (e.g. permission revoked after a Chrome
  restart) that image is saved to Downloads/CalCheck instead, tagged
  "Downloads" in the results, and noted in the log. Requires the new
  "offscreen" permission.
- New file names (avoid collisions between tickets):
  * normal programs: "<calendar id> - <program>.png"
    e.g. "cal.bp41.powerrunes4.missions.wk4 - 0.meta.png"
  * boss v3/v4:      "<event id of the main program> - <v3/v4 program>.png"
    (falls back to the calendar id when the main program has no event)
  Existing files are never overwritten ("name (1).png").
v2.17.4
- Screenshot fix: the work tab's viewport size AND device-pixel-ratio are locked
  (debugger device-metrics override) for the whole run, so layout and capture
  always use the same scale. This targets the tiled/shifted first screenshot
  (0.meta) and captures made while you look at the running tab.
- Tiled-image guard: a capture whose left/right or top/bottom halves are
  identical is rejected and retried.
- While a run is in progress the running tab ignores mouse/keyboard input and
  its title shows "CalCheck running - do not use"; both are restored at the end.
  (Closing the tab or typing a new URL cannot be blocked.)
- Capture retries show in the progress line ("capture retry 2/3"); result rows
  get a "retried" / "fallback" / "no image" tag; a Chrome notification appears
  only when no screenshot could be saved.
- Diagnostic log: a text file CalCheck_log_<ticket>_<date>.txt is saved to
  Downloads/CalCheck ONLY when a run had a capture issue (retry, fallback, no
  image, or error). The result screen has a "Copy log" button for any run.
v2.17.3
- Real fix for the first screenshot of a run (0.meta) being broken: the yellow
  "started debugging" banner appears asynchronously after the debugger attaches
  and shrinks the viewport, moving the popup after it was measured. The
  debugger is now attached at the START of each run (before the first popup)
  and the tool waits for the viewport to stop changing. Each capture waits for a
  stable viewport, measures the popup, captures, re-measures, and retries (up
  to 3 times) if the popup moved during the capture.
v2.17.2
- Fix the first screenshot of a run (e.g. 0.meta) coming out tiled 2x2 and
  shifted. The debugger capture now uses scale 1 (Retina already renders x2),
  no longer uses capture-beyond-viewport or changes the popup layout, takes a
  throw-away warm-up frame right after attaching, and clips in document
  coordinates. If the popup is taller than the window the viewport is enlarged
  temporarily (restored after). A capture with the wrong size is rejected and
  the tool falls back to html2canvas, so a broken image is never saved.
v2.17.1
- Mission rules now apply only when the Jira ticket TITLE contains "mission"
  (other tickets are checked normally).
- Mission event ids: if the ticket lists an event for a program, that value is
  used; otherwise it is derived from the ".meta" prototype: 0.meta -> ...meta,
  day1 -> ...d1, day2 -> ...d2 (matches KM). Derived ids are marked with a Note
  in the report. No ".meta" prototype -> Note, event not checked.
- Pre/Dur/Post: only a real duration (digits + d/h/m, e.g. "4d", "23h 59m")
  counts as a value; blank, "-", "N/A", "TBD" etc. mean "no value" on both the
  ticket and KM side (all ticket types). The "blank = KM must be blank" rule
  stays mission-only.
v2.17.0
- Mission tickets (program list in the ID table, e.g. "0.meta, day1, day2,
  day3", plus a separate schedule table with its own Program Name column):
  * each program's schedule is taken from its OWN row, joined by program name
    (row order no longer matters);
  * event ids are shared by all programs of the mission;
  * a blank Pre-Duration / Duration / Post-Duration cell means KM must be blank
    too ("", "N/A" or "-"); a value there on KM is a FAIL. Applies to mission
    tickets only; other ticket types still skip blank fields;
  * a listed program with no schedule row is not schedule-checked (Note, KM
    values recorded); a schedule row not in the list is warned and skipped.
- Fixes v2.16.2, which copied the first program's schedule to all programs.
v2.16.2
- Program Name cells that list several programs comma-separated in one line
  ("0.meta, day1, day2, day3") are now split into separate programs (previously
  read as a single unmatchable program). The shared Calendar ID / schedule /
  flag apply to all of them; events map by suffix where a prototype exists.
v2.16.1
- Fix mis-classification of ids that contain ".ev."/".tag." inside them: a
  County Config id like "coc.v5.ev.kvk.armies" was being split at "ev." and the
  tail treated as an Event ID. Glued ids are now only split at ev./tag. when it
  is NOT preceded by a dot, so "coc.v5.ev.*" stays one County Config id while a
  genuinely glued "ev.Atag.B" still splits.
v2.16.0
- Screenshots now use chrome.debugger (CDP Page.captureScreenshot) instead of
  html2canvas. This captures the KM popup even when the work tab is hidden, so
  there is NO tab flicker and it works fully in the background. The report text
  (verdict + checks + actual data) is composited above the popup image in the
  service worker (OffscreenCanvas). Chrome shows a yellow "CalCheck started
  debugging this browser" banner while a run is in progress; it clears when the
  run finishes. Requires the new "debugger" permission. If the debugger capture
  ever fails it falls back to the old html2canvas method automatically.
v2.15.2
- AMS-style tickets (Program Name | Flag | Shard Tag | Date | Time | Content |
  Type | Pre/Duration/Post, with the calendar id in a separate ID table):
  fixed the run erroring on every row. The parser now (1) picks the program
  table that actually has program names instead of an empty header table,
  (2) reads Flag per row from a Flag column, and (3) reads separate "Date" and
  "Time" columns (and "Start Date/Time") for the schedule check.
v2.15.1
- Fix incomplete screenshots during background runs: a hidden (background) tab
  is render-throttled by Chrome, so html2canvas produced blank/partial images
  while you were on another tab/window. The tool now briefly makes the work tab
  visible just for each capture, then restores your tab, so all screenshots are
  complete even if you leave. (If Chrome is fully minimized the tab stays hidden
  and capture can still be affected — keep the window un-minimized.)
v2.15.0
- Titan/Pre-titan style tickets: a "<Label>:" prefix (e.g. "Titans:",
  "Pre-titans:") is stripped from program names, a bare label split from its
  id by a line break is re-joined, and each program is matched to the event
  prototype that contains its full id (so two ".sms" programs no longer
  collide). Programs share one Calendar ID when no other is given.
- The tool now keeps running when the popup is closed: after you click CHECK
  or CHECK ALL you can switch windows; reopen the popup any time to see live
  progress or the finished result. (Screenshots: Downloads mode works fully in
  the background; a chosen folder needs the popup open to save.)
v2.14.0
- New ticket type: Onboarding-calendar (Calendar ID / Shard Tags / Program ID
  / Content / Start Time columns). Fixes the N/A + no-time result on these.
  Content tokens are classified by prefix and each is checked for presence AND
  correct position: ev.* -> Event IDs, tag.* -> Package Tags, coc.* -> County
  Config IDs, cal.*/mission(s).* -> Calendar IDs (a new KM field the tool now
  reads). Shard Tag is checked by value. Flag is not checked (a Note is shown).
- Date/Time are read even when the column is named "Start Time" / "When" /
  "Start Date/Time", and, as a safeguard, detected by the value's date shape
  when the column title is unrecognized.
- Unknown Content prefixes are reported as a Note (not a FAIL).
v2.13.2
- Global / Repeat / Ends after are now bound PER PROGRAM (row), not the whole
  ticket: each program is checked only with its own data. A row's Global comes
  from its "Global Event" column; Repeat is read from that row's Duration cell
  ("... , repeat daily for N days"), and the repeat clause is stripped so the
  Duration check compares the real duration. Rows without this data are not
  checked for it. Repeats and Ends after are two separate report lines.
- Flag: for tickets with no Flag column (doc-level "Data Flag"), Flag is not
  auto-checked; a Note is shown in the report instead (handled later).
v2.13.1
- Evidence screenshot is now crash-proof: the full-height capture is
  best-effort, styles are always restored, it retries a plain capture, and
  if html2canvas still fails it saves a text-only report image (verdict +
  all check lines + actual data) so evidence is never lost.
v2.13.0
- Global check: enforced only when the ticket says Global = Yes (KM must be
  Yes, else FAIL). Ticket No/empty -> default No, pass.
- Repeats + Ends after: when the ticket has repeat data ("repeat every X day,
  N occurrences" or "repeat daily for N days"), KM "Repeats" must be "Every X
  day(s)" and "Ends after" must be "N occurrences"; a wrong count is a FAIL.
- Event IDs / Package Tags / County Config ID now report POSITION clearly:
  "present in the correct field (X)" on pass, or "found in the WRONG field (Y)"
  as a FAIL if the value is mis-placed (e.g. an event id under Package Tags).
- Evidence screenshot now expands the popup's scroll area before capturing, so
  long fields (e.g. 5 package tags) are no longer cut off.
v2.12.4
- Boss-spawn "has data" check is prefix-agnostic: a version is added when
  its County Config cell holds a config-id-shaped value (word.word..., e.g.
  coc.* or toc.* or any future prefix). Empty / N/A / - / TBD (no dot) are
  skipped. Report wording generalized from "coc" to "config id".
v2.12.3
- Boss-spawn is now only added when the "County Config (if Applicable)"
  cell actually contains a config id (coc.*). Empty cells, "N/A", "-" or
  other placeholders are treated as not-applicable, so tickets without real
  v3/v4 data are no longer checked. Each version is independent (only v4
  present -> only v4 is added). The coc token is extracted even if the cell
  has surrounding text.
v2.12.2
- Boss-spawn report: the info line now reads "Note: ..." instead of an
  info glyph that rendered as a stray "i" in the evidence image.
- Row selection prefers an EXACT program-name match before the token-set
  match. Flag/id chips in the popup title are detected more robustly
  (id = dotted chip, flag = hyphen chip), so the "other" rows now show
  their KM flag instead of blank.
v2.12.1
- Boss-spawn: Flag is no longer scored (Pass/Fail) — the KM Flag value is
  just recorded in the report/evidence. When several KM programs share the
  coc id, the correct row is now picked by matching the ticket PROGRAM NAME
  (exact, else token-set ignoring order and any wkN suffix) instead of the
  flag. Added a name-first fallback: if no Content cell holds the coc id,
  the program is opened directly by its ticket name.
v2.12.0
- New ticket type: boss-spawn v3/v4 via the "County Config (if Applicable)"
  table. For each version it adds a program that is located on KM Design by
  its coc id (Content column), then checks: (1) the coc id sits in "County
  Config IDs" and NOT in "Event IDs" (mis-tag = FAIL), (2) Shard Tag (from
  the ticket, else default events-vX-spawn), (3) Flag, (4) Date, (5) Time,
  (6) Duration - all inherited from the main program. When several KM
  programs share the coc id, all are checked and the verdict is taken from
  the row whose Flag matches the ticket. Evidence image is named
  <mainProgram>__<v3/v4 ticket id>.
v2.11.0
- Time comparison is now format-tolerant: a missing seconds field counts
  as :00, so "02:00 UTC" and "02:00:00 UTC" MATCH, while "02:00:10" does
  NOT match "02:00". Timezone only fails when both sides state one and
  they differ.
- Date comparison is now component-based (month/day/year) instead of a
  raw substring: leading zeros, 2-digit years, and month names all match;
  when the ticket has no year, only month/day are compared.
v2.10.1
- FIX (real cause of blank Date): dates entered as a Jira DATE LOZENGE
  (an ADF `date` node, e.g. the grey "21 Sept 2026" box) were invisible
  to the parser because it only read plain text. It now reads date/status
  lozenges too and converts the lozenge to KM Design's M/D/YYYY.
- Bare duration under a "Duration" cell (e.g. just "22d") is now read.
v2.10.0
- FIX: Offer/Shop dates that omit the year or use ordinals/full month
  names ("25 Sep", "25th September 2026") were not being read and the
  Date field was left blank. Date parsing is now robust and always
  normalizes to KM Design's M/D order.
- UI: "Clear" button moved to the TOP of the form (and batch panel) so
  you don't have to scroll down to reset.
- UI: added a progress bar / loading animation (indeterminate for a
  single check, determinate X/N for batch) so you can see it running.
- All tool text translated to English.
v2.9.0  - Offer/Store Window family support (parseOffer, DD-Mon dates).
v2.8.0  - KvK support (program-per-row, Content col, cal.* fallback).
v2.7.0  - Position-independent, label-based parser + stacked cells.
v2.6.0  - Glued-tag fix (ev.*/tag.* auto-split).
