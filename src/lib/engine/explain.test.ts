import { describe, expect, it } from 'vitest';
import { explainCondition } from './explain';
import type { Condition } from '../domain/types';

describe('explainCondition', () => {
  it('converts canonical yuan to 亿元 while retaining the source date and expression', () => {
    const condition: Condition = {
      field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元',
      statisticDate: '2026-10-09', sourceExpression: '总市值[20261009]', aiInferred: true, editable: true,
    };

    expect(explainCondition(condition, 125_000_000_000, '2026-10-09')).toBe(
      '总市值为 1250 亿元，不低于门槛 1000 亿元（数据日期：2026-10-09）。',
    );
  });

  it('explains a missing metric as unavailable without calling it a failed condition', () => {
    expect(explainCondition({
      field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%',
      statisticDate: '2026-06-30', sourceExpression: '归母净利润同比增长率[20260630]',
      aiInferred: false, editable: true,
    }, null, '2026-06-30')).toBe('归母净利润同比增长率缺少数据（数据日期：2026-06-30），无法判定。');
  });
});
