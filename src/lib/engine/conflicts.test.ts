import { describe, expect, it } from 'vitest';
import { detectConflicts } from './conflicts';
import type { Condition, Strategy } from '../domain/types';

const condition = (operator: Condition['operator'], value: number): Condition => ({
  field: 'market_cap_cny', operator, value, unit: '元', statisticDate: '2026-10-09',
  sourceExpression: '总市值[20261009]', aiInferred: false, editable: true,
});

const strategy = (conditions: Condition[]): Strategy => ({
  id: 'strategy-1', version: 1, name: '稳健银行股', industry: 'bank', conditions,
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
});

describe('detectConflicts', () => {
  it('reports contradictory range and equality constraints for one indicator', () => {
    expect(detectConflicts(strategy([
      condition('gte', 100_000_000_000),
      condition('lte', 80_000_000_000),
      condition('eq', 90_000_000_000),
    ]))).toEqual([
      { field: 'market_cap_cny', kind: 'empty_range', minimum: 100_000_000_000, maximum: 80_000_000_000 },
      { field: 'market_cap_cny', kind: 'equality_outside_range', value: 90_000_000_000,
        minimum: 100_000_000_000, maximum: 80_000_000_000 },
    ]);
  });

  it('reports distinct equality values for the same indicator as a conflict', () => {
    const profitConditions: Condition[] = [
      { field: 'net_profit_parent_yoy_pct', operator: 'eq', value: 8, unit: '%',
        statisticDate: '2026-06-30', sourceExpression: '归母净利润同比增长率[20260630]',
        aiInferred: false, editable: true },
      { field: 'net_profit_parent_yoy_pct', operator: 'eq', value: 9, unit: '%',
        statisticDate: '2026-06-30', sourceExpression: '归母净利润同比增长率[20260630]',
        aiInferred: false, editable: true },
    ];

    expect(detectConflicts(strategy(profitConditions))).toEqual([
      { field: 'net_profit_parent_yoy_pct', kind: 'multiple_equalities', values: [8, 9] },
    ]);
  });

  it('does not report a conflict for a compatible range with an in-range equality', () => {
    expect(detectConflicts(strategy([
      condition('gte', 100_000_000_000),
      condition('lte', 200_000_000_000),
      condition('eq', 150_000_000_000),
    ]))).toEqual([]);
  });

  it('treats a shared boundary as empty when one range edge is strict', () => {
    expect(detectConflicts(strategy([
      condition('gt', 100_000_000_000),
      condition('lte', 100_000_000_000),
    ]))).toEqual([
      { field: 'market_cap_cny', kind: 'empty_range', minimum: 100_000_000_000, maximum: 100_000_000_000 },
    ]);
  });

  it('uses null to represent an unbounded side in equality conflicts', () => {
    expect(detectConflicts(strategy([
      condition('gte', 100_000_000_000),
      condition('eq', 90_000_000_000),
    ]))).toEqual([
      { field: 'market_cap_cny', kind: 'equality_outside_range', value: 90_000_000_000,
        minimum: 100_000_000_000, maximum: null },
    ]);
  });
});
