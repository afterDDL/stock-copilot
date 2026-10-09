import { describe, expect, it } from 'vitest';
import envelope from '../../../data/bank-snapshot.json';
import { calculateStockPeerPosition, calculateUniverseStatistics, getBoundaryStocks } from './distribution';
import type { DataSnapshot } from '../domain/types';

const snapshot = envelope.snapshot as DataSnapshot;

describe('snapshot-based market-cap distribution', () => {
  it('reports the current snapshot sample and threshold distribution deterministically', () => {
    const result = calculateUniverseStatistics(snapshot, 100_000_000_000);
    expect(result).toMatchObject({
      snapshotId: 'ifind-banks-2026-10-09', asOf: '2026-10-09', sampleCount: 42,
      minimumCny: 9_445_649_034.66, maximumCny: 2_774_719_044_643.1,
      medianCny: 82_109_709_010.995, atOrAboveThreshold: 20, threshold: 100_000_000_000,
    });
    expect(result.top30ThresholdCny).toBe(224_914_591_914.82);
    expect(result.method).toContain('可用总市值，升序统计');
  });

  it('ranks peers and returns boundary stocks by their real snapshot market caps', () => {
    expect(calculateStockPeerPosition(snapshot, '601398')).toMatchObject({ rank: 1, total: 42, percentile: 100 });
    expect(getBoundaryStocks(snapshot, 100_000_000_000, 20_000_000_000).map((stock) => stock.code)).toEqual(['600015', '601825', '601169', '601838']);
  });
});
