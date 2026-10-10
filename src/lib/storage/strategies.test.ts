// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStrategyStorage } from './strategies';
import type { Strategy } from '../domain/types';

const strategy: Strategy = {
  id: 'active', version: 3, name: '银行股', market: 'cn_a',
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

  it('migrates a legacy saved bank strategy and preserves its bank condition', () => {
    const legacy = {
      id: 'legacy-bank', version: 2, name: '历史银行策略', industry: 'bank',
      conditions: [
        { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股基础范围', aiInferred: false, editable: false },
        { field: 'market_cap_cny', operator: 'gte', value: 100000000000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '盘子大', aiInferred: true, editable: true },
      ],
      sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
    };
    window.localStorage.setItem('stock-copilot:saved-strategies:v1', JSON.stringify({
      schemaVersion: 1,
      entries: [{ id: 'legacy-entry', name: '历史银行策略', strategy: legacy, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }],
    }));

    const migrated = createStrategyStorage(window.localStorage).load('legacy-entry');

    expect(migrated?.market).toBe('cn_a');
    expect(migrated?.conditions.find((condition) => condition.field === 'industry')?.value).toBe('银行');
    expect(migrated && 'industry' in migrated).toBe(false);
  });

  it('reports malformed data and unavailable localStorage as non-blocking warnings', () => {
    const malformed = createStrategyStorage(window.localStorage);
    window.localStorage.setItem('stock-copilot:saved-strategies:v1', '{broken');
    expect(malformed.list()).toEqual([]);
    expect(malformed.warning()).toMatch(/无法读取|无效/);
    const inaccessible = createStrategyStorage({
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(inaccessible.list()).toEqual([]);
    expect(inaccessible.warning()).toMatch(/暂不可用|无法访问/);
  });
});
