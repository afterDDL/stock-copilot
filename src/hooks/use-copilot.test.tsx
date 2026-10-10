// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCopilot } from './use-copilot';
import type { DataSnapshot, Strategy } from '../lib/domain/types';

const strategy: Strategy = {
  id: 'banks', version: 1, name: '银行股筛选', market: 'cn_a',
  conditions: [
    { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股', aiInferred: false, editable: false },
    { field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '总市值至少1000亿元', aiInferred: true, editable: true },
  ],
  sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};

const snapshot: DataSnapshot = {
  snapshotId: 'snapshot-1', source: 'historical', asOf: '2026-10-09',
  stocks: [{ code: '600000', name: '浦发银行', industry: '银行', metrics: {
    industry: { value: '银行', unit: '行业', date: null, source: 'historical', coverage: 'available' },
    market_cap_cny: { value: 110_000_000_000, unit: '元', date: '2026-10-09', source: 'historical', coverage: 'available' },
    net_profit_parent_yoy_pct: { value: 4, unit: '%', date: '2026-06-30', source: 'historical', coverage: 'available' },
  } }],
  coverage: { expectedStocks: 1, returnedStocks: 1, complete: true, metrics: {
    industry: { available: 1, missing: 0 }, market_cap_cny: { available: 1, missing: 0 }, net_profit_parent_yoy_pct: { available: 1, missing: 0 },
  } },
};
const envelope = (value: DataSnapshot) => ({ mode: 'live' as const, snapshot: value, coverage: value.coverage, evidence: { source: 'iFinD', capturedAt: '2026-10-10T00:00:00Z', statisticDates: {}, liveRequests: [] } });

afterEach(() => vi.restoreAllMocks());

describe('useCopilot', () => {
  it('submits intent and lets the user edit an AI-inferred threshold', async () => {
    const intentRequest = vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest, stockSearchRequest: vi.fn() }));
    act(() => result.current.actions.setDraft('找市值至少1000亿元的银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(intentRequest).toHaveBeenCalledWith('找市值至少1000亿元的银行股', undefined);
    expect(result.current.strategy?.conditions[1].aiInferred).toBe(true);
    act(() => result.current.actions.updateCondition(1, { value: 200_000_000_000 }));
    expect(result.current.strategy?.conditions[1].value).toBe(200_000_000_000);
  });

  it('blocks conflicts, applies a concrete repair, and reruns against the retained snapshot', async () => {
    const conflicting: Strategy = { ...strategy, conditions: [...strategy.conditions,
      { ...strategy.conditions[1], operator: 'lte', value: 50_000_000_000, sourceExpression: '上限500亿元' },
    ] };
    const intentRequest = vi.fn().mockResolvedValue({ strategy: conflicting, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const stockSearchRequest = vi.fn().mockResolvedValueOnce(envelope(snapshot)).mockResolvedValueOnce(envelope({ ...snapshot, snapshotId: 'snapshot-2' }));
    const { result } = renderHook(() => useCopilot({ intentRequest, stockSearchRequest }));
    act(() => result.current.actions.setDraft('找大市值银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.conflicts).toHaveLength(1);
    expect(result.current.actions.canRun).toBe(false);
    act(() => result.current.actions.fixConflict(result.current.conflicts[0], 'remove_upper'));
    expect(result.current.conflicts).toHaveLength(0);
    expect(result.current.actions.canRun).toBe(true);
    await act(async () => result.current.actions.runScreen());
    expect(stockSearchRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({ conditions: expect.not.arrayContaining([expect.objectContaining({ field: 'market_cap_cny', operator: 'lte', value: 50_000_000_000 })]) }));
    expect(result.current.result?.included.map((item) => item.stock.code)).toEqual(['600000']);
    act(() => result.current.actions.updateCondition(1, { value: 200_000_000_000 }));
    await act(async () => result.current.actions.runScreen());
    expect(stockSearchRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({ conditions: expect.not.arrayContaining([expect.objectContaining({ field: 'market_cap_cny', value: 100_000_000_000 })]) }));
    expect(stockSearchRequest).toHaveBeenCalledTimes(2);
    expect(result.current.diff).toMatchObject({ added: [], retained: [], removed: ['600000'] });
  });

  it('keeps multiple clarifications tied to the original query and resubmits explicit answers with currentStrategy', async () => {
    const intentRequest = vi.fn()
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: ['使用哪个报告期？', '总市值最低门槛是多少？'], unsupportedRequests: [], canExecute: false })
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest, stockSearchRequest: vi.fn() }));
    act(() => result.current.actions.setDraft('筛银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.actions.canRun).toBe(false);
    expect(result.current.clarification?.prompts).toHaveLength(2);
    act(() => result.current.actions.answerClarification(0, '2026年中报'));
    expect(intentRequest).toHaveBeenCalledTimes(1);
    act(() => result.current.actions.answerClarification(1, '至少1000亿元'));
    await act(async () => result.current.actions.submitClarification());
    expect(intentRequest).toHaveBeenNthCalledWith(2,
      '筛银行股\n\n澄清回答：\n- 使用哪个报告期？：2026年中报\n- 总市值最低门槛是多少？：至少1000亿元', strategy);
    await waitFor(() => expect(result.current.actions.canRun).toBe(true));
    expect(result.current.clarification).toBeNull();
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: '筛银行股' });
  });

  it('removes the strongest contradictory upper bound, even when bounds are reordered', async () => {
    const conditions = [
      strategy.conditions[0],
      { ...strategy.conditions[1], operator: 'gte' as const, value: 120_000_000_000, sourceExpression: '弱下限' },
      { ...strategy.conditions[1], operator: 'lte' as const, value: 90_000_000_000, sourceExpression: '冲突上限' },
      { ...strategy.conditions[1], operator: 'gte' as const, value: 150_000_000_000, sourceExpression: '冲突下限' },
      { ...strategy.conditions[1], operator: 'lte' as const, value: 200_000_000_000, sourceExpression: '弱上限' },
    ];
    const intentRequest = vi.fn().mockResolvedValue({ strategy: { ...strategy, conditions }, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('筛银行股'));
    await act(async () => result.current.actions.submitIntent());
    const rangeConflict = result.current.conflicts.find((conflict) => conflict.kind === 'empty_range')!;
    act(() => result.current.actions.fixConflict(rangeConflict, 'remove_upper'));
    expect(result.current.strategy?.conditions.some((condition) => condition.sourceExpression === '冲突上限')).toBe(false);
    expect(result.current.strategy?.conditions.some((condition) => condition.sourceExpression === '弱上限')).toBe(true);
    expect(result.current.conflicts).toEqual([]);
  });

  it('removes the strongest contradictory lower bound rather than a weaker array-last bound', async () => {
    const conditions = [
      strategy.conditions[0],
      { ...strategy.conditions[1], operator: 'lte' as const, value: 130_000_000_000, sourceExpression: '上限' },
      { ...strategy.conditions[1], operator: 'gte' as const, value: 150_000_000_000, sourceExpression: '冲突下限' },
      { ...strategy.conditions[1], operator: 'gte' as const, value: 120_000_000_000, sourceExpression: '弱下限' },
    ];
    const intentRequest = vi.fn().mockResolvedValue({ strategy: { ...strategy, conditions }, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('筛银行股'));
    await act(async () => result.current.actions.submitIntent());
    const rangeConflict = result.current.conflicts.find((conflict) => conflict.kind === 'empty_range')!;
    act(() => result.current.actions.fixConflict(rangeConflict, 'remove_lower'));
    expect(result.current.strategy?.conditions.some((condition) => condition.sourceExpression === '冲突下限')).toBe(false);
    expect(result.current.strategy?.conditions.some((condition) => condition.sourceExpression === '弱下限')).toBe(true);
    expect(result.current.conflicts).toEqual([]);
  });

  it('removes the equality value reported outside the surviving range', async () => {
    const conditions = [
      strategy.conditions[0],
      { ...strategy.conditions[1], operator: 'eq' as const, value: 10_000_000_000, sourceExpression: '超界相等' },
      { ...strategy.conditions[1], operator: 'lte' as const, value: 30_000_000_000, sourceExpression: '合理上限' },
      { ...strategy.conditions[1], operator: 'eq' as const, value: 20_000_000_000, sourceExpression: '合理相等' },
      { ...strategy.conditions[1], operator: 'gte' as const, value: 15_000_000_000, sourceExpression: '合理下限' },
    ];
    const intentRequest = vi.fn().mockResolvedValue({ strategy: { ...strategy, conditions }, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('筛银行股'));
    await act(async () => result.current.actions.submitIntent());
    const equalityConflict = result.current.conflicts.find((conflict) => conflict.kind === 'equality_outside_range')!;
    expect(equalityConflict.value).toBe(10_000_000_000);
    act(() => result.current.actions.fixConflict(equalityConflict, 'remove_equality'));
    expect(result.current.strategy?.conditions.some((condition) => condition.sourceExpression === '超界相等')).toBe(false);
    expect(result.current.strategy?.conditions.some((condition) => condition.sourceExpression === '合理相等')).toBe(true);
    expect(result.current.conflicts).toEqual([]);
  });

  it('keeps the deterministic canonical equality and removes all other reported equalities', async () => {
    const conditions = [
      strategy.conditions[0],
      { ...strategy.conditions[1], operator: 'eq' as const, value: 30_000_000_000, sourceExpression: '等于30' },
      { ...strategy.conditions[1], operator: 'eq' as const, value: 10_000_000_000, sourceExpression: '等于10' },
      { ...strategy.conditions[1], operator: 'eq' as const, value: 20_000_000_000, sourceExpression: '等于20' },
    ];
    const intentRequest = vi.fn().mockResolvedValue({ strategy: { ...strategy, conditions }, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('筛银行股'));
    await act(async () => result.current.actions.submitIntent());
    const multipleConflict = result.current.conflicts.find((conflict) => conflict.kind === 'multiple_equalities')!;
    act(() => result.current.actions.fixConflict(multipleConflict, 'remove_equality'));
    expect(result.current.strategy?.conditions.filter((condition) => condition.field === 'market_cap_cny' && condition.operator === 'eq').map((condition) => condition.value)).toEqual([10_000_000_000]);
    expect(result.current.conflicts).toEqual([]);
  });

  it('keeps the submitted draft available after a recoverable intent error', async () => {
    const intentRequest = vi.fn().mockRejectedValue(new Error('服务暂不可用'));
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('筛选利润增长的银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.draft).toBe('筛选利润增长的银行股');
    expect(result.current.error).toBe('服务暂不可用');
  });

  it('keeps the last successful result and the current draft when a fresh market query fails', async () => {
    const failure = new Error('结果较多，请补充行业或提高筛选门槛。');
    const stockSearchRequest = vi.fn().mockResolvedValueOnce(envelope(snapshot)).mockRejectedValueOnce(failure);
    const intentRequest = vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest, stockSearchRequest }));
    act(() => result.current.actions.setDraft('利润仍在增长'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());
    const successfulResult = result.current.result;
    const successfulQuery = result.current.successfulQuery;
    act(() => result.current.actions.setDraft('改查新能源行业'));
    act(() => result.current.actions.updateCondition(1, { value: 200_000_000_000 }));
    await act(async () => result.current.actions.runScreen());
    expect(stockSearchRequest).toHaveBeenCalledTimes(2);
    expect(result.current.result).toBe(successfulResult);
    expect(result.current.successfulQuery).toBe(successfulQuery);
    expect(result.current.resultStrategy?.conditions[1].value).toBe(100_000_000_000);
    expect(result.current.strategy?.conditions[1].value).toBe(200_000_000_000);
    expect(result.current.resultIsStale).toBe(true);
    act(() => result.current.actions.rebaseDiff());
    expect(result.current.previousStrategy?.conditions[1].value).toBe(100_000_000_000);
    expect(result.current.snapshot?.snapshotId).toBe(snapshot.snapshotId);
    expect(result.current.draft).toBe('改查新能源行业');
    expect(result.current.error).toBe('结果较多，请补充行业或提高筛选门槛。');
  });

  it('shows the concise account notice from a quota failure without exposing provider details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'data_unavailable', message: 'iFinD 账号调用额度已用完，当前无法获取实时数据。' } }), { status: 503 }));
    const { result } = renderHook(() => useCopilot({ intentRequest: async () => ({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true }) }));
    act(() => result.current.actions.setDraft('银行股'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());
    expect(result.current.error).toBe('iFinD 账号调用额度已用完，当前无法获取实时数据。');
    expect(result.current.result).toBeNull();
  });

  it('POSTs the current strategy to stock-search on each run and maps needs_narrowing to concise copy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope(snapshot)), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'needs_narrowing', message: 'internal truncation detail' } }), { status: 422, headers: { 'content-type': 'application/json' } }));
    const intentRequest = vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('找利润仍在增长的股票'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());
    const successfulResult = result.current.result;
    act(() => result.current.actions.updateCondition(1, { value: 200_000_000_000 }));
    await act(async () => result.current.actions.runScreen());

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchSpy.mock.calls) {
      expect(url).toBe('/api/stock-search');
      expect(options?.method).toBe('POST');
      expect(JSON.parse(String(options?.body))).toEqual({ strategy: expect.objectContaining({ market: 'cn_a' }) });
    }
    expect(result.current.result).toBe(successfulResult);
    expect(result.current.error).toBe('结果较多，请补充行业或提高筛选门槛。');
    expect(result.current.error).not.toContain('internal truncation detail');
  });

  it('keeps the first successful result as the comparison baseline after submitting a changed intent', async () => {
    const changedStrategy = { ...strategy, conditions: strategy.conditions.map((condition) => condition.field === 'market_cap_cny' ? { ...condition, value: 200_000_000_000 } : condition) };
    const intentRequest = vi.fn()
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })
      .mockResolvedValueOnce({ strategy: changedStrategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const stockSearchRequest = vi.fn().mockResolvedValueOnce(envelope(snapshot)).mockResolvedValueOnce(envelope({ ...snapshot, snapshotId: 'snapshot-2' }));
    const { result } = renderHook(() => useCopilot({ intentRequest, stockSearchRequest }));

    act(() => result.current.actions.setDraft('找市值至少1000亿元的股票'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());
    const firstResult = result.current.result;
    act(() => result.current.actions.setDraft('提高门槛到2000亿元'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.result).toBe(firstResult);
    await act(async () => result.current.actions.runScreen());

    expect(result.current.previousResult).toBe(firstResult);
    expect(result.current.result?.included).toHaveLength(0);
    expect(result.current.diff).toMatchObject({ added: [], retained: [], removed: ['600000'] });
  });

  it('keeps the first result visible and restores the changed-intent draft when its search fails', async () => {
    const changedStrategy = { ...strategy, conditions: strategy.conditions.map((condition) => condition.field === 'market_cap_cny' ? { ...condition, value: 200_000_000_000 } : condition) };
    const intentRequest = vi.fn()
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })
      .mockResolvedValueOnce({ strategy: changedStrategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const stockSearchRequest = vi.fn().mockResolvedValueOnce(envelope(snapshot)).mockRejectedValueOnce(new Error('结果较多，请补充行业或提高筛选门槛。'));
    const { result } = renderHook(() => useCopilot({ intentRequest, stockSearchRequest }));

    act(() => result.current.actions.setDraft('找市值至少1000亿元的股票'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());
    const firstResult = result.current.result;
    act(() => result.current.actions.setDraft('提高门槛到2000亿元'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());

    expect(result.current.result).toBe(firstResult);
    expect(result.current.snapshot?.snapshotId).toBe(snapshot.snapshotId);
    expect(result.current.draft).toBe('提高门槛到2000亿元');
    expect(result.current.error).toBe('结果较多，请补充行业或提高筛选门槛。');
  });

  it('restores a saved strategy without carrying a stale snapshot or screening result', async () => {
    const storage = { list: () => [], save: vi.fn(), load: vi.fn().mockReturnValue(strategy), delete: vi.fn() };
    const { result } = renderHook(() => useCopilot({
      storage,
      intentRequest: vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true }),
      stockSearchRequest: vi.fn().mockResolvedValue(envelope(snapshot)),
    }));
    act(() => result.current.actions.setDraft('银行股'));
    await act(async () => result.current.actions.submitIntent());
    await act(async () => result.current.actions.runScreen());
    expect(result.current.result).not.toBeNull();
    act(() => result.current.actions.loadStrategy('saved-id'));
    expect(result.current.strategy?.version).toBe(2);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.diff).toBeNull();
  });
});
