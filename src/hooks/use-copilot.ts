'use client';

import { useCallback, useMemo, useState } from 'react';
import { dataSnapshotSchema, strategySchema } from '../lib/domain/schema';
import type { Condition, DataSnapshot, ScreeningDiff, ScreeningResult, Strategy, StrategyConflict } from '../lib/domain/types';
import { detectConflicts } from '../lib/engine/conflicts';
import { diffResults } from '../lib/engine/diff';
import { screenUniverse } from '../lib/engine/screen';
import { createStrategyStorage } from '../lib/storage/strategies';
import type { StrategyStorage } from '../lib/storage/strategies';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; kind?: 'normal' | 'error' };
export type Clarification = { id: string; prompt: string; options: Array<{ id: string; label: string }> };
export type SnapshotEnvelope = {
  mode: 'live' | 'historical'; snapshot: DataSnapshot; coverage: DataSnapshot['coverage'];
  evidence: { source: string; capturedAt: string; statisticDates: Record<string, string | null>; liveRequests: unknown[] };
  error?: string;
};
export type IntentEnvelope = {
  strategy: Strategy; assumptions: string[]; clarifications: string[];
  unsupportedRequests: Array<{ request: string; reason: string }>; canExecute: boolean;
};
type Options = {
  intentRequest?: (query: string, currentStrategy?: Strategy) => Promise<IntentEnvelope | { intent: IntentEnvelope }>;
  snapshotRequest?: () => Promise<SnapshotEnvelope>;
  storage?: Pick<StrategyStorage, 'list' | 'save' | 'load' | 'delete'>;
};
type Tab = 'included' | 'excluded' | 'unknown';

