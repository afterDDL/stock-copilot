import type { Condition, Indicator, Strategy, StrategyConflict } from '../domain/types';

export function detectConflicts(strategy: Strategy): StrategyConflict[] {
  const byField = new Map<Indicator, Condition[]>();
  for (const condition of strategy.conditions) {
    const existing = byField.get(condition.field) ?? [];
    existing.push(condition);
    byField.set(condition.field, existing);
  }

  const conflicts: StrategyConflict[] = [];
  for (const [field, conditions] of byField) {
    const lower = conditions.filter((condition) => condition.operator === 'gte' || condition.operator === 'gt');
    const upper = conditions.filter((condition) => condition.operator === 'lte' || condition.operator === 'lt');
    const numericLower = lower.filter((condition) => typeof condition.value === 'number');
    const numericUpper = upper.filter((condition) => typeof condition.value === 'number');
    const minimumBound = numericLower.length
      ? Math.max(...numericLower.map((condition) => condition.value as number))
      : null;
    const maximumBound = numericUpper.length
      ? Math.min(...numericUpper.map((condition) => condition.value as number))
      : null;
    const minimum = minimumBound ?? Number.NEGATIVE_INFINITY;
    const maximum = maximumBound ?? Number.POSITIVE_INFINITY;
    const lowerAtBoundaryIsStrict = numericLower.some((condition) =>
      condition.value === minimum && condition.operator === 'gt');
    const upperAtBoundaryIsStrict = numericUpper.some((condition) =>
      condition.value === maximum && condition.operator === 'lt');
    const rangeIsEmpty = minimum > maximum || (
      minimum === maximum && (lowerAtBoundaryIsStrict || upperAtBoundaryIsStrict)
    );

    if (rangeIsEmpty) {
      conflicts.push({ field, kind: 'empty_range', minimum: minimumBound!, maximum: maximumBound! });
    }

    const equalities = conditions.filter((condition) => condition.operator === 'eq');
    const values = [...new Set(equalities.map((condition) => condition.value))]
      .sort((a, b) => String(a).localeCompare(String(b)));
    if (values.length > 1) {
      conflicts.push({ field, kind: 'multiple_equalities', values });
    }
    const equality = values[0];
    if (
      typeof equality === 'number' &&
      (equality < minimum || equality > maximum ||
        (equality === minimum && numericLower.some((condition) => condition.operator === 'gt')) ||
        (equality === maximum && numericUpper.some((condition) => condition.operator === 'lt')))
    ) {
      conflicts.push({ field, kind: 'equality_outside_range', value: equality,
        minimum: minimumBound, maximum: maximumBound });
    }
  }

  return conflicts;
}
