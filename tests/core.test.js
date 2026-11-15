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
import { cmpVersion, manifestVersion, parseVersion } from "../src/core/version.js";

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

test("version: compared number by number", () => {
  assert.equal(cmpVersion("2.33.0", "2.33.0"), 0);
  assert.equal(cmpVersion("2.33", "2.33.0"), 0);
  assert.equal(cmpVersion("2.9.0", "2.10.0"), -1);
  assert.equal(cmpVersion("2.34.0", "2.33.9"), 1);
  assert.equal(cmpVersion("2.33.0", "abc"), null);
  assert.deepEqual(parseVersion(" 2.33.0 "), [2, 33, 0]);
  assert.equal(manifestVersion('{"version":"2.33.0"}'), "2.33.0");
  assert.equal(manifestVersion("<html>404</html>"), "");
  assert.equal(manifestVersion('{"name":"x"}'), "");
});

test("ai assist: prompt, reply reader, compare by value, merge", async () => {
  const { AI_FIELDS, adfPromptText, aiCompare, aiMerge, aiSame, aiUnseen, buildAiPrompt, parseAiReply } = await import("../src/core/ai.js");
  const doc = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "See https://x.example/browse/KM-1 for details" }] },
    { type: "table", content: [{ type: "tableRow", content: [
      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Program" }] }] },
      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "fund.a" }] }] }] }] }] };
  assert.equal(adfPromptText(doc), "See for details\nProgram | fund.a");
  const prompt = buildAiPrompt("ticket text http://a.b/c", "ab12");
  AI_FIELDS.forEach(f => assert.ok(prompt.includes("- " + f.key + " = " + f.label)));
  assert.ok(!/https?:|[{}]/.test(prompt));
  assert.equal(parseAiReply(prompt, "ab12"), null);                 // the prompt's own sample is not an answer
  const reply = prompt + "\n```\nCALCHECK-BEGIN ab12\nprogram: 1\ncalId: cal.x\nprogId: fund.a\nEvent IDs: ev.b, ev.a\ndur: 24h\ntime: 02:00\npost: N/A\nprogram: 2\nprogId: fund.c\nCALCHECK-END ab12\n```";
  const ai = parseAiReply(reply, "ab12");
  assert.equal(ai.length, 2);
  assert.equal(ai[0].event, "ev.b, ev.a"); assert.equal(ai[0].post, ""); assert.equal(ai[0].date, "");
  assert.equal(parseAiReply(reply, "zz99"), null);
  assert.equal(parseAiReply("CALCHECK-BEGIN ab12\nprogram: 1\ncalId: cal.x", "ab12"), null);   // not finished
  assert.equal(aiSame("dur", "24h", "1d"), true);
  assert.equal(aiSame("ids", "ev.a, ev.b", "EV.B,ev.a"), true);
  assert.equal(aiSame("time", "02:00", "02:00:00 UTC"), true);
  assert.equal(aiSame("date", "9/01/2026", "9/1/2026"), true);
  assert.equal(aiSame("date", "03/11/2026", "11/3/2026"), false);
  assert.equal(aiSame("id", "", ""), true); assert.equal(aiSame("id", "a", ""), false);
  assert.equal(aiUnseen("ids", "ev.a, ev.zz", "has ev.a only"), true);
  assert.equal(aiUnseen("dur", "9d", "nothing"), false);
  const tool = [
    { calId: "cal.x", progId: "fund.a", event: "ev.a, ev.b", dur: "1d", time: "02:00:00 UTC", repeatEvery: 2 },
    { calId: "cal.x", progId: "fund.b" },
    { calCheck: true, calId: "cal.x", progId: "cal.x" }];
  const cmp = aiCompare(tool, ai, "cal.x fund.a ev.a ev.b");
  assert.equal(cmp.same, false);
  assert.deepEqual(cmp.rows.map(r => r.side + ":" + r.progId + ":" + r.same), ["both:fund.a:true", "tool:fund.b:false", "ai:fund.c:false"]);
  assert.equal(cmp.rows[2].cells.find(c => c.key === "progId").unseen, true);
  assert.equal(aiCompare([tool[0]], [ai[0]]).same, true);
  const merged = aiMerge(tool, ai);
  assert.deepEqual(merged.map(c => c.progId), ["fund.a", "fund.c", "cal.x"]);
  assert.equal(merged[0].repeatEvery, 2); assert.equal(merged[0].dur, "24h"); assert.equal(merged[2].calCheck, true);
});
