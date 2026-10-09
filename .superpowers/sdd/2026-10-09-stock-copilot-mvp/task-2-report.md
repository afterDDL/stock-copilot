# Task 2 Report: iFinD MCP Adapter and Real Snapshot

## RED/GREEN evidence

- RED: focused tests initially failed because the adapter and route were absent. After adding test-visible stubs, 8 behavior assertions failed as expected for missing date mapping, strict parsing/coverage, retry, credential validation, and fallback response behavior.
- Additional RED: the JSON-wrapped `search_stocks` response test failed because the answer table was nested inside the iFinD JSON envelope.
- GREEN: focused adapter and route suite passes: 4 files, 9 tests.
- Full suite: 12 files and 40 tests pass; one UI test fails because `src/components/copilot-workspace` is not present, and one hook test expects `actions.canRun === true` but receives false. Both failures are outside Task 2.
- Typecheck is blocked by concurrent UI/storage work: missing `copilot-workspace`, `UserEvent.findByText` typing, and an unsupported `removeItem` in a storage test mock. No Task 2 file appears in the reported errors.

## Real acquisition

- Status: HTTP 200, `mode: live`, no fallback error.
- Successful saved acquisition elapsed time: 1,975 ms; two sequential `search_stocks` requests (market cap and parent net profit growth).
- Capture time: `2026-10-09T16:13:30.978Z`.
- Statistic dates: market cap `2026-10-09`; net profit growth `2026-06-30`.
- Returned stocks: 42 of 42. Industry, market cap, and net profit growth each have 42 available and 0 missing values.
- The saved data file is a historical fallback derived from that normalized live acquisition. The file contains the 42 stocks and capture/date/source evidence; it contains no screening result. The screening invariants were independently checked as 42 total, 16 at the ¥100bn threshold, 12 at the ¥200bn threshold, and 4 removed.
- Secret-pattern scan over all committed Task 2 files: PASS. No credential values are stored in code, tests, or snapshot data.

## Files

- `src/lib/ifind/client.ts`, `markdown.ts`, `banks.ts`, `errors.ts` and adjacent tests.
- `src/app/api/bank-snapshot/route.ts` and `route.test.ts`.
- `data/bank-snapshot.json`.

## Commit

- Implementation commit: `bd53e0f` (`feat: add iFinD bank snapshot adapter`).

## Self-review and concerns

- The MCP client reads credentials only from `IFIND_MCP_AUTH_TOKEN`; query responses are parsed through the content envelope and rejected on empty, malformed, truncated, miscolumned, duplicate, misaligned, or incomplete results. A single content-layer 429 retry is covered.
- Default live endpoint behavior safely serves the validated historical snapshot with sanitized error details on acquisition failure. `mode=historical` bypasses live acquisition.
- Concern: an early environment-variable name scan printed the local credential in tool output. It was not committed or written into repository files. The secret-pattern scan passed; rotating the credential is still prudent.

## Review fix round

- RED: new adapter tests failed because parseable but incorrect market cap and profit statistic dates were accepted. The route fallback test failed because it exposed the mocked upstream error message.
- GREEN: controlled dates are now enforced as market cap `2026-10-09` and profit growth `2026-06-30`. The route always emits a fixed safe fallback message and validates the error code before returning it.
- Focused adapter suite: 4 files, 12 tests pass.
- Full suite: 12 files and 48 tests pass; 4 unrelated UI/intent tests fail (ambiguous compare button query, two intent thresholds, unsupported metric detection).
- Typecheck: passes.
- Review-fix files: `src/lib/ifind/banks.ts`, `src/lib/ifind/banks.test.ts`, `src/lib/ifind/errors.ts`, and `src/app/api/bank-snapshot/route.test.ts`.
