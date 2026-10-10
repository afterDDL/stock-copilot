# Full A-Share Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bank-only runtime with a verified Shanghai/Shenzhen/Beijing A-share snapshot pipeline and a market-wide, deterministic screening experience.

**Architecture:** A refresh pipeline builds versioned snapshots from a verified security master and mutually exclusive iFinD query partitions, publishing only after code-set and field-coverage checks pass. The Next.js API reads the latest complete snapshot, while DeepSeek only edits a market-wide strategy and the browser runs the existing deterministic engine against that snapshot.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest, React Testing Library, Playwright, iFinD MCP JSON-RPC, versioned JSON snapshots.

**Spec:** `docs/superpowers/specs/2026-10-10-full-a-share-expansion-design.md`

## Global Constraints

- Market scope is listed ordinary A shares on SSE, SZSE and BSE; exclude B shares, funds, bonds, ETF, REIT and delisted securities.
- Executable fields remain industry, total market capitalization and attributable-net-profit year-on-year growth.
- Publish a new snapshot only when every partition's code set is complete; field-level missing values remain records and screen as unknown.
- A partial refresh must never replace the previous complete snapshot or fall back to the 42-bank fixture.
- DeepSeek parses intent but never chooses included stocks; TypeScript owns validation, screening, sorting, evidence and diffs.
- The primary UI uses plain user language: ask only for missing information or say that a requested indicator is not yet supported. Do not expose internal field names, schema names, partition jargon or long defensive explanations.
- Credentials remain server-only and must not appear in logs, fixtures, reports or client bundles.

## Review Focus

- A stock appears in two partitions: the refresh fails and does not publish a snapshot (Task 3 test).
- A company lacks the latest profit-growth value: the snapshot remains complete and the stock screens as unknown (Tasks 2 and 3 tests).
- A previous saved bank strategy is loaded after migration: it is upgraded to `market: 'cn_a'` without losing its bank condition (Task 5 test).
- A market-wide result contains thousands of exclusions: the UI renders one page at a time and remains operable (Task 6 test).
- iFinD returns HTTP 200 with content-level 429 or truncation text: the refresh retries within limits, then preserves the last complete snapshot (Tasks 3 and 4 tests).

---

### Task 1: Prove a Complete Partition Strategy

**Files:**
- Create: `docs/verification/2026-10-10-a-share-partition-probe.md`
- Create: `data/a-share/partitions.json`
- Modify: `PHASE0_REPORT.md`

**Interfaces:**
- Consumes: existing iFinD credentials through the installed iFinD skill wrapper; never reads or prints their value.
- Produces: `partitions.json` with `{ version, taxonomy, partitions: Array<{ id, label, queryScope, expectedCodes: string[] }> }` and an evidence report naming the successful query shape.

- [ ] **Step 1: Probe the narrow security-master query**

Call `search_stocks` for code, name, exchange/board and iFinD industry only. Record selected count, returned row count, truncation text, elapsed time and unique-code count in the verification report.

- [ ] **Step 2: Probe candidate partition families**

Try industry, exchange-plus-code-prefix and exchange-plus-board scopes with single-field narrow tables. Stop as soon as one family has mutually exclusive responses below the truncation limit and can be reconciled to the security master.

- [ ] **Step 3: Verify partition set equality**

Assert that each expected code appears exactly once, the union equals the master code set, and no returned code lies outside the target ordinary-A-share universe. Record exact counts by SSE, SZSE and BSE.

- [ ] **Step 4: Save the verified partition manifest**

Write only non-sensitive identifiers, query scopes and expected codes to `data/a-share/partitions.json`. If no candidate family is complete, document the failed evidence and stop implementation rather than presenting full-market support.

- [ ] **Step 5: Commit the evidence gate**

```bash
git add docs/verification/2026-10-10-a-share-partition-probe.md data/a-share/partitions.json PHASE0_REPORT.md
git commit -m "data: verify full A-share query partitions"
```

