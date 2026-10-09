import { describe, expect, it } from 'vitest';
import { GET } from './route';

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
});
