// Business rules as runnable examples: one changelog line = one row.
import { describe, expect, test } from "vitest";
import { adaptGlued, cmpDate, cmpDurField, cmpDuration, cmpInField, cmpTime, cmpWhen, flagRuleChecks } from "../src/core/compare.js";
import { normDate, parseTimeToken, slashDate } from "../src/core/dates.js";
import { durSeconds, durVal } from "../src/core/duration.js";
import { gluedParts, hasId, idWhy, splitTagTokens } from "../src/core/ids.js";
import { planListClip, topStackLayout } from "../src/core/layout.js";

describe("duration", () => {
  test.each([
    ["24h", "1d", true],
    ["23h50m", "23h 50m", true],
    ["1d23h45m", "1d 23h 45m", true],
    ["90m", "1h30m", true],
    ["1d 0h", "24h", true],
    ["7d", "8d", false],
  ])("%s vs %s -> same: %s", (a, b, same) => {
    expect(durSeconds(a) === durSeconds(b)).toBe(same);
    expect(cmpDuration("Duration", a, b).pass).toBe(same);
  });

  test.each(["", "-", "N/A"])("blank value %j is not a duration", v => {
    expect(durSeconds(v)).toBe(null);
    expect(durVal(v)).toBe("");
  });

  // cmpDurField(label, ticket, KM, strict): strict = an empty ticket cell must be empty on KM too
  test.each([
    ["", "N/A", true, true],
    ["", "-", true, true],
    ["", "1h", true, false],
    ["1h", "60m", true, true],
    ["1h", "", true, false],
  ])("field: ticket %j | KM %j | strict %s -> pass %s", (exp, act, strict, pass) => {
    expect(cmpDurField("Pre", exp, act, strict).pass).toBe(pass);
  });
  test("field: empty ticket cell is not checked when not strict", () => {
    expect(cmpDurField("Pre", "", "1h", false)).toBe(null);
  });
});

describe("time", () => {
  const KM = "11/3/2026 02:00:00 UTC";
  test("02:00 = 02:00:00", () => { expect(parseTimeToken("02:00").sec).toBe(parseTimeToken("02:00:00").sec); });
  test.each([
    ["02:00 UTC", KM, true],
    ["02:00", KM, true],                          // no timezone on the ticket: time only
    ["02:00:10 UTC", KM, false],                  // seconds count
    ["02:00 UTC", "11/3/2026 02:00:10 UTC", false],
    ["02:00 PST", KM, false],                     // timezone differs
  ])("ticket %j vs KM %j -> pass %s", (exp, when, pass) => {
    expect(cmpTime("Time", exp, when).pass).toBe(pass);
  });
  test("timezone mismatch is named in the message", () => {
    expect(cmpTime("Time", "02:00 PST", KM).line).toContain("timezone differs: PST vs UTC");
  });
});

describe("date", () => {
  test.each([
    ["21 Sept 2026", "9/21/2026"],
    ["25th September 2026", "9/25/2026"],
    ["September 25, 2026", "9/25/2026"],
    ["25th September", "9/25"],                   // no year
    ["Tuesday, 03/11/2026", "11/3/2026"],         // 3 Nov 2026 is a Tuesday -> day first
    ["Wednesday, 03/11/2026", "03/11/2026"],      // 11 Mar 2026 is a Wednesday -> month first, untouched
    ["03/11/2026", "03/11/2026"],                 // no weekday -> untouched
  ])("normDate(%j) = %j", (raw, out) => { expect(normDate(raw)).toBe(out); });

  test("weekday decides day/month order", () => { expect(slashDate("Tuesday, 03/11/2026")).toBe("11/3/2026"); });

  test.each([
    ["9/21/2026", "21 Sept 2026 10:00 UTC", true],
    ["9/21/2026", "Sep 21, 2026 10:00 UTC", true],
    ["9/21/2026", "9/22/2026 10:00 UTC", false],
    ["9/21", "9/21/2026 10:00 UTC", true],        // ticket without a year: month/day only
  ])("ticket %j vs KM %j -> pass %s", (exp, when, pass) => {
    expect(cmpDate("Date", exp, when).pass).toBe(pass);
  });
});

describe("ids", () => {
  test("whole id, never 'contains'", () => {
    expect(hasId("kvk-c033-b072", "kvk-c033")).toBe(false);
    expect(hasId("kvk-c033", "kvk-c033-b072")).toBe(false);
    expect(hasId("a, kvk-c033 b", "KVK-C033")).toBe(true);
  });
  test.each([
    ["ev.kvk.day1.sms", "ev.kvk.day1.smss", "1 extra character"],
    ["ev.kvk.day1.sms", "ev.kvk.day1.sm", "1 missing character"],
    ["ev.kvk.day1.sms", "ev.kvk.day2.sms", "different day"],
  ])("near miss: want %s, KM has %s -> %s", (want, got, why) => { expect(idWhy(want, got)).toBe(why); });

  const row = (...a) => cmpInField("Event ID", ...a);
  test("id in the correct field passes", () => {
    expect(row("ev.a", "Event IDs", "ev.a, ev.b", [{ name: "Package Tags", val: "" }], ["ev.a"]).pass).toBe(true);
  });
  test("id in the wrong field fails and names the field", () => {
    const r = row("ev.a", "Event IDs", "ev.b", [{ name: "Package Tags", val: "ev.a" }], ["ev.a"]);
    expect(r.pass).toBe(false);
    expect(r.line).toContain("WRONG field (Package Tags)");
  });
  test("near miss on KM is explained", () => {
    const r = row("ev.kvk.day1.sms", "Event IDs", "ev.kvk.day1.smss", [], ["ev.kvk.day1.sms"]);
    expect(r.pass).toBe(false);
    expect(r.line).toContain("1 extra character");
  });
});