### Task 2: Generalize Domain Contracts and Deterministic Screening

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/domain/schema.ts`
- Modify: `src/lib/domain/schema.test.ts`
- Modify: `src/lib/engine/screen.ts`
- Modify: `src/lib/engine/screen.test.ts`
- Modify: `src/lib/engine/conflicts.ts`
- Modify: `src/lib/engine/conflicts.test.ts`
- Modify: `src/lib/engine/explain.ts`

**Interfaces:**
- Consumes: standard industry labels from Task 1's chosen taxonomy.
- Produces: `Market = 'cn_a'`, `Exchange = 'SSE' | 'SZSE' | 'BSE'`, `SnapshotStatus = 'complete' | 'partial'`, generalized `Strategy` and `DataSnapshot`, and unchanged `screenUniverse(snapshot, strategy): ScreeningResult`.

- [ ] **Step 1: Write failing schema tests**

Add tests named `accepts a market-wide strategy without an industry condition`, `accepts an optional standard industry condition`, `accepts a complete multi-exchange snapshot`, and `rejects inconsistent partition coverage`. Assert `market: 'cn_a'`, no forced bank condition, exchange totals, status and metric coverage.

- [ ] **Step 2: Run the domain tests and verify failure**

Run: `npm test -- src/lib/domain/schema.test.ts`

Expected: FAIL because `Strategy.industry` is bank-only and the snapshot lacks market coverage fields.

- [ ] **Step 3: Implement the generalized domain types and Zod schemas**

Add `market: 'cn_a'` to `Strategy`, remove the bank literal and required-bank-condition refinement, add `exchange` and `industryPath` to `StockRecord`, and add `status`, `scope`, `exchanges`, `partitions` and metric date distributions to `DataSnapshot`. Preserve the existing three-field whitelist.

- [ ] **Step 4: Write failing engine tests**

Add tests named `screens across industries when no industry condition exists`, `matches a normalized industry exactly`, `does not use substring industry matching`, and `classifies a missing metric as unknown`.

- [ ] **Step 5: Run the engine tests and verify failure**

Run: `npm test -- src/lib/engine/screen.test.ts src/lib/engine/conflicts.test.ts`

Expected: FAIL on the bank-specific prefix behavior and new cross-industry fixtures.

- [ ] **Step 6: Remove bank-specific evaluation and update conflicts/explanations**

Keep `screenUniverse(snapshot: DataSnapshot, strategy: Strategy): ScreeningResult`; compare standard industry labels by exact equality and keep numeric/date/missing semantics unchanged. Industry conflicts remain deterministic but no industry value is privileged.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- src/lib/domain src/lib/engine`

Expected: PASS.

```bash
git add src/lib/domain src/lib/engine
git commit -m "refactor: generalize screening domain to all A shares"
```

### Task 3: Build the Partitioned iFinD Snapshot Pipeline

**Files:**
- Create: `src/lib/ifind/a-shares.ts`
- Create: `src/lib/ifind/a-shares.test.ts`
- Create: `src/lib/ifind/partitions.ts`
- Create: `src/lib/ifind/partitions.test.ts`
- Create: `src/lib/ifind/refresh.ts`
- Create: `src/lib/ifind/refresh.test.ts`
- Modify: `src/lib/ifind/client.ts`
- Modify: `src/lib/ifind/client.test.ts`
- Reuse: `src/lib/ifind/markdown.ts`

**Interfaces:**
- Consumes: `data/a-share/partitions.json` and `IfindMcpClient.callTool(name, args)`.
- Produces: `normalizePartition(input: PartitionTables, definition: PartitionDefinition): NormalizedPartition`, `mergePartitions(partitions: NormalizedPartition[], manifest: PartitionManifest): DataSnapshot`, and `refreshAshareSnapshot(options: RefreshOptions): Promise<RefreshBuild>`.

- [ ] **Step 1: Write failing partition-normalization tests**

Cover one valid non-bank partition plus duplicate code, out-of-partition code, identity mismatch, missing field, duplicate metric column, invalid date, empty content and truncation content. Missing metric values must produce `coverage: 'missing'` rather than dropping the stock.

