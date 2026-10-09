import { describe, expect, it } from 'vitest';
import { diffResults } from './diff';
import type { ScreeningResult } from '../domain/types';

const result = (codes: string[]): ScreeningResult => ({
  snapshotId: 'same-snapshot',
  strategyVersion: 1,
  included: codes.map((code) => ({
    stock: {
      code, name: `${code}银行`, industry: '银行',
      metrics: {
        industry: { value: '银行', unit: '行业', date: null, source: 'historical', coverage: 'available' },
        market_cap_cny: { value: 150_000_000_000, unit: '元', date: '2026-10-09', source: 'historical', coverage: 'available' },
        net_profit_parent_yoy_pct: { value: 8, unit: '%', date: '2026-06-30', source: 'historical', coverage: 'available' },
      },
    },
    evidence: [],
  })),
  excluded: [],
  unknown: [],
});

describe('diffResults', () => {
  it('reports stocks added, retained, and removed across a strategy revision', () => {
    expect(diffResults(result(['A', 'B']), result(['B', 'C']))).toEqual({
      added: ['C'],
      retained: ['B'],
      removed: ['A'],
    });
  });

  it('lists the four stocks removed when a 16-stock result narrows to twelve', () => {
    const previous = result(Array.from({ length: 16 }, (_, index) => `600${String(index).padStart(3, '0')}`));
    const next = result(Array.from({ length: 12 }, (_, index) => `600${String(index).padStart(3, '0')}`));

    expect(diffResults(previous, next)).toEqual({
      added: [],
      retained: ['600000', '600001', '600002', '600003', '600004', '600005',
        '600006', '600007', '600008', '600009', '600010', '600011'],
      removed: ['600012', '600013', '600014', '600015'],
    });
  });
});
