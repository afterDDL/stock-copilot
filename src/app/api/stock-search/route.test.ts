import { afterEach, describe, expect, it, vi } from 'vitest';
import { AshareSearchError, IfindError } from '../../../lib/ifind/errors';
import { fetchAshareCandidates } from '../../../lib/ifind/a-share-search';
import { POST } from './route';

vi.mock('../../../lib/ifind/a-share-search', () => ({ fetchAshareCandidates: vi.fn() }));

const strategy = {
  id: 'all-a', version: 1, name: '沪深北 A 股', market: 'cn_a',
  conditions: [{ field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '利润增长', aiInferred: false, editable: true }],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};
const acquisition = {
  snapshot: { snapshotId: 'live', source: 'live', asOf: '2026-10-10', stocks: [], coverage: { expectedStocks: 0, returnedStocks: 0, complete: true, metrics: { industry: { available: 0, missing: 0 }, market_cap_cny: { available: 0, missing: 0 }, net_profit_parent_yoy_pct: { available: 0, missing: 0 } } } },
  evidence: { source: 'iFinD MCP', capturedAt: '2026-10-10T00:00:00.000Z', statisticDates: { marketCap: null, netProfitYoy: '2026-06-30' }, liveRequests: 2 },
};

afterEach(() => vi.mocked(fetchAshareCandidates).mockReset());

describe('POST /api/stock-search', () => {
  it('returns the live candidate snapshot for a valid strategy', async () => {
    vi.mocked(fetchAshareCandidates).mockResolvedValue(acquisition as never);
    const response = await POST(new Request('http://localhost/api/stock-search', { method: 'POST', body: JSON.stringify({ strategy }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mode: 'live', snapshot: acquisition.snapshot, evidence: acquisition.evidence });
    expect(fetchAshareCandidates).toHaveBeenCalledWith(strategy);
  });

  it('rejects invalid strategies before querying iFinD', async () => {
    const response = await POST(new Request('http://localhost/api/stock-search', { method: 'POST', body: JSON.stringify({ strategy: { ...strategy, market: 'us' } }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_strategy');
    expect(fetchAshareCandidates).not.toHaveBeenCalled();
  });

  it('returns the concise needs_narrowing response for incomplete candidate coverage', async () => {
    vi.mocked(fetchAshareCandidates).mockRejectedValue(new AshareSearchError());
    const response = await POST(new Request('http://localhost/api/stock-search', { method: 'POST', body: JSON.stringify({ strategy }) }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: 'needs_narrowing', message: '结果较多，请补充行业或提高筛选门槛。' } });
  });

  it('sanitizes upstream errors and returns the service-unavailable copy', async () => {
    vi.mocked(fetchAshareCandidates).mockRejectedValue(new IfindError('upstream secret payload', 'upstream_unavailable'));
    const response = await POST(new Request('http://localhost/api/stock-search', { method: 'POST', body: JSON.stringify({ strategy }) }));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('数据暂时不可用，请稍后重试。');
    expect(body).not.toContain('upstream secret payload');
  });

  it('returns 503 with only the concise account notice for exhausted quota', async () => {
    vi.mocked(fetchAshareCandidates).mockRejectedValue(new IfindError('private quota detail', 'quota_exhausted'));
    const response = await POST(new Request('http://localhost/api/stock-search', { method: 'POST', body: JSON.stringify({ strategy }) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'data_unavailable', message: 'iFinD 账号调用额度已用完，当前无法获取实时数据。' } });
  });
});
