// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStrategyStorage } from './strategies';
import type { Strategy } from '../domain/types';

const strategy: Strategy = {
  id: 'active', version: 3, name: '银行股', industry: 'bank',
  conditions: [{ field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '基础范围', aiInferred: false, editable: false }],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};

describe('saved strategy storage', () => {
  it('persists only validated strategies and can load or delete by stable entry id', () => {
    const storage = createStrategyStorage(window.localStorage);
    const saved = storage.save(strategy, '自定义银行策略');
    expect(storage.list()).toHaveLength(1);
    expect(storage.load(saved.id)).toMatchObject({ name: '自定义银行策略', version: 3 });
    expect(storage.delete(saved.id)).toBe(true);
    expect(storage.list()).toEqual([]);
  });

  it('ignores malformed storage without throwing and reports unavailable writes', () => {
    window.localStorage.setItem('stock-copilot:saved-strategies:v1', '{broken');
    const storage = createStrategyStorage(window.localStorage);
    expect(storage.list()).toEqual([]);
    const unavailable = createStrategyStorage({
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    });
    expect(() => unavailable.save(strategy, '保存失败')).toThrow('quota');
  });

  it('updates an existing entry in place without changing its saved identity', () => {
    const storage = createStrategyStorage(window.localStorage);
    const first = storage.save(strategy, '我的策略');
    const updated = storage.save({ ...strategy, version: 4 }, '我的策略', first.id);
    expect(updated.id).toBe(first.id);
    expect(storage.list()).toHaveLength(1);
    expect(storage.load(first.id)?.version).toBe(4);
  });

  it('rejects a saved-strategy envelope from an unsupported schema version', () => {
    const storage = createStrategyStorage(window.localStorage);
    storage.save(strategy, '保留策略');
    const envelope = JSON.parse(window.localStorage.getItem('stock-copilot:saved-strategies:v1') ?? '{}');
    envelope.schemaVersion = 2;
    window.localStorage.setItem('stock-copilot:saved-strategies:v1', JSON.stringify(envelope));
    expect(createStrategyStorage(window.localStorage).list()).toEqual([]);
  });
});
