import { describe, expect, it, vi } from 'vitest';
import type { Strategy } from '../domain/types';
import { AshareSearchError } from './errors';
import { IfindMcpClient } from './client';
import { buildSearchQueries, fetchAshareCandidates } from './a-share-search';

const strategy: Strategy = {
  id: 'growth', version: 1, name: '科技股增长筛选', market: 'cn_a',
  conditions: [
    { field: 'industry', operator: 'eq', value: '电子', unit: '行业', statisticDate: null, sourceExpression: '电子行业', aiInferred: false, editable: true },
    { field: 'market_cap_cny', operator: 'gte', value: 10_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '市值至少100亿', aiInferred: false, editable: true },
    { field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '净利润增长', aiInferred: false, editable: true },
  ],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};

const cap = (rows: string) => `| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261009] |\n|---|---|---|---:|\n${rows}`;
const profit = (rows: string) => `| 股票代码 | 股票简称 | 所属同花顺行业 | 归属于母公司所有者的净利润同比增长率[20260630] |\n|---|---|---|---:|\n${rows}`;
const rowsCap = '| 300001.SZ | 特锐德 | 电力设备-电网设备 | 12000000000 |\n| 688001.SH | 华兴源创 | 电子-半导体 | 18000000000 |';
const rowsProfit = '| 300001.SZ | 特锐德 | 电力设备-电网设备 | 12.5 |\n| 688001.SH | 华兴源创 | 电子-半导体 |  |';

function clientFor(results: string[]) {
  const callTool = vi.fn().mockImplementation(async () => ({ content: [{ type: 'text', text: results.shift() }] }));
  return { callTool } as never as { callTool: typeof callTool };
}

