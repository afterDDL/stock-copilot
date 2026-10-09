// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCopilot } from './use-copilot';
import type { DataSnapshot, Strategy } from '../lib/domain/types';

const strategy: Strategy = {
  id: 'banks', version: 1, name: '银行股筛选', industry: 'bank',
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

describe('useCopilot', () => {
  it('submits intent and lets the user edit an AI-inferred threshold', async () => {
    const intentRequest = vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest, snapshotRequest: vi.fn() }));
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
    const snapshotRequest = vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: {}, liveRequests: [] } });
    const { result } = renderHook(() => useCopilot({ intentRequest, snapshotRequest }));
    act(() => result.current.actions.setDraft('找大市值银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.conflicts).toHaveLength(1);
    expect(result.current.actions.canRun).toBe(false);
    act(() => result.current.actions.fixConflict(result.current.conflicts[0], 'remove_upper'));
    expect(result.current.conflicts).toHaveLength(0);
    expect(result.current.actions.canRun).toBe(true);
    await act(async () => result.current.actions.runScreen());
    expect(snapshotRequest).toHaveBeenCalledTimes(1);
    expect(result.current.result?.included.map((item) => item.stock.code)).toEqual(['600000']);
    act(() => result.current.actions.updateCondition(1, { value: 200_000_000_000 }));
    await act(async () => result.current.actions.runScreen());
    expect(snapshotRequest).toHaveBeenCalledTimes(1);
    expect(result.current.diff).toMatchObject({ added: [], retained: [], removed: ['600000'] });
  });

  it('does not enable screening until a clarification has been answered', async () => {
    const intentRequest = vi.fn()
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: ['你希望按哪一个报告期筛选？'], unsupportedRequests: [], canExecute: false })
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const { result } = renderHook(() => useCopilot({ intentRequest, snapshotRequest: vi.fn() }));
    act(() => result.current.actions.setDraft('筛银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.actions.canRun).toBe(false);
    act(() => result.current.actions.answerClarification(0, '按2026年中报'));
    await waitFor(() => expect(intentRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.actions.canRun).toBe(true));
    expect(result.current.clarification).toBeNull();
  });

  it('keeps the submitted draft available after a recoverable intent error', async () => {
    const intentRequest = vi.fn().mockRejectedValue(new Error('服务暂不可用'));
    const { result } = renderHook(() => useCopilot({ intentRequest }));
    act(() => result.current.actions.setDraft('筛选利润增长的银行股'));
    await act(async () => result.current.actions.submitIntent());
    expect(result.current.draft).toBe('筛选利润增长的银行股');
    expect(result.current.error).toBe('服务暂不可用');
  });

  it('restores a saved strategy without carrying a stale snapshot or screening result', async () => {
    const storage = { list: () => [], save: vi.fn(), load: vi.fn().mockReturnValue(strategy), delete: vi.fn() };
    const { result } = renderHook(() => useCopilot({
      storage,
      intentRequest: vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true }),
      snapshotRequest: vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: {}, liveRequests: [] } }),
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
