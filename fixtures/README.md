# Fixtures — Jira tickets for the parser snapshot test

Every `*.json` here is read by `tests/parser.snapshot.test.js`.

## Add a ticket
1. Signed in to Jira, open in the browser:
   `https://globalworldwide.atlassian.net/rest/api/3/issue/KM-xxxxx?fields=description,summary`
2. Save the JSON as `fixtures/KM-xxxxx.json` (unchanged).
3. `npm test` — the first run writes the snapshot. Read it once against the ticket.

Pick one ticket per layout in README.txt, and first the ones that broke the reader before:
KM-62668, KM-63219, KM-63509, KM-63070, KM-63623, KM-63232.

## Bug-fix routine
Ticket read wrongly -> save it here -> fix -> `npm test` shows which older tickets changed.
Intended change: `npm run test:update`.

## Privacy
Real tickets are internal data. `fixtures/KM-*.json` and the parser snapshot are in `.gitignore`,
so they stay on this machine. Remove those two lines only if this repo is company-private.
`_synthetic-*.json` is made-up data and is committed.
