import { describe, expect, it } from 'vitest';
import { resolveIntent } from './resolver';
import { executableMetrics } from './registry';
import { evaluateIntentCorpus, intentEvalCorpus } from './eval';
import type { Strategy } from '../domain/types';

const strategy: Strategy = {
  id: 'banks', version: 2, name: '银行股筛选', industry: 'bank',
  conditions: [
    { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股', aiInferred: false, editable: false },
    { field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '盘子大一点', aiInferred: true, editable: true },
    { field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '业绩还在增长', aiInferred: false, editable: true },
  ],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};

describe('financial mapping resolver', () => {
  it('allows execution only for the three verified and executable registry fields', () => {
    expect(executableMetrics().map((metric) => metric.id).sort()).toEqual([
      'industry', 'market_cap_cny', 'net_profit_parent_yoy_pct',
    ]);
  });

  it('keeps fast profit growth as a preference without creating a profit threshold', () => {
    const resolved = resolveIntent('利润增长快的优先', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(resolved.strategy.conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct')).toBe(false);
    expect(resolved.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
    expect(resolved.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ concept: 'profit_growth', state: 'confirmed', action: 'preference', originalExpression: '利润增长快的优先' }),
    ]));
    const existing = resolveIntent('利润增长快的优先', strategy, { currentStrategy: strategy });
    expect(existing.strategy.conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct' && condition.value === 0)).toBe(true);
    expect(existing.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
    const vagueSpeedPreference = resolveIntent('业绩增长快的优先', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(vagueSpeedPreference.strategy.conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct')).toBe(false);
    expect(vagueSpeedPreference.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
  });

  it('resolves explicit profit thresholds and can pair a threshold with a separate sort preference', () => {
    const resolved = resolveIntent('归母净利润同比至少10%', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(resolved.strategy.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'net_profit_parent_yoy_pct', operator: 'gte', value: 10 }),
    ]));
    const paired = resolveIntent('业绩还在增长，利润增长越快越好', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(paired.strategy.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0 }),
    ]));
    expect(paired.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
  });

  it('applies a verified multi-round profit threshold expressed as setting a threshold', () => {
    const candidate = {
      ...strategy,
      version: strategy.version + 1,
      conditions: strategy.conditions.map((item) => item.field === 'net_profit_parent_yoy_pct'
        ? { ...item, operator: 'gte' as const, value: 10, sourceExpression: '归母净利润同比门槛设为10%' }
        : item),
    };
    const resolved = resolveIntent('把归母净利润同比门槛设为10%', candidate, { currentStrategy: strategy });
    expect(resolved.strategy.conditions.find((item) => item.field === 'net_profit_parent_yoy_pct')).toMatchObject({ operator: 'gte', value: 10 });
    expect(resolved.mappings).toEqual(expect.arrayContaining([expect.objectContaining({ concept: 'profit_growth', action: 'patch' })]));
    expect(resolved.canExecute).toBe(true);
  });

  it('applies a market-cap patch and an explicit profit descending sort in the same turn', () => {
    const current = { ...strategy, sort: { field: 'market_cap_cny' as const, direction: 'desc' as const } };
    const resolved = resolveIntent('总市值2000亿元以上，利润增长降序排序', current, { currentStrategy: current });
    expect(resolved.strategy.conditions.find((item) => item.field === 'market_cap_cny')).toMatchObject({ operator: 'gte', value: 200_000_000_000 });
    expect(resolved.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
    expect(resolved.canExecute).toBe(true);
  });

  it('consumes the complete supported bank request without flagging filler or treating growth speed as a threshold', () => {
    const resolved = resolveIntent('帮我找些盘子大、业绩还在增长的银行股，利润增长越快越好。', {
      ...strategy, conditions: [strategy.conditions[0]],
    });
    expect(resolved.unsupportedRequests).toEqual([]);
    expect(resolved.strategy.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000 }),
      expect.objectContaining({ field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0 }),
    ]));
    expect(resolved.strategy.sort).toEqual({ field: 'net_profit_parent_yoy_pct', direction: 'desc' });
    expect(resolved.canExecute).toBe(true);
  });

  it('clarifies vague tightening without silently changing an existing threshold', () => {
    const resolved = resolveIntent('再严格一点', strategy, { currentStrategy: strategy });
    expect(resolved.strategy).toEqual(strategy);
    expect(resolved.clarifications.length).toBeGreaterThan(0);
    expect(resolved.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'needs_clarification', originalExpression: '再严格一点' }),
    ]));
    expect(resolved.canExecute).toBe(false);
  });

  it('does not substitute price, valuation or stability language with market cap or profit growth', () => {
    const resolved = resolveIntent('股价低一些而且稳一点', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(resolved.strategy.conditions.map((condition) => condition.field)).toEqual(['industry']);
    expect(resolved.unsupportedRequests.map((item) => item.request)).toEqual(['股价低一些']);
    expect(resolved.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ concept: 'price_stability', state: 'needs_clarification' }),
    ]));
    expect(resolved.canExecute).toBe(false);
  });

  it('retains an explicit verified condition while blocking an accompanying unsupported request', () => {
    const resolved = resolveIntent('总市值300亿元以上，股价低一些', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(resolved.strategy.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'market_cap_cny', operator: 'gte', value: 30_000_000_000 }),
    ]));
    expect(resolved.unsupportedRequests).toHaveLength(1);
    expect(resolved.canExecute).toBe(false);
  });

  it('discards a model-proposed size field when the user expressed an unrelated vague performance concept', () => {
    const resolved = resolveIntent('业绩好一点', strategy);
    expect(resolved.strategy.conditions.map((condition) => condition.field)).toEqual(['industry']);
    expect(resolved.clarifications).toHaveLength(1);
    expect(resolved.canExecute).toBe(false);
  });

  it('applies the local threshold patch without losing the original expression', () => {
    const resolved = resolveIntent('两千亿以下的不要了', strategy);
    expect(resolved.strategy.conditions.find((condition) => condition.field === 'market_cap_cny')).toMatchObject({
      operator: 'gte', value: 200_000_000_000, sourceExpression: '两千亿以下的不要了',
    });
  });

  it('deletes the profit constraint and applies a preference-only profit sort patch', () => {
    const deleted = resolveIntent('利润条件删掉', strategy);
    expect(deleted.strategy.conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct')).toBe(false);
    const sorted = resolveIntent('利润增长快的排前面', { ...strategy, conditions: [strategy.conditions[0]] });
    expect(sorted.strategy.conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct')).toBe(false);
    expect(sorted.strategy.sort.direction).toBe('desc');
  });

  it('restores the explicit previous strategy version', () => {
    const previous = { ...strategy, version: 1, conditions: [strategy.conditions[0]] };
    const resolved = resolveIntent('还是上次的策略', strategy, { previousStrategy: previous });
    expect(resolved.strategy.conditions).toEqual(previous.conditions);
    expect(resolved.strategy.version).toBe(3);
    expect(resolved.mappings[0]).toMatchObject({ action: 'restore', state: 'confirmed' });
  });

  it('exposes the 20 manually specified core cases as separate semantic evaluation dimensions', () => {
    const report = evaluateIntentCorpus();
    expect(report.total).toBe(20);
    expect(report.cases.filter((item) => !item.passed)).toEqual([]);
    expect(report.passed).toBe(20);
    expect(report.cases).toHaveLength(20);
    expect(report.cases[0]).toMatchObject({
      id: 'core-01', checks: expect.objectContaining({ concept: true, conditionPreference: true, direction: true, mapping: true, action: true, conflictPatch: true }),
    });
  });

  it('fails an eval when the corpus expectation changes instead of keying only on its case id', () => {
    const baseline = evaluateIntentCorpus().cases.find((item) => item.id === 'core-01');
    expect(baseline?.passed).toBe(true);
    const sourceCase = intentEvalCorpus.find((item) => item.id === 'core-01');
    expect(sourceCase).toBeDefined();
    const mutated = {
      ...sourceCase!,
      expected: {
        ...sourceCase!.expected,
        conditionPreference: 'hard company_size via market_cap_cny >= 200000000000 CNY',
        conflictPatch: true,
      },
    };
    const report = evaluateIntentCorpus([mutated]);
    expect(report.passed).toBe(0);
    expect(report.cases[0]?.checks.conditionPreference).toBe(false);
    expect(report.cases[0]?.checks.conflictPatch).toBe(false);
  });
});
