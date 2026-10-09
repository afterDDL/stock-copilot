import { describe, expect, it } from 'vitest';
import { screenUniverse } from './screen';
import type { DataSnapshot, MetricUnit, MetricValue, StockRecord, Strategy } from '../domain/types';

const metric = (value: MetricValue['value'], unit: MetricUnit, date: string | null): MetricValue => ({
  value, unit, date, source: 'historical', coverage: value === null ? 'missing' : 'available',
});

const stock = (code: string, marketCap: number | null, profitYoY: number | null): StockRecord => ({
  code, name: `${code}银行`, industry: '银行',
  metrics: {
    industry: metric('银行', '行业', null),
    market_cap_cny: metric(marketCap, '元', '2026-10-09'),
    net_profit_parent_yoy_pct: metric(profitYoY, '%', '2026-06-30'),
  },
});

const snapshot = (stocks: StockRecord[]): DataSnapshot => ({
  snapshotId: 'fixture', source: 'historical', asOf: '2026-10-09', stocks,
  coverage: {
    expectedStocks: stocks.length, returnedStocks: stocks.length, complete: true,
    metrics: {
      industry: { available: stocks.length, missing: 0 },
      market_cap_cny: { available: stocks.filter((item) => item.metrics.market_cap_cny.value !== null).length,
        missing: stocks.filter((item) => item.metrics.market_cap_cny.value === null).length },
      net_profit_parent_yoy_pct: { available: stocks.filter((item) => item.metrics.net_profit_parent_yoy_pct.value !== null).length,
        missing: stocks.filter((item) => item.metrics.net_profit_parent_yoy_pct.value === null).length },
    },
  },
});

const strategy: Strategy = {
  id: 'strategy-1', version: 1, name: '稳健银行股', industry: 'bank',
  conditions: [
    { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null,
      sourceExpression: '同花顺行业', aiInferred: false, editable: false },
    { field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元',
      statisticDate: '2026-10-09', sourceExpression: '总市值[20261009]', aiInferred: true, editable: true },
  ],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};

describe('screenUniverse', () => {
  it('classifies unavailable metric values as unknown instead of failed', () => {
    const result = screenUniverse(snapshot([stock('000004', null, 30)]), strategy);

    expect(result.unknown.map((item) => item.stock.code)).toEqual(['000004']);
    expect(result.excluded).toHaveLength(0);
  });

  it('sorts matching stocks by profit growth descending with stock code as a stable tie-breaker', () => {
    const result = screenUniverse(snapshot([
      stock('000003', 300_000_000_000, 20),
      stock('000002', 200_000_000_000, 20),
      stock('000001', 100_000_000_000, 10),
    ]), strategy);

    expect(result.included.map((item) => item.stock.code)).toEqual(['000002', '000003', '000001']);
  });

  it('reproduces the 16-to-12 bank threshold fixture when market cap rises from 1000 to 2000亿元', () => {
    const stocks = Array.from({ length: 16 }, (_, index) => stock(
      `600${String(index).padStart(3, '0')}`,
      index < 12 ? (2000 + index) * 100_000_000 : (1000 + index) * 100_000_000,
      20 - index,
    ));
    const fixture = snapshot(stocks);
    const at1000 = screenUniverse(fixture, strategy);
    const at2000 = screenUniverse(fixture, {
      ...strategy,
      conditions: strategy.conditions.map((condition) => condition.field === 'market_cap_cny'
        ? { ...condition, value: 200_000_000_000 }
        : condition),
    });

    expect(at1000.included).toHaveLength(16);
    expect(at2000.included).toHaveLength(12);
    expect(at2000.excluded.map((item) => item.stock.code)).toEqual([
      '600012', '600013', '600014', '600015',
    ]);
  });
});
