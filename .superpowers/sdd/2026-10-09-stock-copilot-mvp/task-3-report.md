# Task 3 — DeepSeek Structured Intent and Strategy Modification

## RED / GREEN evidence

- RED: Added schema/merge and route tests before production modules existed. The focused run failed at module resolution for `intent-schema` and `route`, confirming the requested feature was absent.
- GREEN: `npm test -- src/lib/ai/intent-schema.test.ts src/app/api/intent/route.test.ts` — 2 files passed, 11 tests passed.
- The tests cover fuzzy defaults, preservation of untouched current-strategy criteria, version increments, clarification gating, unsupported metrics, deterministic return-prediction gating, empty/truncated/schema-invalid provider output, malformed requests, credential secrecy in responses, and missing server credentials.

## DeepSeek smoke evidence

- Used the existing `.env.local` through the Next server runtime; confirmed only that `DEEPSEEK_API_KEY` was present. The key was never printed or logged.
- Final route smoke: HTTP 200, 4,210 ms; local schema/semantic validation passed for `market_cap_cny >= 100000000000` CNY with `aiInferred` and `editable`, `net_profit_parent_yoy_pct > 0`, descending profit sort, and `canExecute: true`.
- An earlier live attempt returned a schema-invalid response. Inspection showed the Responses API includes a separate reasoning item before the schema-formatted assistant message. The adapter was corrected to read only `message` / `output_text`; the final smoke passed.

## Files

- `src/lib/ai/intent-schema.ts` — strict delta parser, fuzzy defaults, merge behavior, unsupported request gate, and validated `IntentResponse`.
- `src/lib/ai/prompt.ts` — strict JSON Schema and prompt containing the current strategy.
- `src/lib/ai/deepseek.ts` — server-side `DEEPSEEK_API_KEY` access and Responses API adapter.
- `src/app/api/intent/route.ts` — validated POST route and safe errors.
- Adjacent schema and route tests.

The endpoint accepts `{ query, currentStrategy? }` and returns `{ intent: { strategy, assumptions, clarifications, unsupportedRequests, canExecute } }`.

## Verification

- Focused tests: 11 passed.
- Full suite: 12 files passed, 2 files failed to import unfinished peer UI modules `src/components/copilot-workspace` and `src/hooks/use-copilot`; 37 tests passed.
- `npm run typecheck`: blocked by the same missing UI modules plus unrelated in-progress errors in `src/components/copilot-workspace.test.tsx`, `src/hooks/use-copilot.test.tsx`, and `src/lib/storage/strategies.test.ts`.
- `git diff --cached --check`: clean before commit.

## Commit

- Implementation: `f36308d` (`feat: add DeepSeek structured intent parsing`).

## Self-review and concerns

- Unknown or commonly unsupported indicators and return/price forecasts fail closed and set `canExecute: false`; profit growth always sorts descending.
- Default statistic dates (`2026-10-09` market cap and `2026-06-30` profit) follow the Phase 0 evidence. They may need to become request-date/config driven once date selection is introduced.
- The full repository suite and typecheck remain blocked by concurrently added UI/storage tests whose implementation is not present in this worktree snapshot; these failures are outside Task 3 files.

## Follow-up review fixes

- RED: Added adversarial cases proving that valid model updates could override the fuzzy market-cap/profit-growth meanings, an omitted `unsupported_requests` let “经营现金流” through, and an `industry=互联网` update produced both internet and bank conditions. All three tests failed before the fixes.
- GREEN: The focused Task 3 run now passes 14/14 tests. The parser reapplies the fixed fuzzy meanings after model deltas, detects common and suffix-shaped Chinese financial metric terms without flagging ordinary prose such as “经营稳健、治理规范”, and rejects non-bank industry updates into `unsupportedRequests` so execution is blocked.
- Latest full suite: 12 test files passed, 2 failed; 43 tests passed, 3 failed. Failures are in peer UI work: two `CopilotWorkspace` tests fail due to duplicate “浦发银行” buttons, and `useCopilot` still reports `canRun=false` after clarification is answered. Task 3 focused tests passed in the same run.

## Follow-up review fixes, round 2

