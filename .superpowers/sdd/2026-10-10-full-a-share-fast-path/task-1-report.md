# Task 1 Report: Generalize Strategy, Intent and Storage

## Result

- `Strategy` now carries `market: 'cn_a'`; an industry condition is optional and accepts arbitrary non-empty strings.
- Industry equality is exact. Industry expressions only lose a trailing `行业`, `板块`, or `股` suffix.
- Intent parsing supports adding, replacing, and removing industry filters, and leaves new all-market strategies free of an implicit bank condition.
- Saved legacy bank strategies migrate to the new market contract while retaining their explicit `银行` condition.
- The supported field whitelist remains exactly `industry`, `market_cap_cny`, and `net_profit_parent_yoy_pct`.
- Unsupported intent reasons use concise user-facing wording and map internal field identifiers to readable labels.

## Verification

- Required focused command: `npm test -- src/lib/domain src/lib/engine/screen.test.ts src/lib/ai src/lib/mapping/resolver.test.ts src/lib/storage` — 5 files, 94 tests passed.
- Full suite: `npm test` — 17 files, 140 tests passed.
- `npm run typecheck` — passed.
- `git diff --check` — passed.
- TDD red run confirmed the new schema, industry matching, intent, and legacy migration tests failed against the previous implementation before production changes.

## Scope extensions

The following files were updated beyond the brief to keep `Strategy` construction and dependent checks aligned with the new contract:

- `src/app/api/intent/route.test.ts`, `src/components/copilot-workspace.test.tsx`, `src/hooks/use-copilot.test.tsx`, and `src/lib/engine/conflicts.test.ts`: updated bank fixtures to use `market: 'cn_a'` while retaining their explicit bank condition.
- `src/lib/mapping/eval.ts`: updated its generated strategy fixture to the new market field.
- `src/lib/research/insights.test.ts`: updated the strategy fixture and replaced the old hierarchical-prefix expectation with the exact-match behavior.

## Integration concern

`src/hooks/use-copilot.ts` still wraps each unsupported reason in its existing UI prefix. The resolver output itself is concise and contains no internal field identifiers, but the final rendered sentence may be redundant until the UI-copy task updates that formatter.
