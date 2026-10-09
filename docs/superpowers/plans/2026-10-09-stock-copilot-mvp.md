# 选股 coPilot Web MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable Web MVP that turns fuzzy Chinese bank-stock intent into an editable, validated strategy and a traceable, deterministic basket from real iFinD data.

**Architecture:** Next.js App Router provides server-only DeepSeek and iFinD endpoints. Shared TypeScript domain modules validate strategies, detect conflicts, screen and sort a normalized bank snapshot, explain evidence, and compute strategy diffs; the browser composes these into a ChatGPT-style research workspace.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, Zod, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-stock-copilot-mvp-design.md`

## Global Constraints

- Product name is exactly `选股 coPilot`.
- UI follows ChatGPT's restrained visual language; no decorative market widgets or fake controls.
- P0 support is limited to A-share banks, total market cap, and 2026 interim parent net-profit YoY.
- DeepSeek never decides stock inclusion; TypeScript deterministic code owns conflicts, screening, sorting, diffs and evidence.
- Live data comes from two controlled iFinD `search_stocks` single-indicator queries joined by stock code.
- A historical real snapshot may be used only as an explicit, dated fallback.
- `DEEPSEEK_API_KEY` and `IFIND_MCP_AUTH_TOKEN` are server-only environment variables and never appear in Git, logs or client bundles.
- No Vercel deployment is required in this plan.
- Every production behavior is implemented test-first and all externally sourced payloads are validated.

## Review Focus

- JSON-RPC HTTP 200 containing a content-layer 429 must retry/fail, never appear as success.
- Wrong or truncated Markdown columns must fail coverage validation rather than silently screen a partial universe.
- A missing metric must become `unknown`, not an ordinary exclusion.
- Editing the market-cap threshold on one snapshot must attribute 4 removals to strategy change, not data change.
- Unsupported metrics or deterministic return predictions must block execution with a useful explanation.

---

### Task 1: Application Foundation and Deterministic Domain Engine

**Files:**
- Create: `package.json`, Next.js/Tailwind/Vitest/Playwright configuration, `src/app/layout.tsx`, `src/app/globals.css`
- Create: `src/lib/domain/types.ts`, `src/lib/domain/schema.ts`
- Create: `src/lib/engine/conflicts.ts`, `src/lib/engine/screen.ts`, `src/lib/engine/diff.ts`, `src/lib/engine/explain.ts`
- Test: `src/lib/engine/*.test.ts`, `src/lib/domain/schema.test.ts`

**Interfaces:**
- Produces: `Strategy`, `Condition`, `StockRecord`, `DataSnapshot`, `ScreeningResult`, `detectConflicts(strategy)`, `screenUniverse(snapshot, strategy)`, `diffResults(previous, next)`.

- [ ] Write failing tests for whitelist validation, range/equality conflicts, missing-value classification, deterministic sorting, 16→12 threshold behavior fixture and 4-stock Diff.
- [ ] Run focused Vitest tests and verify they fail because modules do not exist.
- [ ] Scaffold Next.js and implement the minimal typed domain engine.
- [ ] Run focused tests and the full suite; verify green.
- [ ] Commit foundation and engine.

### Task 2: iFinD MCP Adapter and Real Snapshot

**Files:**
- Create: `src/lib/ifind/client.ts`, `src/lib/ifind/markdown.ts`, `src/lib/ifind/banks.ts`, `src/lib/ifind/errors.ts`
- Create: `src/app/api/bank-snapshot/route.ts`, `data/bank-snapshot.json`
- Test: `src/lib/ifind/*.test.ts`, `src/app/api/bank-snapshot/route.test.ts`

**Interfaces:**
- Consumes: `StockRecord`, `DataSnapshot`.
- Produces: `fetchBankSnapshot(): Promise<DataSnapshot>` and a GET endpoint with `mode`, coverage, evidence and safe error details.

- [ ] Write failing fixture-driven tests for table parsing, date-column mapping, duplicate/missing rows, empty/truncated content and content-layer 429 retry.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement environment-based JSON-RPC client, controlled queries, strict parser/merge and historical fallback.
- [ ] Execute one real MCP acquisition, save the normalized credential-free 42-stock snapshot, and verify the 16/12/4 invariants.
- [ ] Run adapter and full suites; commit.

### Task 3: DeepSeek Structured Intent and Strategy Modification

**Files:**
- Create: `src/lib/ai/intent-schema.ts`, `src/lib/ai/deepseek.ts`, `src/lib/ai/prompt.ts`
- Create: `src/app/api/intent/route.ts`
- Test: `src/lib/ai/*.test.ts`, `src/app/api/intent/route.test.ts`

**Interfaces:**
- Consumes: raw Chinese query and optional current `Strategy`.
- Produces: validated `IntentResponse` containing strategy, assumptions, clarifications and unsupported requests.

- [ ] Write failing tests for fuzzy default, current-strategy partial edits, unsupported indicator rejection, deterministic-return forecast rejection, empty/truncated/schema-invalid model outputs.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement strict Responses API schema, prompt, server adapter and route with server-only key access.
- [ ] Run a real `deepseek-flash` smoke request and record sanitized evidence.
- [ ] Run focused and full suites; commit.

### Task 4: ChatGPT-Style Research Workspace

**Files:**
- Create/modify: `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/components/chat-panel.tsx`, `strategy-editor.tsx`, `conflict-panel.tsx`, `results-workspace.tsx`, `stock-evidence.tsx`, `strategy-diff.tsx`, `stock-compare.tsx`, `saved-strategies.tsx`
- Create: `src/hooks/use-copilot.ts`, `src/lib/storage/strategies.ts`
- Test: component and hook tests adjacent to implementation.

**Interfaces:**
- Consumes: `/api/intent`, `/api/bank-snapshot`, deterministic engine.
- Produces: complete user-visible P0 flow with no inert buttons.

- [ ] Write failing interaction tests for intent submission, editable AI default, clarification, conflict blocking/fix, included/excluded/unknown views, evidence, Diff, compare and local save/restore.
- [ ] Run component tests and verify expected failures.
- [ ] Implement responsive ChatGPT-style workspace and interactions using focused components.
- [ ] Run component, accessibility smoke and full suites; commit.

### Task 5: End-to-End Acceptance, Hardening and Delivery Docs

**Files:**
- Create: `e2e/main-flow.spec.ts`, `.env.example`, `README.md`, `TEST_REPORT.md`, `AI_DEV_LOG.md`, `DEPLOYMENT.md`, `NEXT_STEPS.md`
- Modify: production/test code only for defects reproduced by new failing tests.

**Interfaces:**
- Produces: runnable documented product and evidence-backed acceptance report.

- [ ] Write Playwright tests for the complete 1000→2000 billion flow, conflict repair, evidence, 南京银行 exclusion, sorting, two-stock comparison and save/reopen.
- [ ] Run unit/integration/build/lint/e2e and capture exact results.
- [ ] Manually run real DeepSeek and iFinD paths; verify live/fallback labels and safe failure handling.
- [ ] Fix each discovered defect with a failing regression test first; re-run the complete suite.
- [ ] Write the five required delivery documents with passed/failed/unverified distinctions, startup command and `http://localhost:3000`.
- [ ] Commit the verified delivery.