- [ ] **Step 2: Run normalization tests and verify failure**

Run: `npm test -- src/lib/ifind/a-shares.test.ts src/lib/ifind/partitions.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement partition loading and normalization**

Parse the existing Markdown tables, normalize units and dates, validate codes against `expectedCodes`, and return partition evidence without bank names, count 42 or fixed 2026 dates.

- [ ] **Step 4: Write failing merge and refresh tests**

Add tests named `publishes when partitions form an exact cover`, `fails when a code occurs in two partitions`, `fails when a partition omits a stock row`, `keeps stocks with missing metrics`, and `does not publish after exhausted content-level 429 retries`.

- [ ] **Step 5: Run refresh tests and verify failure**

Run: `npm test -- src/lib/ifind/refresh.test.ts src/lib/ifind/client.test.ts`

Expected: FAIL because refresh orchestration and bounded exponential retry are absent.

- [ ] **Step 6: Implement merge, queue and retry behavior**

Use a one-request-per-second default queue. Change `IfindMcpClient` to accept `{ maxAttempts, baseRetryMs }`, recognize HTTP/content-level 429 and truncation, and retry with bounded exponential delays. `mergePartitions` must reject overlaps, omissions and unexpected codes before producing `status: 'complete'`.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- src/lib/ifind`

Expected: PASS.

```bash
git add src/lib/ifind
git commit -m "feat: add partitioned A-share snapshot pipeline"
```

### Task 4: Add Atomic Snapshot Storage and General API

**Files:**
- Create: `src/lib/snapshots/store.ts`
- Create: `src/lib/snapshots/store.test.ts`
- Create: `scripts/refresh-a-share-snapshot.ts`
- Create: `src/app/api/stock-snapshot/route.ts`
- Create: `src/app/api/stock-snapshot/route.test.ts`
- Modify: `package.json`
- Keep for regression only: `src/app/api/bank-snapshot/route.ts`

**Interfaces:**
- Consumes: `RefreshBuild` from Task 3.
- Produces: `SnapshotStore.readLatestComplete(): Promise<StoredSnapshot | null>`, `SnapshotStore.publish(build: RefreshBuild): Promise<void>`, the `npm run refresh:data` command, and `GET /api/stock-snapshot?industry=<standard-label>`.

- [ ] **Step 1: Write failing store tests**

Test atomic publish, refusal to publish `partial`, preservation of the previous complete snapshot after a failed build, and reading a snapshot with a stale-data flag.

- [ ] **Step 2: Run store tests and verify failure**

Run: `npm test -- src/lib/snapshots/store.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the filesystem snapshot store and refresh command**

Write versioned files beneath `data/a-share/snapshots/<snapshotId>/`, update `data/a-share/latest.json` only after validation, and ensure temporary files never become current. The CLI prints counts and elapsed time but never credentials or raw headers.

- [ ] **Step 4: Write failing API tests**

Test a complete market response, standard-industry slicing, previous-complete fallback, `503` when no complete snapshot exists, and public errors that omit upstream payloads and internal field names.

- [ ] **Step 5: Run API tests and verify failure**

Run: `npm test -- src/app/api/stock-snapshot/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Implement the API route**

