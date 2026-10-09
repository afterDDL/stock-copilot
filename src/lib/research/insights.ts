import type { Condition, DataSnapshot, Indicator, ScreeningResult, Strategy } from '../domain/types';
import { calculateUniverseStatistics, getBoundaryStocks } from './distribution';

export type ResearchInsights = {
  snapshotId: string;
  limitingCondition: { field: Indicator; label: string; excludedCount: number } | null;
  boundaryStocks: Array<{ code: string; name: string; marketCapCny: number; distanceCny: number; threshold: number }>;
  removedAfterTightening: Array<{ code: string; name: string }>;
  removedButStillPositiveProfitGrowth: Array<{ code: string; name: string; profitGrowthPct: number }>;
  compareSuggestions: Array<{ leftCode: string; rightCode: string; reason: string }>;
  thresholdStatistics: ReturnType<typeof calculateUniverseStatistics>;
};

const labels: Record<Indicator, string> = {
  industry: '所属行业',
  market_cap_cny: '总市值',
  net_profit_parent_yoy_pct: '归母净利润同比增长率',
};

function thresholdCondition(conditions: Condition[]): Condition | undefined {
  return conditions.find((condition) => condition.field === 'market_cap_cny' && typeof condition.value === 'number');
}

export function buildResearchInsights(
  snapshot: DataSnapshot,
  current: ScreeningResult,
  previous: ScreeningResult | null,
  strategy: Strategy,
  previousStrategy: Strategy | null,
): ResearchInsights {
  const failedCounts = new Map<Indicator, number>();
  for (const item of current.excluded) {
    const fieldsFailedForStock = new Set<Indicator>();
    for (const evidence of item.evidence) {
      if (evidence.status === 'failed') fieldsFailedForStock.add(evidence.condition.field);
    }
    for (const field of fieldsFailedForStock) failedCounts.set(field, (failedCounts.get(field) ?? 0) + 1);
  }
  const limitingEntry = [...failedCounts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  const limitingCondition = limitingEntry
    ? { field: limitingEntry[0], label: labels[limitingEntry[0]], excludedCount: limitingEntry[1] }
    : null;
  const cap = thresholdCondition(strategy.conditions) ?? (previousStrategy ? thresholdCondition(previousStrategy.conditions) : undefined);
  const threshold = typeof cap?.value === 'number' ? cap.value : 100_000_000_000;
  const boundaryStocks = getBoundaryStocks(snapshot, threshold, Math.max(threshold * 0.1, 20_000_000_000))
    .map((stock) => {
      const marketCapCny = stock.metrics.market_cap_cny.value;
      if (typeof marketCapCny !== 'number') return null;
      return { code: stock.code, name: stock.name, marketCapCny, distanceCny: Math.abs(marketCapCny - threshold), threshold };
    }).filter((stock): stock is NonNullable<typeof stock> => stock !== null);

  const currentIncluded = new Set(current.included.map((item) => item.stock.code));
  const currentExcluded = new Set(current.excluded.map((item) => item.stock.code));
  const previousIncluded = new Set(previous?.included.map((item) => item.stock.code) ?? []);
  const removedAfterTightening = [...previousIncluded]
    .filter((code) => currentExcluded.has(code) && !currentIncluded.has(code))
    .map((code) => snapshot.stocks.find((stock) => stock.code === code))
    .filter((stock): stock is NonNullable<typeof stock> => stock !== undefined)
    .map((stock) => ({ code: stock.code, name: stock.name }));
  const removedButStillPositiveProfitGrowth = removedAfterTightening
    .map(({ code, name }) => {
      const value = snapshot.stocks.find((stock) => stock.code === code)?.metrics.net_profit_parent_yoy_pct.value;
      return typeof value === 'number' && value > 0 ? { code, name, profitGrowthPct: value } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.profitGrowthPct - left.profitGrowthPct || left.code.localeCompare(right.code));
  const firstIncluded = current.included[0]?.stock;
  const compareSuggestions = firstIncluded
    ? removedButStillPositiveProfitGrowth.slice(0, 5).map((removed) => ({
      leftCode: removed.code,
      rightCode: firstIncluded.code,
      reason: '该股被收紧条件剔除，但利润同比仍为正（' + removed.profitGrowthPct.toFixed(2) + '%）；可与当前入选的' + firstIncluded.name + '对照规模和利润同比。',
    }))
    : [];
  return {
    snapshotId: snapshot.snapshotId,
    limitingCondition,
    boundaryStocks,
    removedAfterTightening,
    removedButStillPositiveProfitGrowth,
    compareSuggestions,
    thresholdStatistics: calculateUniverseStatistics(snapshot, threshold),
  };
}
