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
      output_text: JSON.stringify({
        condition_changes: [], sort_direction: null, assumptions: [],
        clarifications: ['是否要改用其他市值门槛？', '是否要改用其他业绩口径？'], unsupported_requests: [],
      }),
    }), { status: 200 }));

    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '找盘子大且业绩增长的银行股' }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.intent.canExecute).toBe(true);
    expect(body.intent.clarifications).toEqual([]);
    expect(body.intent.strategy.conditions.find((condition: { field: string }) => condition.field === 'market_cap_cny').value).toBe(100000000000);
    expect(JSON.stringify(body)).not.toContain('test-secret');
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
    }));
  });

  it('keeps the fully supported natural-language bank query executable with local mapping provenance', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output_text: JSON.stringify({ condition_changes: [], sort_direction: null, assumptions: [], clarifications: [], unsupported_requests: [] }),
    }), { status: 200 }));

    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '帮我找些盘子大、业绩还在增长的银行股，利润增长越快越好。' }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.intent.unsupportedRequests).toEqual([]);
    expect(body.intent.canExecute).toBe(true);
    expect(body.intent.strategy.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000 }),
      expect.objectContaining({ field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0 }),
    ]));
    expect(body.intent.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
    expect(body.intent.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ concept: 'company_size', state: 'assumed', field: 'market_cap_cny' }),
      expect.objectContaining({ concept: 'profit_growth', action: 'preference' }),
    ]));
  });

  it('applies an executable multi-round profit threshold instead of silently retaining the old value', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output_text: JSON.stringify({
        condition_changes: [{
          field: 'net_profit_parent_yoy_pct', operator: 'gte', value: 10, unit: '%', action: 'upsert',
          source_expression: '归母净利润同比门槛设为10%', ai_inferred: false, editable: true,
        }],
        sort_direction: null, assumptions: [], clarifications: [], unsupported_requests: [],
      }),
    }), { status: 200 }));
    const currentStrategy = {
      id: 'bank-screening', version: 2, name: '银行股筛选', market: 'cn_a',
      conditions: [
        { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股基础范围', aiInferred: false, editable: false },
        { field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '盘子大', aiInferred: true, editable: true },
        { field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '业绩增长', aiInferred: false, editable: true },
      ],
      sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
    };
    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '把归母净利润同比门槛设为10%', currentStrategy }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.intent.canExecute).toBe(true);
    expect(body.intent.clarifications).toEqual([]);
    expect(body.intent.strategy.conditions.find((condition: { field: string }) => condition.field === 'net_profit_parent_yoy_pct')).toMatchObject({ operator: 'gte', value: 10 });
  });

  it('blocks a model condition delta that was only partially covered by deterministic mappings', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-secret';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output_text: JSON.stringify({
        condition_changes: [{
          field: 'market_cap_cny', operator: 'gte', value: 200_000_000_000, unit: '元', action: 'upsert',
          source_expression: '模型误加的市值条件', ai_inferred: false, editable: true,
        }],
        sort_direction: 'desc', assumptions: [], clarifications: [], unsupported_requests: [],
      }),
    }), { status: 200 }));
    const currentStrategy = {
      id: 'bank-screening', version: 2, name: '银行股筛选', market: 'cn_a',
      conditions: [
        { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股基础范围', aiInferred: false, editable: false },
        { field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '盘子大', aiInferred: true, editable: true },
        { field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '业绩增长', aiInferred: false, editable: true },
      ],
      sort: { field: 'market_cap_cny', direction: 'desc' },
    };
    const response = await POST(new Request('http://localhost/api/intent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '利润增长降序排序', currentStrategy }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.intent.canExecute).toBe(false);
    expect(body.intent.clarifications).toEqual(expect.arrayContaining([expect.stringContaining('白名单确定性映射')]));
    expect(body.intent.strategy.conditions.find((condition: { field: string }) => condition.field === 'market_cap_cny')).toMatchObject({ value: 100_000_000_000 });
    expect(body.intent.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
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