Return `{ mode, stale, snapshot, coverage, evidence }` from the last complete snapshot. Reject an unknown industry with a short user-facing message. Never load `data/bank-snapshot.json` as fallback.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- src/lib/snapshots src/app/api/stock-snapshot`

Expected: PASS.

```bash
git add src/lib/snapshots scripts/refresh-a-share-snapshot.ts src/app/api/stock-snapshot package.json
git commit -m "feat: publish and serve verified A-share snapshots"
```

### Task 5: Generalize Intent Parsing, Mapping and Saved Strategies

**Files:**
- Modify: `src/lib/ai/prompt.ts`
- Modify: `src/lib/ai/intent-schema.ts`
- Modify: `src/lib/ai/intent-schema.test.ts`
- Modify: `src/lib/mapping/registry.ts`
- Modify: `src/lib/mapping/resolver.ts`
- Modify: `src/lib/mapping/resolver.test.ts`
- Modify: `src/data/mapping/industry_profiles.json`
- Modify: `src/data/mapping/metric_registry.json`
- Create: `src/data/mapping/industry_aliases.json`
- Modify: `src/lib/storage/strategies.ts`
- Modify: `src/lib/storage/strategies.test.ts`

**Interfaces:**
- Consumes: standard industry labels from Task 1 and generalized `Strategy` from Task 2.
- Produces: `resolveIndustry(expression: string): { status: 'matched' | 'ambiguous' | 'unknown'; value?: string; options?: string[] }` and migration of saved bank strategies to market-wide strategies retaining `industry = 银行`.

- [ ] **Step 1: Write failing intent and resolver tests**

Cover default market-wide intent, explicit bank, semiconductor and liquor industries, deletion/replacement of industry, ambiguous industry, unsupported metric copy, and a query with no industry. Assert that user-facing reasons say `暂不支持“<表达>”指标查询。` and do not expose `market_cap_cny` or `net_profit_parent_yoy_pct`.

- [ ] **Step 2: Run intent tests and verify failure**

Run: `npm test -- src/lib/ai/intent-schema.test.ts src/lib/mapping/resolver.test.ts`

Expected: FAIL because the parser forces bank scope.

- [ ] **Step 3: Implement optional industry intent and local alias resolution**

Remove the automatic bank condition and bank-only rejection. Keep the strict three-field schema, resolve model-proposed industry strings locally, ask one concise clarification when ambiguous, and keep unsupported metrics blocked with plain-language copy.

- [ ] **Step 4: Write failing saved-strategy migration test**

Assert that a legacy `{ industry: 'bank' }` strategy loads as `{ market: 'cn_a' }` with one `industry = 银行` condition, while new market-wide strategies round-trip unchanged.

- [ ] **Step 5: Implement storage migration and update mapping assets**

Add a versioned migration in `StrategyStorage.load`; mark the three current metrics as `cn_a` only after Task 3 cross-industry fixtures pass. Keep bank-only candidate metrics industry-scoped.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- src/lib/ai src/lib/mapping src/lib/storage`

Expected: PASS.

```bash
git add src/lib/ai src/lib/mapping src/lib/storage src/data/mapping
git commit -m "feat: support market-wide intent and industry selection"
```

### Task 6: Switch the Workspace to the Full-Market Experience

**Files:**
- Modify: `src/hooks/use-copilot.ts`
- Modify: `src/hooks/use-copilot.test.tsx`
- Modify: `src/components/copilot-workspace.tsx`
- Modify: `src/components/copilot-workspace.test.tsx`
- Modify: `src/components/chat-panel.tsx`
- Modify: `src/components/strategy-editor.tsx`
- Modify: `src/components/results-workspace.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `GET /api/stock-snapshot`, generalized strategies and complete/stale snapshot evidence.
- Produces: full-market copy, optional industry editing, concise errors, coverage summary and paginated result tables.

- [ ] **Step 1: Write failing workspace tests for copy and errors**

Assert the initial UI contains `沪深北 A 股`, no product-scope occurrence of `银行股`, the example `找市值较大、利润仍在增长的股票，增长更快的优先。`, concise clarification prompts, and `暂不支持“股息率”指标查询。` without internal field names or schema terminology.

- [ ] **Step 2: Write failing hook tests for the new endpoint and optional industry**

Assert `/api/stock-snapshot` is requested, a no-industry strategy runs, an industry condition can be added/removed, and `503` maps to `当前数据正在更新，请稍后再试。`.

- [ ] **Step 3: Run workspace tests and verify failure**

Run: `npm test -- src/hooks/use-copilot.test.tsx src/components/copilot-workspace.test.tsx`

Expected: FAIL on bank copy, endpoint and forced industry.

- [ ] **Step 4: Implement the workspace switch and progressive disclosure**

Use `沪深北 A 股` as the product scope, show only a short data date/source/availability summary by default, and keep technical coverage detail in the existing expandable details element. Remove defensive paragraphs and raw field identifiers from visible copy.

- [ ] **Step 5: Write failing pagination test**

Render 250 excluded fixtures, assert only the first 50 rows are in the DOM, navigate to page 2, and assert rows 51–100 replace them while counts and evidence selection remain correct.

- [ ] **Step 6: Implement result pagination**

Keep page size at 50, reset to page 1 when the tab or result snapshot changes, and preserve comparison/evidence behavior for visible rows.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- src/hooks src/components`