async function requestIntent(query: string, currentStrategy?: Strategy): Promise<IntentEnvelope> {
  const response = await fetch('/api/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, ...(currentStrategy ? { currentStrategy } : {}) }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? '意图解析失败，请重试。');
  return body.intent as IntentEnvelope;
}
async function requestSnapshot(): Promise<SnapshotEnvelope> {
  const response = await fetch('/api/bank-snapshot');
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? '暂时无法获取银行股数据，请重试。');
  const snapshot = dataSnapshotSchema.parse(body.snapshot);
  return { ...body, snapshot } as SnapshotEnvelope;
}
function normalizeIntent(value: IntentEnvelope | { intent: IntentEnvelope }): IntentEnvelope {
  return 'intent' in value ? value.intent : value;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试。'; }
function copyStrategy(strategy: Strategy, version = strategy.version): Strategy {
  return { ...strategy, version, conditions: strategy.conditions.map((condition) => ({ ...condition })), sort: { ...strategy.sort } };
}

export function useCopilot(options: Options = {}) {
  const storage = useMemo(() => options.storage ?? createStrategyStorage(), [options.storage]);
  const [phase, setPhase] = useState<'empty' | 'intent_pending' | 'clarification_needed' | 'strategy_ready' | 'strategy_dirty' | 'conflict_blocked' | 'data_loading' | 'results_ready' | 'recoverable_error'>('empty');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [snapshot, setSnapshot] = useState<DataSnapshot | null>(null);
  const [snapshotEnvelope, setSnapshotEnvelope] = useState<SnapshotEnvelope | null>(null);
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [baselineResult, setBaselineResult] = useState<ScreeningResult | null>(null);
  const [baselineStrategy, setBaselineStrategy] = useState<Strategy | null>(null);
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [canExecute, setCanExecute] = useState(true);
  const [unsupportedItems, setUnsupportedItems] = useState<IntentEnvelope['unsupportedRequests']>([]);
  const [activeTab, setActiveTab] = useState<Tab>('included');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [compareCodes, setCompareCodes] = useState<[string | null, string | null]>([null, null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflicts = useMemo(() => strategy ? detectConflicts(strategy) : [], [strategy]);
  const diff: ScreeningDiff | null = useMemo(() => baselineResult && result && result !== baselineResult && baselineResult.snapshotId === result.snapshotId ? diffResults(baselineResult, result) : null, [baselineResult, result]);
  const isStrategyValid = strategy ? strategySchema.safeParse(strategy).success : false;
  const canRun = Boolean(isStrategyValid && strategy && canExecute && !clarification && unsupportedItems.length === 0 && conflicts.length === 0 && !busy);

  const setMessage = useCallback((text: string, role: ChatMessage['role'], kind: ChatMessage['kind'] = 'normal') => {
    setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, role, text, kind }]);
  }, []);
  const submitIntent = useCallback(async (override?: string, answer?: string) => {
    const query = (override ?? draft).trim();
    if (!query || busy) return;
    setBusy(true); setError(null); setPhase('intent_pending');
    if (!override) setMessage(query, 'user');
    setDraft('');
    try {
      const response = normalizeIntent(await (options.intentRequest ?? requestIntent)(query, strategy ?? undefined));
      const safeStrategy = strategySchema.parse(response.strategy);
      setStrategy(copyStrategy(safeStrategy));
      setCanExecute(response.canExecute);
      setUnsupportedItems(response.unsupportedRequests ?? []);
      setClarification(response.clarifications.length ? {
        id: 'clarification-0', prompt: response.clarifications[0], options: [
          { id: 'mid-2026', label: '按 2026 年中报' }, { id: 'annual-2025', label: '按 2025 年年报' }, { id: 'custom', label: '我再补充说明' },
        ],
      } : null);
      (response.assumptions ?? []).forEach((assumption) => setMessage(`已按此理解：${assumption}`, 'assistant'));
      if (response.unsupportedRequests?.length) response.unsupportedRequests.forEach((item) => setMessage(`暂不支持「${item.request}」：${item.reason}`, 'assistant', 'error'));
      if (response.clarifications.length) {
        response.clarifications.forEach((question) => setMessage(`需要确认：${question}`, 'assistant'));
        setPhase('clarification_needed');
      } else {
        setMessage('策略已准备好，你可以检查并编辑条件。', 'assistant');
        setPhase('strategy_ready');
      }
      setSnapshot(null); setSnapshotEnvelope(null); setResult(null); setBaselineResult(null); setSelectedCode(null); setCompareCodes([null, null]);
      setBaselineStrategy(null);
    } catch (cause) {
      const message = errorText(cause); setError(message); setMessage(message, 'assistant', 'error'); setPhase('recoverable_error'); setDraft(query);
    } finally { setBusy(false); }
    return answer;
  }, [busy, draft, options.intentRequest, setMessage, strategy]);
  const answerClarification = useCallback((optionId: number | string, answer?: string) => {
    const selected = clarification?.options.find((option) => option.id === String(optionId));
    const text = answer ?? selected?.label ?? String(optionId);
    if (!clarification) return;
    setMessage(text, 'user'); setClarification(null); setCanExecute(false);
    void submitIntent(`补充澄清：${clarification.prompt} ${text}`);
  }, [clarification, setMessage, submitIntent]);
  const updateStrategy = useCallback((update: (current: Strategy) => Strategy) => {
    setStrategy((current) => current ? copyStrategy(update(current), current.version + 1) : current);
    setPhase('strategy_dirty');
  }, []);
  const updateCondition = useCallback((index: number, patch: Partial<Condition>) => updateStrategy((current) => ({ ...current, conditions: current.conditions.map((condition, i) => i === index ? { ...condition, ...patch } : condition) })), [updateStrategy]);
  const fixConflict = useCallback((conflict: StrategyConflict, fix: string) => updateStrategy((current) => {
    const fields = current.conditions.map((condition, index) => ({ condition, index })).filter((item) => item.condition.field === conflict.field);
    if (fix === 'remove_upper' || fix === 'remove_lower') {
      const operators = fix === 'remove_upper' ? ['lt', 'lte'] : ['gt', 'gte'];
      const target = fields.findLast((item) => operators.includes(item.condition.operator));
      return { ...current, conditions: current.conditions.filter((_condition, index) => index !== target?.index) };
    }
    if (conflict.kind === 'empty_range') {
      const upper = fields.findLast((item) => item.condition.operator === 'lt' || item.condition.operator === 'lte');
      if (upper && Number.isFinite(conflict.minimum)) return { ...current, conditions: current.conditions.map((condition, index) => index === upper.index ? { ...condition, operator: 'lte', value: conflict.minimum } : condition) };
    }
    if (conflict.kind === 'equality_outside_range' || conflict.kind === 'multiple_equalities') {
      const equality = fields.findLast((item) => item.condition.operator === 'eq' && item.condition.field !== 'industry');
      if (equality) return { ...current, conditions: current.conditions.filter((_condition, index) => index !== equality.index) };
    }
    return current;
  }), [updateStrategy]);
  const runScreen = useCallback(async () => {
    if (!strategy || !canRun) return;
    setBusy(true); setError(null); setPhase('data_loading');
    try {
      let activeSnapshot = snapshot;
      let envelope = snapshotEnvelope;
      if (!activeSnapshot) {
        envelope = await (options.snapshotRequest ?? requestSnapshot)();
        activeSnapshot = dataSnapshotSchema.parse(envelope.snapshot);
        setSnapshot(activeSnapshot); setSnapshotEnvelope(envelope);
      }
      const next = screenUniverse(activeSnapshot, strategy);
      setResult(next);
      if (!baselineResult || baselineResult.snapshotId !== next.snapshotId) {
        setBaselineResult(next);
        setBaselineStrategy(copyStrategy(strategy));
      }
      setPhase('results_ready');
    } catch (cause) {
      const message = errorText(cause); setError(message); setMessage(message, 'assistant', 'error'); setPhase('recoverable_error');
    } finally { setBusy(false); }
  }, [baselineResult, canRun, options.snapshotRequest, setMessage, snapshot, snapshotEnvelope, strategy]);
  const setCompareCode = useCallback((slot: 0 | 1, code: string | null) => setCompareCodes((current) => {
    if (code && current[1 - slot] === code) return current;
    const next: [string | null, string | null] = [...current]; next[slot] = code; return next;
  }), []);
  const loadStrategy = useCallback((id: string) => {
    try {
      const restored = storage.load(id);
      if (!restored) throw new Error('找不到已保存的策略。');
      setStrategy(copyStrategy(restored, (strategy?.version ?? 0) + 1)); setSnapshot(null); setSnapshotEnvelope(null); setResult(null); setBaselineResult(null); setBaselineStrategy(null); setSelectedCode(null); setCompareCodes([null, null]); setClarification(null); setUnsupportedItems([]); setCanExecute(true); setPhase('strategy_ready'); setError(null); setMessage('已载入策略，请运行筛选以获取当前数据。', 'assistant');
    } catch (cause) { setError(errorText(cause)); }
  }, [setMessage, storage, strategy?.version]);
  const saveStrategy = useCallback((name?: string, id?: string) => {
    if (!strategy) return null;
    try { const saved = storage.save(strategy, name?.trim() || strategy.name, id); setMessage(`已保存策略「${saved.name}」。`, 'assistant'); setError(null); return saved; }
    catch (cause) { setError(errorText(cause)); return null; }
  }, [setMessage, storage, strategy]);
  const deleteStrategy = useCallback((id: string) => {
    try { storage.delete(id); setMessage('已删除保存的策略。', 'assistant'); setError(null); }
    catch (cause) { setError(errorText(cause)); }
  }, [setMessage, storage]);
  const updateConditionByField = useCallback((field: Condition['field'], patch: Partial<Condition>) => {
    const index = strategy?.conditions.findIndex((condition) => condition.field === field) ?? -1;
    if (index >= 0) updateCondition(index, patch);
  }, [strategy, updateCondition]);
  const addCondition = useCallback((field: Condition['field']) => updateStrategy((current) => {
    if (current.conditions.some((condition) => condition.field === field)) return current;
    const newCondition: Condition = field === 'industry'
      ? { field, operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '所属行业', aiInferred: false, editable: false }
      : { field, operator: 'gte', value: 0, unit: field === 'market_cap_cny' ? '元' : '%', statisticDate: field === 'market_cap_cny' ? '2026-10-09' : '2026-06-30', sourceExpression: '手动添加', aiInferred: false, editable: true };
    return { ...current, conditions: [...current.conditions, newCondition] };
  }), [updateStrategy]);
  const removeCondition = useCallback((index: number) => updateStrategy((current) => ({ ...current, conditions: current.conditions.filter((_condition, i) => i !== index) })), [updateStrategy]);

  return {
    phase, messages, draft, strategy, snapshot, snapshotEnvelope, result, baselineResult, previousStrategy: baselineStrategy, previousResult: baselineResult,
    conflicts, clarification, unsupportedItems, activeTab, selectedCode, compareCodes, diff, busy, error,
    actions: {
      setDraft, submitIntent, answerClarification, updateStrategy, updateCondition, updateConditionByField,
      addCondition, removeCondition, fixConflict, runScreen, setActiveTab, selectStock: setSelectedCode,
      setCompareCode, saveStrategy, loadStrategy, deleteStrategy, resetError: () => setError(null),
      rebaseDiff: () => { if (result && strategy) { setBaselineResult(result); setBaselineStrategy(copyStrategy(strategy)); } },
      canRun, canSave: Boolean(strategy && strategy.name.trim() && conflicts.length === 0),
    },
    savedStrategies: (() => { try { return storage.list(); } catch { return []; } })(),
  };
}
