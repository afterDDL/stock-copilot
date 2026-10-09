# SDD ledger — plan: docs/superpowers/plans/2026-10-09-stock-copilot-mvp.md

Ruling: The user's detailed formal-development brief is treated as the approved architectural design and the explicit request for autonomous Luna subagents is the execution-method selection — avoids waking the user for redundant gates — cost if wrong: some interaction details may need later rework.
Ruling: P0 ships one verified bank-industry universe and two verified metrics; unsupported industries/metrics are rejected rather than approximated — preserves data truth — cost if wrong: the MVP feels narrower than a generic screener.
Task 1: minor (deferred): `StockRecord.industry` and `metrics.industry.value` can diverge because snapshot schema does not enforce equality; final integration review must decide whether to remove duplication or add a refinement.
Task 1: fix round 1/5 (1 addressed, 0 open — statisticDate mismatch now yields unknown; commits ba8a7a4..b45b5a6)
Task 1: complete (commits b4f83f1..b45b5a6, review clean except deferred minor)
Task 2: security blocker (deferred to user): an iFinD credential value appeared in an internal subagent tool output during an early scan; committed files and snapshot scanned clean. Ruling: do not perform unrequested external credential rotation while the user sleeps; finish code with no further exposure and require rotation before deployment — cost if wrong: the local credential remains valid longer than ideal.
Task 2: fix round 1/5 (2 addressed, 0 original findings open — exact date rejection and sanitized historical fallback test; commits 9fa9dc8..8acb914)
Task 2: Ruling: keep exact dates 2026-10-09 market cap and 2026-06-30 interim profit for the P0 controlled-query contract, despite reviewer concern that later dates will fall back — prevents silent period drift and matches the user-approved verified chain — cost if wrong: the MVP will require a parameterized as-of-date enhancement before rolling to newer periods.
Task 2: complete (commits ccda162..8acb914, review clean for P0 contract; external credential rotation deferred)
Task 3: fix round 1/5 (2 addressed, 1 open — local fuzzy semantics and non-bank industry fixed; arbitrary unsupported metrics open; commits 375ae6a..9fa9dc8)
Task 3: fix round 2/5 (1 addressed, 1 open — explicit thresholds fixed; arbitrary descriptive criteria open; commits 8acb914..0df843b)
Task 3: fix round 3/5 (1 addressed, 1 open — supported aliases fixed; finite-trigger fail-open remains; commits 0df843b..f9082a4)
Task 3: fix round 4/5 (1 addressed, 0 open — strict P0 language coverage fails closed on meaningful residual criteria; commits 8c5e198..65ee6dd)
Task 3: complete (commits b45b5a6..65ee6dd, review clean)
Task 4: fix round 1/5 (4 addressed, 0 open — clarification context/all prompts, exact conflict repair, tabs accessibility, storage warnings; commits d470f89..e949c43)
Task 4: complete (commits 65ee6dd..e949c43, review clean)
Task 6: complete (commit 6611b24; 20/20 core intent eval, deterministic snapshot distributions/research insights and three-layer UI)
Task 6: review fixes complete (commit 21c40fa — eval expectations now data-driven, research wording factual, multi-round model/resolver deltas fail closed per decision key)
Task 5: browser acceptance complete (commits 8957edf and 21c40fa; 6/6 Playwright, refresh persistence, 1000→2000 diff, evidence, compare and unsupported paths)
Task 5: final verification complete (2026-10-10 — 17 files / 129 Vitest tests, typecheck, production build and 6/6 Playwright passed; live iFinD 42/42 and DeepSeek initial/patch smokes passed)
Ruling: model candidate changes never directly decide executable conditions; every changed decision key must also be covered by the deterministic whitelist resolver, otherwise the route blocks and asks for clarification — prevents partial silent application — cost if wrong: some new phrasings require adding a tested resolver pattern before they can execute.