- RED: Added regressions for “按存贷比筛选银行股” with an empty model unsupported list, “盘子大，市值至少2000亿元”, and “业绩增长超过10%”. All three failed before the fix.
- GREEN: Focused Task 3 tests now pass 17/17. A local clause recognizer blocks unsupported subjects in explicit selection/sort or numeric threshold clauses, while the existing ordinary-prose case remains executable. Explicit market-cap and profit-growth numeric thresholds are extracted locally and take precedence over both model deltas and fuzzy defaults.
- Full suite was last run immediately before this round: 12 files passed, 2 failed (43 passed, 3 failed) in the peer UI tests listed above. This round reran the focused Task 3 tests only.

## Follow-up review fixes, round 3

- RED: Added the exact “筛选存贷比偏低的银行股” case, a mixed supported/unsupported “市值大且存贷比偏低” case, and allowlist regressions for net-profit growth, profit-growth, and market-cap aliases. The descriptive-selection and several alias cases failed before the fix.
- GREEN: The focused Task 3 run passes 29/29 tests. Clause recognition now inspects descriptive text after selection verbs as well as `按…筛选/排序` and numeric thresholds, strips known supported phrases and harmless descriptive words, and blocks residual metric-like constraints. It permits `净利润同比增长率`, `归母净利润同比`, `利润增速`, `净利润增速`, `业绩增长`, `利润增长`, and the supported market-cap aliases. Ordinary descriptive prose continues to pass.
- No full-suite run in this round; the most recent full-suite status remains 43 passed, 3 peer UI failures (see prior round).

## Follow-up review fixes, round 4

- Root cause: residual detection returned supported whenever residual text lacked one of a finite set of financial trigger substrings. It also erased substantive quality preferences such as “经营稳健、治理规范”. Unknown criteria therefore failed open when the model omitted `unsupported_requests`.
- RED: Added adversarial regressions for “筛选授信质量好的银行股”, selection without a trigger verb (“存贷比偏低的银行股”), supported criteria mixed with unknown criteria, multiple unseen descriptive criteria, and quality/governance preferences. The first focused run failed 11 tests as expected (41 passed / 52 total). A subsequent RED check proved total-market-cap sorting still passed incorrectly (1 failed / 58 total).
- GREEN: Replaced both unsupported-metric blacklists and trigger-based clause detection with local P0 language coverage. Only bank scope, market-cap aliases, profit-growth aliases, field-bound numeric comparisons/units and profit-growth descending preference are consumed. Remaining meaningful text becomes an `unsupportedRequest` and blocks execution, regardless of the model's unsupported list. Consumed spans retain boundaries so fragments cannot combine into a new supported alias.
- All previously listed metric aliases remain executable. The canonical fuzzy request, explicit 2000亿元 and 10% thresholds, partial edit, field-bound lower/upper numeric comparisons, and profit-growth descending forms remain covered. The legacy “按总市值排序银行股” alias test now uses “筛选”: P0 supports profit-growth descending sorting only, so market-cap sorting and ascending requests fail closed.
- Focused verification: `npm test -- src/lib/ai/intent-schema.test.ts src/app/api/intent/route.test.ts` — 2 files passed, 58 tests passed. `git diff --check` — clean.
- Full suite: `npm test` — 13 files passed, 1 failed; 100 tests passed, 2 failed. Both failures are in concurrent Task 4 hook work: `keeps multiple clarifications tied to the original query and resubmits explicit answers with currentStrategy` and `keeps the deterministic canonical equality and removes all other reported equalities` (`src/hooks/use-copilot.test.tsx`). Task 3 files passed in this run.
- Typecheck: blocked by two concurrent hook-test API mismatches: `Clarification.prompts` and `actions.submitClarification` in `src/hooks/use-copilot.test.tsx` (lines 72 and 76). No Task 3 type errors were reported.
- Scope/concerns: changed only this report and Task 3 schema/parser tests. A strict finite supported grammar intentionally rejects unrecognized paraphrases as well as unsupported criteria; additional accepted phrasing must be explicitly covered without erasing generic quality modifiers. No new live provider call was necessary for this local validation change; the prior sanitized smoke evidence remains the latest provider check.
