import { describe, expect, it } from 'vitest';
import envelope from '../../../data/bank-snapshot.json';
import type { DataSnapshot, Strategy } from '../domain/types';
import { buildResearchInsights } from './insights';
import { screenUniverse } from '../engine/screen';

const snapshot = envelope.snapshot as DataSnapshot;
const condition = (value: number) => ({ field: 'market_cap_cny' as const, operator: 'gte' as const, value, unit: '元' as const, statisticDate: '2026-10-09', sourceExpression: '市值下限', aiInferred: false, editable: true });
const strategy = (minimum: number): Strategy => ({ id: 'banks', version: minimum === 100_000_000_000 ? 1 : 2, name: '银行股筛选', industry: 'bank', conditions: [
  condition(minimum),
], sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' } });

describe('research trade-off insights', () => {
  it('treats the real snapshot bank industry subcategories as members of the bank universe', () => {
    const baseline = strategy(100_000_000_000);
    const result = screenUniverse(snapshot, { ...baseline, conditions: [
      { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股', aiInferred: false, editable: false },
      ...baseline.conditions,
    ] });
    expect(result.included).toHaveLength(20);
    expect(result.included.some((item) => item.stock.industry.startsWith('银行'))).toBe(true);
  });

  it('explains the most restrictive condition and removed stocks that still show positive profit growth', () => {
    const previousStrategy = strategy(100_000_000_000);
    const currentStrategy = strategy(200_000_000_000);
    const previous = screenUniverse(snapshot, previousStrategy);
    const current = screenUniverse(snapshot, currentStrategy);
    const insights = buildResearchInsights(snapshot, current, previous, currentStrategy, previousStrategy);
    expect(insights.limitingCondition?.field).toBe('market_cap_cny');
    expect(insights.removedAfterTightening).toHaveLength(7);
    expect(insights.removedButStillPositiveProfitGrowth.length).toBeGreaterThan(0);
    expect(insights.compareSuggestions[0]).toMatchObject({ reason: expect.stringContaining('利润同比仍为正') });
    expect(JSON.stringify(insights)).not.toMatch(/买入|卖出|投资价值评分/);
  });
});
