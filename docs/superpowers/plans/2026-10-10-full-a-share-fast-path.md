# Full A-Share Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real iFinD-backed A-share screening experience quickly by querying bounded candidate sets and verifying every returned stock locally.

**Architecture:** Strategies target `cn_a` with an optional industry. A new server endpoint converts the strategy into two controlled single-indicator iFinD searches, rejects truncated or mismatched results, merges candidates, then returns a query-scoped snapshot for the existing deterministic engine.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest, React Testing Library, Playwright, iFinD MCP JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-10-10-full-a-share-fast-path-addendum.md`

## Global Constraints

- Real results must come from iFinD; do not use the bank fixture as a full-market fallback.
- Keep the executable whitelist to industry, total market capitalization and attributable-net-profit year-on-year growth.
- Reject rather than display any truncated, over-100, code-mismatched or unparseable response.
- DeepSeek parses intent; TypeScript validates, screens, sorts, explains and diffs.
- Primary UI copy stays concise and contains no internal field names or engineering terminology.
- Never log or commit credentials, authorization headers or session identifiers.

## Review Focus

- One iFinD table is truncated while the other is not: API returns `needs_narrowing`, not partial candidates (Task 2).
- The two query tables return different code sets: API rejects the result (Task 2).
- A request omits industry: intent remains market-wide and executable (Task 1).
- A legacy saved bank strategy loads with its bank condition intact (Task 1).
- A broad query fails: the composer keeps the user's draft and shows only the concise narrowing prompt (Task 3).

---

### Task 1: Generalize Strategy, Intent and Storage

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/domain/schema.ts`
- Modify: `src/lib/domain/schema.test.ts`
- Modify: `src/lib/engine/screen.ts`
- Modify: `src/lib/engine/screen.test.ts`
- Modify: `src/lib/ai/prompt.ts`
- Modify: `src/lib/ai/intent-schema.ts`
- Modify: `src/lib/ai/intent-schema.test.ts`
- Modify: `src/lib/mapping/resolver.ts`
- Modify: `src/lib/mapping/resolver.test.ts`
- Modify: `src/lib/storage/strategies.ts`
- Modify: `src/lib/storage/strategies.test.ts`

**Interfaces:**
- Produces: `Strategy.market: 'cn_a'`, optional `industry` condition, exact industry matching, and legacy strategy migration.

- [ ] Write failing tests for market-wide strategy without industry, arbitrary industry, exact industry matching, industry removal/replacement, concise unsupported copy and legacy saved-bank migration.
- [ ] Run `npm test -- src/lib/domain src/lib/engine/screen.test.ts src/lib/ai src/lib/mapping/resolver.test.ts src/lib/storage` and confirm the bank constraints fail.
- [ ] Implement the generalized contracts and parsers. Normalize industry expressions by stripping only `行业`, `板块`, `股` suffixes; do not invent a finite industry whitelist.
- [ ] Re-run the focused tests and commit with `feat: generalize strategies to all A shares`.

### Task 2: Add Controlled Candidate Search and API

**Files:**
- Create: `src/lib/ifind/a-share-search.ts`
- Create: `src/lib/ifind/a-share-search.test.ts`
- Create: `src/app/api/stock-search/route.ts`
- Create: `src/app/api/stock-search/route.test.ts`
- Modify: `src/lib/ifind/errors.ts`

**Interfaces:**
- Consumes: validated `Strategy` and `IfindMcpClient.callTool`.
- Produces: `buildSearchQueries(strategy: Strategy): [string, string]`, `fetchAshareCandidates(strategy: Strategy, client?: IfindMcpClient): Promise<QuerySnapshotAcquisition>`, and `POST /api/stock-search`.

- [ ] Write failing adapter tests for valid non-bank results, empty results, truncation, over 100 rows, duplicate codes, mismatched code sets, wrong columns, identity mismatch, units, dates and missing numeric values.
- [ ] Run `npm test -- src/lib/ifind/a-share-search.test.ts` and confirm failure.
- [ ] Implement two controlled single-indicator queries with identical hard conditions, strict Markdown parsing and code-set merge. The query includes optional industry, market-cap and profit-growth conditions and requests code, name and iFinD industry.
- [ ] Write failing route tests for success, invalid strategy, `needs_narrowing`, upstream failure and sanitized errors.
- [ ] Implement `POST /api/stock-search`; return `422` with `结果较多，请补充行业或提高筛选门槛。` for truncation/over-limit/mismatch and `503` with `数据暂时不可用，请稍后重试。` for upstream failures.
- [ ] Run `npm test -- src/lib/ifind src/app/api/stock-search` and commit with `feat: search and verify A-share candidates`.

### Task 3: Switch the Workspace to Full-Market Search

**Files:**
- Modify: `src/hooks/use-copilot.ts`
- Modify: `src/hooks/use-copilot.test.tsx`
- Modify: `src/components/copilot-workspace.tsx`
- Modify: `src/components/copilot-workspace.test.tsx`
- Modify: `src/components/chat-panel.tsx`
- Modify: `src/components/results-workspace.tsx`
- Modify: `src/components/strategy-editor.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `POST /api/stock-search` and generalized strategy.
- Produces: full-market copy, re-query on each run, concise errors and cross-query result diffs.

- [ ] Write failing hook/component tests for the new endpoint, no-industry strategy, adding/removing industry, preserved draft on failure, concise unsupported/narrowing errors and absence of bank-only product copy.
- [ ] Run `npm test -- src/hooks/use-copilot.test.tsx src/components/copilot-workspace.test.tsx` and confirm failure.
- [ ] Replace snapshot GET with strategy POST on every execution. Preserve prior successful result, compute code-set diff after successful reruns, and keep failed queries from replacing the visible result.
- [ ] Change visible copy to `沪深北 A 股`, `描述你想找的股票`, the example `找市值较大、利润仍在增长的股票，增长更快的优先。`, and generic stock counts. Keep the non-exhaustive boundary only in expandable data details.
- [ ] Re-run focused tests and commit with `feat: add full-market screening experience`.

### Task 4: Real Smoke Tests, E2E and Handoff

**Files:**
- Modify: `e2e/main-flow.spec.ts`
- Modify: `README.md`
- Modify: `TEST_REPORT.md`
- Modify: `AI_DEV_LOG.md`
- Modify: `NEXT_STEPS.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified local MVP and accurate limitations.

- [ ] Run real iFinD requests for at least two non-bank industries and one bounded market-wide strategy; record HTTP/business status, row counts and elapsed time without credentials.
- [ ] Add E2E coverage for market-wide intent, explicit non-bank industry, threshold edit/diff, evidence, comparison, save/reopen and concise broad-query handling.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e -- --workers=1`; all must exit 0.
- [ ] Inspect desktop and narrow layouts in the browser, then update documentation with measured results and the non-exhaustive candidate-search boundary.
- [ ] Commit with `docs: hand off A-share candidate screening MVP`.
