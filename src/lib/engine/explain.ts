import { INDICATOR_META } from '../domain/types';
import type { Condition, Indicator } from '../domain/types';

function displayValue(field: Indicator, value: number | string): string {
  if (field === 'market_cap_cny' && typeof value === 'number') {
    const hundredMillion = value / 100_000_000;
    return `${Number.isInteger(hundredMillion) ? hundredMillion : Number(hundredMillion.toFixed(2))} 亿元`;
  }
  return `${value}${field === 'net_profit_parent_yoy_pct' ? '%' : ''}`;
}

function relation(condition: Condition): string {
  switch (condition.operator) {
    case 'gt': return '大于';
    case 'gte': return '不低于';
    case 'lt': return '小于';
    case 'lte': return '不高于';
    case 'eq': return '等于';
  }
}

export function explainCondition(
  condition: Condition,
  actual: number | string | null,
  date: string | null,
): string {
  const { label } = INDICATOR_META[condition.field];
  const dateText = date ? `（数据日期：${date}）` : '';
  if (actual === null) {
    return `${label}缺少数据${dateText}，无法判定。`;
  }
  if (condition.field === 'industry') {
    return `${label}为 ${actual}${dateText}。`;
  }
  const actualText = displayValue(condition.field, actual);
  const thresholdText = displayValue(condition.field, condition.value);
  return `${label}为 ${actualText}，${relation(condition)}门槛 ${thresholdText}${dateText}。`;
}