describe('A-share controlled search', () => {
  it.each([
    ['market cap only', strategy.conditions.filter((item) => item.field === 'market_cap_cny')],
    ['profit only', strategy.conditions.filter((item) => item.field === 'net_profit_parent_yoy_pct')],
    ['industry only', strategy.conditions.filter((item) => item.field === 'industry')],
    ['bounded all-market', strategy.conditions.filter((item) => item.field !== 'industry')],
  ])('parses both fixed indicators through the real client for %s', async (_label, conditions) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { headers: { 'Mcp-Session-Id': 'test-session' } }))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: cap(rowsCap) }] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: profit(rowsProfit) }] } })));
    const client = new IfindMcpClient({ token: 'test-token', fetch: fetcher as typeof fetch });
    const { snapshot } = await fetchAshareCandidates({ ...strategy, conditions }, client);
    expect(snapshot.stocks.map((stock) => stock.code)).toEqual(['300001', '688001']);
    expect(snapshot.stocks[0].metrics.market_cap_cny.value).toBe(12_000_000_000);
    expect(snapshot.stocks[0].metrics.net_profit_parent_yoy_pct.value).toBe(12.5);
  });
  it('builds two single-indicator queries with identical scope and hard filters', () => {
    const [capQuery, profitQuery] = buildSearchQueries(strategy);
    const shared = '电子';
    expect(capQuery).toContain(shared);
    expect(profitQuery).toContain(shared);
    expect(capQuery).toContain('10000000000');
    expect(profitQuery).toContain('10000000000');
    expect(capQuery).toContain('大于0%');
    expect(profitQuery).toContain('大于0%');
    expect(capQuery).toContain('总市值');
    expect(profitQuery).not.toContain('总市值[');
    expect(profitQuery).toContain('归属于母公司所有者的净利润同比增长率');
    expect(capQuery).not.toContain('归属于母公司所有者的净利润同比增长率[');
  });

  it('supports an all-market query when the strategy has no industry condition', () => {
    const [capQuery, profitQuery] = buildSearchQueries({ ...strategy, conditions: strategy.conditions.filter((condition) => condition.field !== 'industry') });
    expect(capQuery).toContain('沪深北A股');
    expect(profitQuery).toContain('沪深北A股');
    expect(capQuery).not.toContain('所属行业等于');
    expect(profitQuery).not.toContain('所属行业等于');
  });

  it('returns valid non-bank candidates and preserves absent numeric values as missing', async () => {
    const client = clientFor([cap(rowsCap), profit(rowsProfit)]);
    const { snapshot } = await fetchAshareCandidates(strategy, client as never);
    expect(snapshot.stocks.map(({ code }) => code)).toEqual(['300001', '688001']);
    expect(snapshot.stocks[0]).toMatchObject({ name: '特锐德', industry: '电力设备-电网设备' });
    expect(snapshot.stocks[1].metrics.net_profit_parent_yoy_pct).toMatchObject({ value: null, coverage: 'missing', unit: '%' });
    expect(snapshot.coverage.metrics.net_profit_parent_yoy_pct).toEqual({ available: 1, missing: 1 });
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });

  it('accepts a valid empty result table', async () => {
    const client = clientFor([cap(''), profit('')]);
    const { snapshot } = await fetchAshareCandidates(strategy, client as never);
    expect(snapshot.stocks).toEqual([]);
    expect(snapshot.coverage).toMatchObject({ expectedStocks: 0, returnedStocks: 0, complete: true });
  });

  it('normalizes explicit market-cap units to yuan', async () => {
    const client = clientFor([
      cap('| 300001.SZ | 特锐德 | 电力设备 | 120亿元 |'),
      profit('| 300001.SZ | 特锐德 | 电力设备 | 12.5% |'),
    ]);
    const { snapshot } = await fetchAshareCandidates(strategy, client as never);
    expect(snapshot.stocks[0].metrics.market_cap_cny.value).toBe(12_000_000_000);
    expect(snapshot.stocks[0].metrics.net_profit_parent_yoy_pct.value).toBe(12.5);
  });

  it('normalizes iFinD market-cap shorthand units to yuan', async () => {
    const client = clientFor([
      cap('| 688001.SH | 华兴源创 | 电子-半导体 | 260.304221688亿 |'),
      profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85% |'),
    ]);
    const { snapshot } = await fetchAshareCandidates(strategy, client as never);
    expect(snapshot.stocks[0]?.metrics.market_cap_cny.value).toBeCloseTo(26_030_422_168.8, 4);
  });

  it('classifies unsupported market-cap units without exposing metric text', async () => {
    const client = clientFor([
      cap('| 688001.SH | 华兴源创 | 电子-半导体 | 260亿股本 |'),
      profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85% |'),
    ]);
    await expect(fetchAshareCandidates(strategy, client as never)).rejects.toMatchObject({ code: 'needs_narrowing', reasonCode: 'invalid_market_cap_unit_annotation' });
  });

  it('classifies unsupported profit-growth units without exposing metric text', async () => {
    const client = clientFor([
      cap('| 688001.SH | 华兴源创 | 电子-半导体 | 260亿元 |'),
      profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85亿元 |'),
    ]);
    await expect(fetchAshareCandidates(strategy, client as never)).rejects.toMatchObject({ code: 'needs_narrowing', reasonCode: 'invalid_profit_growth_unit' });
  });

  it('projects allow-listed fields while ignoring unrelated provider columns', async () => {
    const extraColumn = '| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261009] | 备注 |\n|---|---|---|---:|---|\n| 688001.SH | 华兴源创 | 电子-半导体 | 26030422168.8 | 示例 |';
    const client = clientFor([extraColumn, profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85 |')]);
    const { snapshot } = await fetchAshareCandidates(strategy, client as never);
    expect(snapshot.stocks).toHaveLength(1);
    expect(snapshot.stocks[0]).toMatchObject({ code: '688001', name: '华兴源创', industry: '电子-半导体' });
    expect(snapshot.stocks[0]?.metrics.market_cap_cny.value).toBe(26_030_422_168.8);
  });

  it('classifies a missing required metric column without exposing response content', async () => {
    const wrongMetric = '| 股票代码 | 股票简称 | 所属同花顺行业 | 市值[20261009] |\n|---|---|---|---:|\n| 688001.SH | 华兴源创 | 电子-半导体 | 26030422168.8 |';
    const client = clientFor([wrongMetric, profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85 |')]);
    await expect(fetchAshareCandidates(strategy, client as never)).rejects.toMatchObject({ code: 'needs_narrowing', reasonCode: 'missing_metric_column' });
  });

  it('accepts another supported indicator when it is also a strategy condition', async () => {
    const twoIndicators = '| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261009] | 归属于母公司所有者的净利润同比增长率[20260630] |\n|---|---|---|---:|---:|\n| 688001.SH | 华兴源创 | 电子-半导体 | 26030422168.8 | 20.85 |';
    const client = clientFor([twoIndicators, profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85 |')]);
    const { snapshot } = await fetchAshareCandidates(strategy, client as never);
    expect(snapshot.stocks).toHaveLength(1);
    expect(snapshot.stocks[0]).toMatchObject({ code: '688001', name: '华兴源创', industry: '电子-半导体' });
    expect(snapshot.stocks[0]?.metrics.market_cap_cny.value).toBe(26_030_422_168.8);
  });

  it('accepts the fixed display indicators without requiring financial hard conditions', async () => {
    const capOnlyStrategy = { ...strategy, conditions: strategy.conditions.filter((item) => item.field !== 'net_profit_parent_yoy_pct') };
    const twoIndicators = '| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261009] | 归属于母公司所有者的净利润同比增长率[20260630] |\n|---|---|---|---:|---:|\n| 688001.SH | 华兴源创 | 电子-半导体 | 26030422168.8 | 20.85 |';
    const client = clientFor([twoIndicators, profit('| 688001.SH | 华兴源创 | 电子-半导体 | 20.85 |')]);
    const { snapshot } = await fetchAshareCandidates(capOnlyStrategy, client as never);
    expect(snapshot.stocks[0].metrics.net_profit_parent_yoy_pct.value).toBe(20.85);
  });

  it('keeps a sanitized reason code when broad or truncated coverage needs narrowing', async () => {
    const client = clientFor([cap(`${rowsCap}\n\nShowing 2 of 150 rows`), profit(rowsProfit)]);
    await expect(fetchAshareCandidates(strategy, client as never)).rejects.toMatchObject({
      code: 'needs_narrowing', reasonCode: 'truncated_content',
    });
  });

  it.each([
    ['truncation marker', cap(`${rowsCap}\n\nShowing 2 of 150 rows`), profit(rowsProfit), AshareSearchError],
    ['more than 100 rows', cap(Array.from({ length: 101 }, (_, i) => `| ${String(i).padStart(6, '0')} | 名称${i} | 电子 | 10000000001 |`).join('\n')), profit(rowsProfit), AshareSearchError],
    ['duplicate codes', cap(`${rowsCap}\n| 300001.SH | 重复 | 电子 | 12000000000 |`), profit(rowsProfit), AshareSearchError],
    ['different code sets', cap(rowsCap), profit('| 300001.SZ | 特锐德 | 电力设备-电网设备 | 12.5 |'), AshareSearchError],
    ['wrong columns', '| 股票代码 | 股票简称 | 所属同花顺行业 | 市值[20261009] |\n|---|---|---|---|\n| 300001.SZ | 特锐德 | 电子 | 12000000000 |', profit(rowsProfit), AshareSearchError],
    ['identity mismatch', cap(rowsCap), profit('| 300001.SZ | 错误名称 | 电力设备-电网设备 | 12.5 |\n| 688001.SH | 华兴源创 | 电子-半导体 | 2 |'), AshareSearchError],
    ['invalid units', cap('| 300001.SZ | 特锐德 | 电力设备 | 12% |'), profit('| 300001.SZ | 特锐德 | 电力设备 | 1% |'), AshareSearchError],
    ['invalid dates', cap('| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261340] |\n|---|---|---|---|\n| 300001.SZ | 特锐德 | 电力设备 | 12 |'), profit(rowsProfit), AshareSearchError],
    ['empty content', '', profit(rowsProfit), AshareSearchError],
  ])('rejects %s instead of returning partial candidates', async (_label, capText, profitText, errorType) => {
    const client = clientFor([capText, profitText]);
    await expect(fetchAshareCandidates(strategy, client as never)).rejects.toBeInstanceOf(errorType);
  });
});
