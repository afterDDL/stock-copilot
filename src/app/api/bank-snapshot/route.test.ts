import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import * as banks from '../../../lib/ifind/banks';
import { IfindError } from '../../../lib/ifind/errors';

afterEach(() => vi.restoreAllMocks());

describe('GET /api/bank-snapshot', () => {
  it('serves the credential-free historical snapshot with mode and evidence', async () => {
    const response = await GET(new Request('http://localhost/api/bank-snapshot?mode=historical'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.mode).toBe('historical');
    expect(body.snapshot.source).toBe('historical');
    expect(body.snapshot.stocks).toHaveLength(42);
    expect(body.coverage).toEqual(body.snapshot.coverage);
    expect(body.evidence).toMatchObject({
      source: 'iFinD MCP search_stocks controlled single-indicator queries',
      statisticDates: { marketCap: '2026-10-09', netProfitYoy: '2026-06-30' },
      liveRequests: 2,
    });
    expect(new Date(body.evidence.capturedAt).toISOString()).toBe(body.evidence.capturedAt);
    expect(JSON.stringify(body)).not.toMatch(/eyJraWQi|auth.?token/i);
  });

  it('falls back to an explicit historical response with sanitized live failure details', async () => {
    vi.spyOn(banks, 'fetchBankSnapshotWithEvidence').mockRejectedValue(
      new IfindError('upstream internal payload must not be exposed', 'upstream_error', true),
    );

    const response = await GET(new Request('http://localhost/api/bank-snapshot?mode=live'));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.mode).toBe('historical');
    expect(body.snapshot.source).toBe('historical');
    expect(body.snapshot.stocks).toHaveLength(42);
    expect(body.error).toMatchObject({
      code: 'upstream_error',
      message: 'Live iFinD snapshot unavailable; serving historical data.',
      retryable: true,
    });
    expect(serialized).not.toContain('upstream internal payload');
    expect(serialized).not.toMatch(/authorization|bearer|auth.?token/i);
  });
});
