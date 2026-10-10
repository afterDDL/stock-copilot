# Task 2 Report: Controlled A-share Search and API

## Delivered

- Added `buildSearchQueries` and `fetchAshareCandidates` in `src/lib/ifind/a-share-search.ts`. Each call issues two sequential `search_stocks` requests with the same serialized industry and financial hard conditions, requesting one financial indicator per Markdown table.
- Enforced strict four-column table shape, valid metric dates and units, unique six-digit stock codes, matching code sets, and matching name/industry identity across queries. Truncation, duplicate rows, over-100 results, and code-set mismatches become `needs_narrowing`; metric placeholders and blank numeric cells remain present with `coverage: missing`.
- Added `POST /api/stock-search`, strategy validation, the exact narrowing and unavailable messages, and sanitized upstream errors.
- Extended Markdown parsing only for this adapter's valid empty tables and blank metric cells. Existing strict behavior remains the default.

## TDD and verification

- Ran `npm test -- src/lib/ifind/a-share-search.test.ts` before implementation; it failed because the requested adapter module did not exist.
- Ran `npm test -- src/app/api/stock-search/route.test.ts` before route implementation; it failed because the route module did not exist.
- Final `npm test -- src/lib/ifind src/app/api/stock-search`: **5 test files passed, 29 tests passed**.
- Final `npm run typecheck`: passed.
- `git diff --check`: passed.

## Limitation

The service has no paging contract. A result that parses and stays within 100 rows is treated as the complete returned candidate set for this query; it does not prove exhaustive coverage of every A-share security. Detected truncation or over-limit results return a narrowing response without partial candidates.
