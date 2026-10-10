# SDD ledger — plan: docs/superpowers/plans/2026-10-10-full-a-share-fast-path.md

## Pre-flight scan

| Tasks | Producer / consumer relationship | Finding |
| --- | --- | --- |
| 1 → 2 | Generalized `Strategy` feeds query builder and API | Clean; optional industry is represented only as a condition. |
| 1 → 3 | Domain, intent and storage feed hook/UI | Clean; legacy bank strategies retain their condition. |
| 2 → 3 | `POST /api/stock-search` feeds rerun flow | Clean; failures preserve the prior successful result. |
| 2 → 4 | Real adapter/API feeds live smoke | Clean; broad queries are expected to return concise narrowing errors. |
| 3 → 4 | Integrated UI feeds E2E and docs | Clean. |
| Task 1 | Tests and implementation both remove forced bank scope | Clean. |
| Task 2 | Adapter and route reject partial responses | Clean. |
| Task 3 | Copy and data-flow requirements agree | Clean. |
| Task 4 | Verification and docs report measured limitations | Clean. |

Ruling: This plan implements the user's speed-first revision after the exact-cover probe failed. It intentionally verifies only the returned candidate set and never labels it an exhaustive market result. — Cost if wrong: iFinD may omit otherwise eligible stocks; the UI mitigates only detectable broad/truncated responses, not silent selection omissions.

Task 1: fix round 1/5 (1 addressed, 0 open — arbitrary industry residual scan; commits 4997707..8a4cd69)

Task 1: complete (commits 3fbc15f..8a4cd69, review clean)

Task 2: complete (commits 8a4cd69..caa5bf8, review clean)

Task 3: fix round 1/5 (1 addressed, 0 open — preserve prior result/baseline across intent changes; commits 3f55fc6..5702477)

Task 3: complete (commits caa5bf8..5702477, review clean)

Task 4: fix round 1/5 (1 addressed, 1 open — E2E fixture fixed; real smoke failure misclassified; commits 987720b..c4b3684)

Task 4: fix round 2/5 (1 addressed, 0 open — quota exhaustion classified and documented; commits c4b3684..efd5455)

Task 4: complete (commits 5702477..efd5455, review clean; live success externally blocked by exhausted iFinD `search_stocks` entitlement and reported as not verified)

Final review fix wave: 8 supplied findings addressed. Fixed-display indicators are independent of hard filters; industry extraction is shared across intent stages; successful query provenance and baseline snapshots stay bound to results; removed-stock evidence opens from the baseline query. Candidate rankings and concepts use product language. All strict candidate parse failures narrow; external failures remain HTTP 503. Four user-facing documents were compressed per the latest instructions.

Final fix verification: focused 8 files / 152 tests; full 19 files / 192 tests; typecheck; production build; E2E 8/8 — all passed. Live acceptance remains unverified due to account quota; no new live requests were issued. See final-fix-report.md.
