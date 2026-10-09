import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const originalKey = process.env.DEEPSEEK_API_KEY;
const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

describe('POST /api/intent', () => {
  it('returns a validated strategy intent without exposing provider credentials', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output_text: JSON.stringify({ condition_changes: [], sort_direction: null, assumptions: [], clarifications: [], unsupported_requests: [] }),
    }), { status: 200 }));

    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '找盘子大且业绩增长的银行股' }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.intent.strategy.conditions.find((condition: { field: string }) => condition.field === 'market_cap_cny').value).toBe(100000000000);
    expect(JSON.stringify(body)).not.toContain('test-secret');
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
    }));
  });

  it('rejects malformed requests before calling DeepSeek', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '' }),
    }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the server key is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '银行股' }),
    }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