describe("glued ids", () => {
  test("ev.Atag.B is split in two", () => {
    expect(gluedParts("ev.Atag.B")).toEqual(["ev.A", "tag.B"]);
    expect(splitTagTokens("ev.Atag.B")).toEqual({ tokens: ["ev.A", "tag.B"], glued: ["ev.Atag.B"] });
  });
  test("coc.v5.ev.kvk stays one id", () => {
    expect(splitTagTokens("coc.v5.ev.kvk")).toEqual({ tokens: ["coc.v5.ev.kvk"], glued: [] });
  });
  // The ticket reader splits "ev.ftev.kvk.v2" (it looks glued); it stays ONE id only when KM holds
  // exactly that id — decided later by adaptGlued, once KM has been read.
  test("ev.ftev.kvk.v2: split by the reader, kept as one when KM has it in that form", () => {
    const read = splitTagTokens("ev.ftev.kvk.v2");
    expect(read).toEqual({ tokens: ["ev.ft", "ev.kvk.v2"], glued: ["ev.ftev.kvk.v2"] });
    const p = adaptGlued({ event: read.tokens.join(", "), tags: "", _glued: read.glued }, { event: "ev.ftev.kvk.v2", tags: "" });
    expect(p.event).toBe("ev.ftev.kvk.v2");
    expect(p._gluedKept).toEqual(["ev.ftev.kvk.v2"]);
  });
  test("glued id stays split when KM does not hold the glued form", () => {
    const p = adaptGlued({ event: "ev.A", tags: "tag.B", _glued: ["ev.Atag.B"] }, { event: "ev.A", tags: "tag.B" });
    expect(p.event).toBe("ev.A");
    expect(p._gluedKept).toBeUndefined();
  });
});

describe("When with several entries", () => {
  const KM = "11/3/2026 10:00 UTC\n11/10/2026 12:00 UTC";
  const passes = (d, t) => cmpWhen(d, t, KM).filter(c => c.pass !== null).map(c => c.label + ":" + c.pass);
  test.each([
    ["11/3/2026", "10:00 UTC", ["Date:true", "Time:true"]],
    ["11/10/2026", "12:00 UTC", ["Date:true", "Time:true"]],
    ["11/3/2026", "12:00 UTC", ["Date:true", "Time:false"]],   // date of entry 1 + time of entry 2
    ["11/10/2026", "10:00 UTC", ["Date:true", "Time:false"]],
  ])("ticket %s %s -> %j", (d, t, out) => { expect(passes(d, t)).toEqual(out); });
  test("a date that is in no entry fails", () => {
    expect(cmpWhen("11/4/2026", "10:00 UTC", KM).some(c => c.label === "Date" && c.pass === false)).toBe(true);
  });
});

describe("flag rule", () => {
  // flagRuleChecks(ticket flag, KM flag, label, compare?)
  test.each([
    ["live", "live", true, true],
    ["live", "Live", true, true],
    ["live", "other", true, false],
    ["live", "other", false, true],       // not compared: only the rule applies
    ["", "", true, false],                // empty
    ["live", "", true, false],
    ["tbd", "tbd", true, false],
    ["live", "tbd", true, false],
    ["live", "ignore_me", true, false],
  ])("ticket %j | KM %j | compare %s -> pass %s", (exp, act, compare, pass) => {
    expect(flagRuleChecks(exp, act, "Flag", compare).every(c => c.pass !== false)).toBe(pass);
  });
  test.each([["", "empty"], ["tbd", "tbd"], ["ignore_me", "ignore_me"]])("KM flag %j is flagged as %j", (act, bad) => {
    expect(flagRuleChecks("live", act, "Flag", true)[0]).toMatchObject({ flagRule: true, flagBad: bad });
  });
});

describe("screenshot layout (pure geometry)", () => {
  test("planListClip: header-anchored, clamped to the viewport", () => {
    expect(planListClip({ hdrLeft: 100, hdrTop: 200, rowsBottom: 300, vw: 1200, vh: 800 })).toEqual({ x: 60, y: 184, width: 1132, height: 134, scale: 1 });
    expect(planListClip({ hdrLeft: 10, hdrTop: 5, rowsBottom: 5000, vw: 1200, vh: 800 })).toEqual({ x: 0, y: 0, width: 1192, height: 800, scale: 1 });
  });
  test("topStackLayout: list on top, separator, then the modal", () => {
    expect(topStackLayout(1000, 100, 1000, 2000, 900)).toEqual({ k: 1, sepPx: 8, W: 2000, H: 1008, yB: 108, hAcss: 100, clipW: 2000 });
    const l = topStackLayout(2000, 120, 1000, 1600, 900);   // list captured at 2x
    expect(l).toMatchObject({ k: 2, sepPx: 16, W: 2000, H: 1036, yB: 136, hAcss: 60, clipW: 1000 });
  });
});
