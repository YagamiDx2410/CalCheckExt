// Smoke tests for the pure modules in src/core (no chrome.*, no document).
// Run: npm test   (Node 18+)
import test from "node:test";
import assert from "node:assert/strict";
import { durSeconds, durVal } from "../src/core/duration.js";
import { slashDate, normDate, parseDateParts, parseTimeToken } from "../src/core/dates.js";
import { hasId, evLev, gluedParts, splitTagTokens } from "../src/core/ids.js";
import { cmpExact, cmpDuration, flagRuleChecks } from "../src/core/compare.js";
import { withTerm, reportOutSize } from "../src/core/layout.js";
import { adfPlainText } from "../src/core/adf.js";
import { parseTicketV2 } from "../src/core/parser/index.js";

test("duration: compared by value, not by characters", () => {
  assert.equal(durSeconds("24h"), 86400);
  assert.equal(durSeconds("1d"), 86400);
  assert.equal(durSeconds("23h50m"), 85800);
  assert.equal(durVal(" 2d 3h "), "2d 3h");
  assert.equal(durVal("N/A"), "");
  assert.equal(cmpDuration("Duration", "24h", "1d").pass, true);
});

test("dates: weekday decides day/month order", () => {
  assert.equal(slashDate("Tuesday, 03/11/2026"), "11/3/2026");
  assert.equal(normDate("25th September 2026"), "9/25/2026");
  assert.deepEqual(parseDateParts("11/3/2026"), { mo: 11, d: 3, y: 2026 });
  assert.deepEqual(parseTimeToken("10:00 UTC"), { sec: 36000, tz: "UTC" });
});

test("ids: whole-id match, glued ids are split", () => {
  assert.equal(hasId("kvk-c033-b072, x", "kvk-c033"), false);
  assert.equal(hasId("kvk-c033, x", "KVK-C033"), true);
  assert.equal(evLev("abc", "abd"), 1);
  assert.deepEqual(gluedParts("ev.Atag.B"), ["ev.A", "tag.B"]);
  assert.deepEqual(splitTagTokens("ev.a.sms, tag.b"), { tokens: ["ev.a.sms", "tag.b"], glued: [] });
});

test("compare: exact match is case-insensitive, tbd flag is rejected", () => {
  assert.equal(cmpExact("Flag", "live", "Live").pass, true);
  const r = flagRuleChecks("tbd", "tbd", "program", true);
  assert.equal(r[0].pass, false);
  assert.equal(r[0].flagBad, "tbd");
});

test("layout + adf + parser entry", () => {
  assert.equal(withTerm("https://x.test/design/calendars?a=1", "cal.1"), "https://x.test/design/calendars?a=1&term=cal.1");
  assert.deepEqual(reportOutSize(4800, 1000), { w: 2400, h: 500, f: 0.5 });
  assert.equal(adfPlainText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] }), " hello");
  assert.deepEqual(parseTicketV2(null), { cases: [], warnings: [] });
});
