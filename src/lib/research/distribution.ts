import type { DataSnapshot, StockRecord } from '../domain/types';

export type UniverseStatistics = {
  snapshotId: string;
  asOf: string;
  sampleCount: number;
  minimumCny: number | null;
  maximumCny: number | null;
  medianCny: number | null;
  threshold: number;
  atOrAboveThreshold: number;
  belowThreshold: number;
  thresholdPositionPct: number | null;
  top30ThresholdCny: number | null;
  method: string;
};
export type StockPeerPosition = { code: string; rank: number; total: number; percentile: number; marketCapCny: number };

function capValues(snapshot: DataSnapshot): Array<{ stock: StockRecord; value: number }> {
  return snapshot.stocks
    .map((stock) => ({ stock, value: stock.metrics.market_cap_cny.value }))
    .filter((entry): entry is { stock: StockRecord; value: number } =>
      typeof entry.value === 'number' && Number.isFinite(entry.value) && entry.stock.metrics.market_cap_cny.coverage === 'available');
}
function sortedCaps(snapshot: DataSnapshot) {
  return capValues(snapshot).sort((a, b) => a.value - b.value || a.stock.code.localeCompare(b.stock.code));
}

export function calculateUniverseStatistics(snapshot: DataSnapshot, threshold: number): UniverseStatistics {
  const values = sortedCaps(snapshot).map((entry) => entry.value);
  const count = values.length;
  const midpoint = Math.floor(count / 2);
  const medianCny = count === 0 ? null : count % 2 === 0
    ? (values[midpoint - 1] + values[midpoint]) / 2
    : values[midpoint];
  const atOrAboveThreshold = values.filter((value) => value >= threshold).length;
  const top30Index = count ? Math.ceil(count * 0.7) - 1 : -1;
  return {
    snapshotId: snapshot.snapshotId,
    asOf: snapshot.asOf,
    sampleCount: count,
    minimumCny: values[0] ?? null,
    maximumCny: values.at(-1) ?? null,
    medianCny,
    threshold,
    atOrAboveThreshold,
    belowThreshold: count - atOrAboveThreshold,
    thresholdPositionPct: count ? (atOrAboveThreshold / count) * 100 : null,
    top30ThresholdCny: top30Index >= 0 ? values[top30Index] ?? null : null,
    method: '使用当前数据快照的可用总市值，升序统计；中位数取中间值均值，前30%门槛取升序第ceil(样本数×70%)个值。',
  };
}

export function calculateStockPeerPosition(snapshot: DataSnapshot, code: string): StockPeerPosition | null {
  const peers = sortedCaps(snapshot).reverse();
  const rankIndex = peers.findIndex((entry) => entry.stock.code === code);
  if (rankIndex < 0) return null;
  const item = peers[rankIndex];
  if (!item) return null;
  return {
    code,
    rank: rankIndex + 1,
    total: peers.length,
    percentile: peers.length < 2 ? 100 : ((peers.length - (rankIndex + 1)) / (peers.length - 1)) * 100,
    marketCapCny: item.value,
  };
}

export function getBoundaryStocks(snapshot: DataSnapshot, threshold: number, distance: number): StockRecord[] {
  return capValues(snapshot)
    .filter((entry) => Math.abs(entry.value - threshold) <= distance)
    .sort((a, b) => Math.abs(a.value - threshold) - Math.abs(b.value - threshold) || a.stock.code.localeCompare(b.stock.code))
    .map((entry) => entry.stock);
}
