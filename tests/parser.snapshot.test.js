// Snapshot test for the ticket readers: one test per file in fixtures/.
// A snapshot records CURRENT behaviour, not correct behaviour: read each new snapshot once
// against its ticket. When a diff shows up later: intended -> `npm run test:update`,
// not intended -> you just caught a regression.
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCountyConfig, parsePerRowExtras, parseTicketV2 } from "../src/core/parser/index.js";

const DIR = new URL("../fixtures/", import.meta.url);
const files = readdirSync(DIR).filter(f => f.endsWith(".json")).sort();

test("fixtures folder has at least one ticket", () => { expect(files.length).toBeGreaterThan(0); });

for (const file of files) {
  test(file, () => {
    const { fields } = JSON.parse(readFileSync(new URL(file, DIR), "utf8"));
    const summary = (fields && fields.summary) || "", desc = fields && fields.description;
    // same call as popup/jira.js readJira()
    expect({
      ticket: parseTicketV2(desc, { mission: /mission/i.test(summary), title: summary }),
      boss: parseCountyConfig(desc),
      extras: parsePerRowExtras(desc),
    }).toMatchSnapshot();
  });
}
