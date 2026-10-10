import type {
  Condition,
  ConditionEvidence,
  DataSnapshot,
  MetricValue,
  ScreeningResult,
  StockRecord,
  StockScreeningEvidence,
  Strategy,
} from '../domain/types';
import { explainCondition } from './explain';

function metricValue(stock: StockRecord, condition: Condition): MetricValue {
  return stock.metrics[condition.field];
}

function evaluate(actual: number | string, condition: Condition): 'passed' | 'failed' {
  if (condition.operator === 'eq') {
    return actual === condition.value ? 'passed' : 'failed';
  }
  if (typeof actual !== 'number' || typeof condition.value !== 'number') return 'failed';
  if (condition.operator === 'gt') return actual > condition.value ? 'passed' : 'failed';
  if (condition.operator === 'gte') return actual >= condition.value ? 'passed' : 'failed';
  if (condition.operator === 'lt') return actual < condition.value ? 'passed' : 'failed';
  return actual <= condition.value ? 'passed' : 'failed';
}

function compareCodes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function screenUniverse(
  snapshot: DataSnapshot,
  strategy: Strategy,
): ScreeningResult {
  const included: StockScreeningEvidence[] = [];
  const excluded: StockScreeningEvidence[] = [];
  const unknown: StockScreeningEvidence[] = [];

  for (const stock of snapshot.stocks) {
    const evidence = strategy.conditions.map((condition) => {
      const metric = metricValue(stock, condition);
      const dateMismatch = condition.statisticDate !== null && metric.date !== condition.statisticDate;
      const status: ConditionEvidence['status'] = metric.value === null || metric.coverage === 'missing' || dateMismatch
        ? 'unknown'
        : evaluate(metric.value, condition);
      return {
        condition,
        status,
        actual: metric.value,
        unit: metric.unit,
        statisticDate: metric.date,
        source: metric.source,
        explanation: explainCondition(condition, metric.value, metric.date),
      };
    });
    const item = { stock, evidence };
    if (evidence.some((entry) => entry.status === 'failed')) excluded.push(item);
    else if (evidence.some((entry) => entry.status === 'unknown')) unknown.push(item);
    else included.push(item);
  }

  included.sort((left, right) => {
    const a = left.stock.metrics[strategy.sort.field].value;
    const b = right.stock.metrics[strategy.sort.field].value;
    if (typeof a === 'number' && typeof b === 'number' && a !== b) {
      return strategy.sort.direction === 'desc' ? b - a : a - b;
    }
    if (typeof a === 'number' && typeof b !== 'number') return -1;
    if (typeof b === 'number' && typeof a !== 'number') return 1;
    return compareCodes(left.stock.code, right.stock.code);
  });
  excluded.sort((left, right) => compareCodes(left.stock.code, right.stock.code));
  unknown.sort((left, right) => compareCodes(left.stock.code, right.stock.code));

  return {
    snapshotId: snapshot.snapshotId,
    strategyVersion: strategy.version,
    included,
    excluded,
    unknown,
  };
}
