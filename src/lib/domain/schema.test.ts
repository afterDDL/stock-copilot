import { describe, expect, it } from 'vitest';
import { conditionSchema, dataSnapshotSchema, strategySchema } from './schema';

const marketCapCondition = {
  field: 'market_cap_cny',
  operator: 'gte',
  value: 100_000_000_000,
  unit: '元',
  statisticDate: '2026-10-09',
  sourceExpression: '总市值[20261009]',
  aiInferred: true,
  editable: true,
};

describe('strategy schemas', () => {
  it('accepts only indicators in the supported field whitelist', () => {
    expect(conditionSchema.safeParse(marketCapCondition).success).toBe(true);
    expect(
      conditionSchema.safeParse({ ...marketCapCondition, field: 'roe' }).success,
    ).toBe(false);
  });

  it('accepts an all-market strategy without an industry condition', () => {
    expect(strategySchema.safeParse({
      id: 'strategy-1',
      version: 1,
      name: '全市场大市值股票',
      market: 'cn_a',
      conditions: [marketCapCondition],
      sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
    }).success).toBe(true);
  });

  it('accepts arbitrary exact industry names while preserving the three-field whitelist', () => {
    expect(strategySchema.safeParse({
      id: 'strategy-2', version: 1, name: '人工智能行业股票', market: 'cn_a',
      conditions: [
        { field: 'industry', operator: 'eq', value: '人工智能', unit: '行业', statisticDate: null,
          sourceExpression: '人工智能行业', aiInferred: false, editable: true },
        marketCapCondition,
      ],
      sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
    }).success).toBe(true);
    expect(conditionSchema.safeParse({ ...marketCapCondition, field: 'roe' }).success).toBe(false);
    expect(strategySchema.safeParse({ conditions: [marketCapCondition] }).success).toBe(false);
  });

  it('requires dated, sourced per-metric values and matching metric coverage', () => {
    const metric = (value: number | string, unit: string, date: string | null) => ({
      value, unit, date, source: 'historical', coverage: 'available',
    });
    const snapshot = {
      snapshotId: 'fixture', source: 'historical', asOf: '2026-10-09',
      stocks: [{
        code: '600000', name: '浦发银行', industry: '银行',
        metrics: {
          industry: metric('银行', '行业', null),
          market_cap_cny: metric(100_000_000_000, '元', '2026-10-09'),
          net_profit_parent_yoy_pct: metric(8, '%', '2026-06-30'),
        },
      }],
      coverage: {
        expectedStocks: 1, returnedStocks: 1, complete: true,
        metrics: {
          industry: { available: 1, missing: 0 },
          market_cap_cny: { available: 1, missing: 0 },
          net_profit_parent_yoy_pct: { available: 1, missing: 0 },
        },
      },
    };

    expect(dataSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(dataSnapshotSchema.safeParse({
      ...snapshot,
      stocks: [{ ...snapshot.stocks[0], industry: '银行-银行-城商行' }],
    }).success).toBe(false);
    expect(dataSnapshotSchema.safeParse({
      ...snapshot,
      coverage: { ...snapshot.coverage, expectedStocks: 42 },
    }).success).toBe(false);
    expect(dataSnapshotSchema.safeParse({
      ...snapshot,
      stocks: [{ ...snapshot.stocks[0], metrics: {
        ...snapshot.stocks[0].metrics,
        market_cap_cny: metric(100_000_000_000, '元', null),
      } }],
    }).success).toBe(false);
    expect(dataSnapshotSchema.safeParse({
      ...snapshot,
      stocks: [{ ...snapshot.stocks[0], metrics: {
        ...snapshot.stocks[0].metrics,
        market_cap_cny: metric('not-a-number', '元', '2026-10-09'),
      } }],
    }).success).toBe(false);
  });
});
