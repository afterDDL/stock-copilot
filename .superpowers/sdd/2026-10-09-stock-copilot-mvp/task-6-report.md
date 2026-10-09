# Task 6 — Financial mapping resolver and research insights

## Delivered

- Added four independent mapping assets: `concepts.json`, `industry_profiles.json`, `metric_registry.json`, and the 20-case `intent_eval.jsonl`. The bank profile is the only enabled industry profile. Only `industry`, `market_cap_cny`, and `net_profit_parent_yoy_pct` are verified and executable; valuation, stability, leadership and other candidate metrics remain explicitly non-executable.
- Added the local registry, intent resolver and evaluator. The resolver retains original expressions and mapping provenance, distinguishes confirmed/assumed/needs-clarification/unsupported states, allows only registered metrics to execute, and never substitutes an unrelated metric. Local patches cover market-cap threshold updates, profit-condition deletion, profit-growth descending preference and previous-strategy restoration. Vague “再严格一点” asks which condition to tighten.
- Added deterministic snapshot-only market-cap distribution, peer ranking/percentiles, threshold boundary lists and research insights for limiting conditions, removed companies that still show positive profit growth, and possible comparisons. The UI separates condition match, preference sorting and research assistance, shows mapping provenance, and carries the disclaimer “条件匹配和排序不等于投资价值判断”. No investment score or recommendation is generated.
- Added the exact DeepSeek/browser regression: “帮我找些盘子大、业绩还在增长的银行股，利润增长越快越好。” The language residual detector consumes “些”, “业绩还在增长” and “利润增长越快越好”; resolver maps the verified bank scope, 1000亿元 editable bank preset, positive parent-net-profit growth condition, and descending profit-growth preference without falsely reporting supported wording as unsupported.

## Evaluation and snapshot

The JSONL evaluation suite contains all 20 named core cases and checks concepts, condition/preference distinction, direction, mapping state, local action, and conflict/patch behavior. The final suite passes 20/20. Snapshot research uses the bundled bank snapshot only (42 securities): market cap ranges from ¥9.45bn to ¥2.775tn, median ¥82.11bn; 20 securities meet the default ¥100bn threshold. The default is a product preset, not an industry standard. Results and ranks are not extrapolated beyond that snapshot.

## Verification

- TDD regression for preserving an explicit verified market-cap condition alongside unsupported “股价低一些”: observed RED (condition was deleted), made the smallest resolver change, then GREEN.
- Focused resolver regression: 12/12 passed.
- Full test suite: 17 files, 124 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed on Next.js 16.4.0.

## Scope notes

Only the bank profile and the three verified/executable metrics are enabled. PB/PE, ROE, stability/risk, leadership and other candidate concepts are not executable and cannot enable screening. Research descriptions are based on observed snapshot data and do not make investment recommendations.
