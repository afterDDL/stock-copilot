# Final review fix wave

Date: 2026-10-10, Asia/Shanghai. Baseline: `efd5455`.

## Findings and final behavior

| Finding | Fix | Regression evidence |
|---|---|---|
| 1. Display indicators depended on hard filters | Removed condition-derived indicator allowlist. Both controlled tables always provide cap and profit metrics; output remains projected to the three supported fields. | Real `IfindMcpClient` HTTP path with cap-only, profit-only, industry-only and bounded no-industry strategies; extra supported display indicator accepted. |
| 2. Industry extraction swallowed verbs and following conditions | Added a shared extractor used by intent-schema and resolver, separating request scaffolding, industry suffixes and later financial clauses. | `resolveIntent` cases for 筛选人工智能行业股票, 找电子行业且市值至少100亿元, 只看电子行业且市值至少100亿元; complete `/api/intent` chain retains the model-provided correct industry and remains executable. |
| 3. Failed queries explained old results with edited strategy | Added atomic `SuccessfulQuery` state containing copied strategy, snapshot, envelope and result. The comparison baseline uses the same type. Results receive `resultStrategy`, not the editor's strategy; a stale-result note distinguishes unsatisfied edits. | Hook preserves successful-query identity, thresholds and rebase provenance after failure. RTL changes both threshold and sort and verifies original result explanations. |
| 4. Removed candidates lost names and evidence | Diff reads removed stock names from `previousResult`. Selection records current/baseline query explicitly; evidence opens the original baseline result with baseline snapshot date and strategy version. | RTL returns an empty smaller snapshot after the initial query, clicks named 浦发银行 removal, and sees version 1 / old date / original 1000亿元 threshold, never the new 2000亿元 threshold. |
| 5. Mixed-industry ranks claimed peer comparisons | All ranks use 本次候选中的市值位置 and 候选前30%. | Mixed-industry no-industry RTL case verifies candidate wording and absence of 同业. |
| 6. Internal concept IDs appeared in mapping | Added Chinese concept labels and a generic fallback for unknown concepts; financial field labels remain Chinese. | RTL verifies company_size, industry_scope and unknown-concept labels never appear as internal identifiers. |
| 7. Strict parse failures had inconsistent public errors | Every `SnapshotError` within candidate parsing becomes `AshareSearchError(needs_narrowing)` while its private reason survives. `IfindError` and external acquisition failures retain generic HTTP 503 / data_unavailable. | Adapter covers missing columns, identity mismatch, malformed units, invalid dates, empty content, truncation, coverage mismatch and duplicates. Route and real-client tests distinguish quota/upstream failures from narrowing. |
| 8. Failure explanations and docs were technical | API quota failures retain generic 503/code and show exactly the requested one-sentence notice. Hook forwards only that approved notice. README/NEXT_STEPS/AI_DEV_LOG/TEST_REPORT are short product-oriented handoff docs; diagnosis history removed. Data details hide raw source identifiers, request counts and engineering formulas. | Route/hook regression verifies exact concise quota message. RTL with a raw provider source string verifies no MCP/search_stocks/request-step/formula copy reaches users. |

## TDD evidence

- Adapter RED: 12 failures before changes, including real-client cap/profit/industry-only paths and strict-error conversion; GREEN: adapter/client 30 tests passed.
- Intent RED: six new resolver/actual-route failures showed prefixes and trailing conditions in industry values. The shared extractor caused three existing bank-expression regressions, which were corrected; GREEN: mapping/intent schema/API 90 tests passed.
- Hook/UI/route RED: stale provenance, removed names, concept IDs and quota text failed. One UI selector was corrected to the existing label 利润增长排序 before verifying its intended stale-result failure; GREEN: 30 tests passed.
- The independent mixed-industry test was additionally mutation-checked by restoring the old 同业 sentence, observing failure, then restoring candidate wording. Source-detail sanitization separately failed against the raw source and engineering formula before the copy fix.
- Human handoff prose was rewritten directly; no source-text assertion tests were added for documents.

## Final verification

| Command | Result |
|---|---|
| Focused adapter/client/resolver/intent/API/hook/component tests | 8 files, 152 tests passed |
| `npm test` | 19 files, 192 tests passed |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0; Next.js production pages and API routes generated |
| `npm run test:e2e -- --workers=1` | 8/8 passed; 6.9 seconds |
| `git diff --check` | Exit 0 |

Playwright printed existing environment-only NO_COLOR/FORCE_COLOR warnings. There were no failed tests, type errors or build errors. No subagents were spawned, and no additional live iFinD requests were made during this wave.

## Residual concerns

- No supplied review finding remains open.
- Real-data acceptance for two non-bank industries and a bounded market-wide strategy remains unverified: the iFinD account's call quota is exhausted. This wave used controlled data and did not repeat live calls. Public wording is exactly: iFinD 账号调用额度已用完，当前无法获取实时数据。
- Cloud deployment remains unverified. The existing candidate-search fast path cannot prove exhaustive A-share coverage; this limitation remains in collapsed data details and concise handoff copy.
