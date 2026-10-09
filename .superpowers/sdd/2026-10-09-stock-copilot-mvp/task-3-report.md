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
