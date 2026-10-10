# Task 3 Report: Switch the Workspace to Full-Market Search

## Delivered

- Every screening run now POSTs the current `Strategy` to `/api/stock-search`, including reruns after condition edits. The workspace screens only the returned candidates with the existing deterministic engine.
- Search failures leave the last successful snapshot and result visible. The narrowing error uses the concise product wording; other transport, response, or parsing errors use the generic unavailable message.
- Successful reruns expose a code-set diff against the current comparison baseline. The diff is no longer suppressed when two live searches have distinct snapshot IDs.
- Industry is optional and editable: users can add a blank industry condition, fill any industry name, or remove it. An empty condition remains invalid until the user enters a value.
- Updated the entry copy, example, result counts, and page description for 沪深北 A 股. Unsupported indicators render one concise message without their internal reason. The candidate-search coverage boundary appears in the collapsed “数据详情” section.

## Verification

- Required focused command: `npm test -- src/hooks/use-copilot.test.tsx src/components/copilot-workspace.test.tsx` — 2 files, 21 tests passed.
- Full suite: `npm test` — 19 files, 166 tests passed.
- `npm run typecheck` — passed.
- `git diff --check` — passed.
- Added regressions covering the actual `POST /api/stock-search` request and narrowing-code mapping, plus the workspace narrowing message, retention of the successful result, and collapsed data details.

## Self-review and limitations

- The UI does not claim that a returned candidate set exhausts the market. The quick path cannot detect silent omissions by the upstream service; it only rejects truncation, over-limit responses, code-set mismatches, and parse failures detected by Task 2.
- This task's verification used controlled test responses. It did not perform live iFinD smoke queries, browser E2E, or a production build; those belong to Task 4's handoff verification.