Expected: PASS.

```bash
git add src/hooks src/components src/app/layout.tsx src/app/globals.css
git commit -m "feat: present a concise full-market screening workspace"
```

### Task 7: Generate and Validate the First Full A-Share Snapshot

**Files:**
- Create: `data/a-share/snapshots/<generated-snapshot-id>/snapshot.json`
- Create: `data/a-share/snapshots/<generated-snapshot-id>/manifest.json`
- Create: `data/a-share/latest.json`
- Create: `docs/verification/2026-10-10-a-share-snapshot.md`

**Interfaces:**
- Consumes: `npm run refresh:data` from Task 4 and the verified partition manifest.
- Produces: the first complete snapshot consumed by `/api/stock-snapshot`.

- [ ] **Step 1: Run the real refresh**

Run: `npm run refresh:data`

Expected: exit `0`; printed summary includes exact SSE/SZSE/BSE counts, zero partition omissions/duplicates/truncations, field availability and elapsed time.

- [ ] **Step 2: Independently validate the generated manifest**

Run a read-only validation command that parses both JSON files with `dataSnapshotSchema`, recomputes code uniqueness, partition union/intersection, exchange totals and field coverage, and compares them with the manifest.

Expected: every equality check passes and no credentials or request headers are present.

- [ ] **Step 3: Record real-data evidence**

Document request count, retries, elapsed time, snapshot date, security counts, field coverage, date distributions and any missing values. Do not paste raw authorization or upstream session identifiers.

- [ ] **Step 4: Run two non-bank smoke strategies**

Use at least two distinct standard industries and one market-wide threshold. Confirm results reference real snapshot values and that missing metrics appear under “无法判定”.

- [ ] **Step 5: Commit generated evidence and snapshot**

```bash
git add data/a-share docs/verification/2026-10-10-a-share-snapshot.md
git commit -m "data: add verified full A-share snapshot"
```

### Task 8: End-to-End Verification and Documentation

**Files:**
- Modify: `e2e/main-flow.spec.ts`
- Modify: `README.md`
- Modify: `TEST_REPORT.md`
- Modify: `AI_DEV_LOG.md`
- Modify: `DEPLOYMENT.md`
- Modify: `NEXT_STEPS.md`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: verified local product and accurate handoff documentation.

- [ ] **Step 1: Update E2E acceptance tests**

Cover market-wide fuzzy intent, explicit non-bank industry, concise unsupported-indicator feedback, complete snapshot status, threshold edit and diff, evidence, comparison, strategy save/reopen and pagination.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e -- --workers=1
```

Expected: every command exits `0`.

- [ ] **Step 3: Perform live API smoke tests**

Call DeepSeek once for a market-wide query and iFinD-backed snapshot once through the server. Record HTTP status, business status and elapsed time without logging secrets.

- [ ] **Step 4: Perform browser visual and interaction QA**

Verify desktop and narrow viewport layouts, result pagination, data details, keyboard focus, dialogs and that the primary UI contains no bank-only positioning or raw internal field names.

- [ ] **Step 5: Update documentation with measured results**

Describe the actual snapshot scope, refresh command, verified fields, data dates, field coverage, local start command, remaining cloud MCP uncertainty and unsupported indicators. Replace bank-only product positioning while retaining the bank regression history.

- [ ] **Step 6: Commit the final handoff**

```bash
git add e2e README.md TEST_REPORT.md AI_DEV_LOG.md DEPLOYMENT.md NEXT_STEPS.md
git commit -m "docs: hand off full A-share screening MVP"
```
