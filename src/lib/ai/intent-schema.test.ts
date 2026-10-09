import { describe, expect, it } from 'vitest';
import { parseIntentOutput } from './intent-schema';
import type { Strategy } from '../domain/types';

const current: Strategy = {
  id: 'strategy-1',
  version: 3,
  name: '银行股筛选',
  industry: 'bank',
  conditions: [
    { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股', aiInferred: false, editable: true },
    { field: 'market_cap_cny', operator: 'gte', value: 100000000000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '盘子大', aiInferred: true, editable: true },
    { field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '业绩增长', aiInferred: false, editable: true },
  ],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};

const emptyDelta = {
  condition_changes: [],
  sort_direction: null,
  assumptions: [],
  clarifications: [],
  unsupported_requests: [],
};

describe('parseIntentOutput', () => {
  it('applies the fuzzy defaults for 盘子大 and 业绩增长', () => {
    const result = parseIntentOutput('找盘子大且业绩增长的银行股', emptyDelta, null);
    expect(result.strategy.conditions.find((item) => item.field === 'market_cap_cny')).toMatchObject({
      operator: 'gte', value: 100000000000, unit: '元', aiInferred: true, editable: true,
    });
    expect(result.strategy.conditions.find((item) => item.field === 'net_profit_parent_yoy_pct')).toMatchObject({ operator: 'gt', value: 0 });
    expect(result.strategy.sort.direction).toBe('desc');
  });

  it('keeps unrelated current strategy conditions during a partial edit', () => {
    const result = parseIntentOutput('把市值门槛提高到2000亿元', {
      ...emptyDelta,
      condition_changes: [{ field: 'market_cap_cny', operator: 'gte', value: 200000000000, unit: '元', action: 'upsert', source_expression: '2000亿元', ai_inferred: false, editable: true }],
    }, current);
    expect(result.strategy.conditions).toHaveLength(3);
    expect(result.strategy.conditions.find((item) => item.field === 'net_profit_parent_yoy_pct')).toEqual(current.conditions[2]);
    expect(result.strategy.conditions.find((item) => item.field === 'market_cap_cny')?.value).toBe(200000000000);
    expect(result.strategy.version).toBe(4);
  });

  it('carries clarifications and blocks execution until they are resolved', () => {
    const result = parseIntentOutput('找一些不错的股票', {
      ...emptyDelta,
      clarifications: ['请说明希望筛选的行业或指标。'],
    }, null);
    expect(result.clarifications).toEqual(['请说明希望筛选的行业或指标。']);
    expect(result.canExecute).toBe(false);
  });

  it('rejects unsupported metrics and blocks execution', () => {
    const result = parseIntentOutput('按股息率筛选银行股', emptyDelta, null);
    expect(result.unsupportedRequests[0]?.request).toBe('股息率');
    expect(result.canExecute).toBe(false);
  });

  it('blocks deterministic return forecasts even if the model omits the limitation', () => {
    const result = parseIntentOutput('预测未来三个月的收益率并筛选银行股', emptyDelta, null);
    expect(result.unsupportedRequests.some(({ request }) => request.includes('收益预测'))).toBe(true);
    expect(result.canExecute).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['{"condition_changes":[', 'truncated'],
    ['{"condition_changes":[],"sort_direction":"sideways"}', 'schema_invalid'],
  ])('rejects %s output as %s', (output, expected) => {
    try {
      parseIntentOutput('银行股', output, null);
      throw new Error('Expected an IntentOutputError.');
    } catch (error) {
      expect(error).toMatchObject({ kind: expected });
    }
  });
});
