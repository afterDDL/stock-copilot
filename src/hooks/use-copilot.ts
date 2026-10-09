'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataSnapshotSchema, strategySchema } from '../lib/domain/schema';
import type { Condition, DataSnapshot, ScreeningDiff, ScreeningResult, Strategy, StrategyConflict } from '../lib/domain/types';
import { detectConflicts } from '../lib/engine/conflicts';
import { diffResults } from '../lib/engine/diff';
import { screenUniverse } from '../lib/engine/screen';
import { createStrategyStorage } from '../lib/storage/strategies';
import type { ConditionMapping } from '../lib/mapping/resolver';
import type { SavedStrategySummary, StrategyStorage } from '../lib/storage/strategies';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; kind?: 'normal' | 'error' };
export type Clarification = { prompts: Array<{ id: string; prompt: string; answer: string }> };
export type SnapshotEnvelope = {
  mode: 'live' | 'historical'; snapshot: DataSnapshot; coverage: DataSnapshot['coverage'];
  evidence: { source: string; capturedAt: string; statisticDates: Record<string, string | null>; liveRequests: unknown[] };
  error?: string;
};
export type IntentEnvelope = {
  strategy: Strategy; assumptions: string[]; clarifications: string[];
  unsupportedRequests: Array<{ request: string; reason: string }>; canExecute: boolean;
  mappings?: ConditionMapping[];
};
type Options = {
  intentRequest?: (query: string, currentStrategy?: Strategy, previousStrategy?: Strategy) => Promise<IntentEnvelope | { intent: IntentEnvelope }>;
  snapshotRequest?: () => Promise<SnapshotEnvelope>;
  storage?: Pick<StrategyStorage, 'list' | 'save' | 'load' | 'delete'> & Partial<Pick<StrategyStorage, 'warning'>>;
};
type Tab = 'included' | 'excluded' | 'unknown';
type IntentContext = { originalQuery: string; answers: Array<{ prompt: string; answer: string }> };

async function requestIntent(query: string, currentStrategy?: Strategy, previousStrategy?: Strategy): Promise<IntentEnvelope> {
  const response = await fetch('/api/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, ...(currentStrategy ? { currentStrategy } : {}), ...(previousStrategy ? { previousStrategy } : {}) }) });
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
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategySummary[]>([]);
  const [savedStrategyWarning, setSavedStrategyWarning] = useState<string | null>(null);
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
  const [pendingIntentContext, setPendingIntentContext] = useState<IntentContext | null>(null);
  const [canExecute, setCanExecute] = useState(true);
  const [unsupportedItems, setUnsupportedItems] = useState<IntentEnvelope['unsupportedRequests']>([]);
  const [mappings, setMappings] = useState<ConditionMapping[]>([]);
  const [previousVersionStrategy, setPreviousVersionStrategy] = useState<Strategy | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('included');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [compareCodes, setCompareCodes] = useState<[string | null, string | null]>([null, null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshSavedStrategies = useCallback(() => {
    try {
      setSavedStrategies(storage.list());
      setSavedStrategyWarning(storage.warning?.() ?? null);
    } catch {
      setSavedStrategies([]);
      setSavedStrategyWarning('本地保存暂不可用，已保存的策略无法读取。');
    }
  }, [storage]);
  useEffect(() => { refreshSavedStrategies(); }, [refreshSavedStrategies]);
  const conflicts = useMemo(() => strategy ? detectConflicts(strategy) : [], [strategy]);
  const diff: ScreeningDiff | null = useMemo(() => baselineResult && result && result !== baselineResult && baselineResult.snapshotId === result.snapshotId ? diffResults(baselineResult, result) : null, [baselineResult, result]);
  const isStrategyValid = strategy ? strategySchema.safeParse(strategy).success : false;
  const canRun = Boolean(isStrategyValid && strategy && canExecute && !clarification && unsupportedItems.length === 0 && conflicts.length === 0 && !busy);

  const setMessage = useCallback((text: string, role: ChatMessage['role'], kind: ChatMessage['kind'] = 'normal') => {
    setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, role, text, kind }]);
  }, []);
  const applyIntentResponse = useCallback((response: IntentEnvelope, context: IntentContext, priorStrategy?: Strategy) => {
    const safeStrategy = strategySchema.parse(response.strategy);
    setStrategy(copyStrategy(safeStrategy));
    setCanExecute(response.canExecute);
    setUnsupportedItems(response.unsupportedRequests ?? []);
    setMappings(response.mappings ?? []);
    setPreviousVersionStrategy(priorStrategy ? copyStrategy(priorStrategy) : previousVersionStrategy);
    const prompts = response.clarifications.map((prompt, index) => ({ id: `clarification-${index + 1}`, prompt, answer: '' }));
    setClarification(prompts.length ? { prompts } : null);
    setPendingIntentContext(prompts.length ? context : null);
    (response.assumptions ?? []).forEach((assumption) => setMessage(`已按此理解：${assumption}`, 'assistant'));
    if (response.unsupportedRequests?.length) response.unsupportedRequests.forEach((item) => setMessage(`暂不支持「${item.request}」：${item.reason}`, 'assistant', 'error'));
    if (prompts.length) {
      response.clarifications.forEach((question) => setMessage(`需要确认：${question}`, 'assistant'));
      setPhase('clarification_needed');
    } else {
      setMessage('策略已准备好，你可以检查并编辑条件。', 'assistant');
      setPhase('strategy_ready');
    }
    setSnapshot(null); setSnapshotEnvelope(null); setResult(null); setBaselineResult(null); setSelectedCode(null); setCompareCodes([null, null]); setBaselineStrategy(null);
  }, [previousVersionStrategy, setMessage]);
  const submitIntent = useCallback(async () => {
    const query = draft.trim();
    if (!query || busy) return;
    setBusy(true); setError(null); setPhase('intent_pending');
    setMessage(query, 'user');
    setDraft('');
    setClarification(null); setPendingIntentContext(null);
    try {
      const request = options.intentRequest ?? requestIntent;
      const response = normalizeIntent(await (previousVersionStrategy
        ? request(query, strategy ?? undefined, previousVersionStrategy)
        : request(query, strategy ?? undefined)));
      applyIntentResponse(response, { originalQuery: query, answers: [] }, strategy ?? undefined);
    } catch (cause) {
      const message = errorText(cause); setError(message); setMessage(message, 'assistant', 'error'); setPhase('recoverable_error'); setDraft(query);
    } finally { setBusy(false); }
  }, [applyIntentResponse, busy, draft, options.intentRequest, previousVersionStrategy, setMessage, strategy]);
  const answerClarification = useCallback((promptIndex: number, answer: string) => {
    setClarification((current) => current ? { prompts: current.prompts.map((item, index) => index === promptIndex ? { ...item, answer } : item) } : current);
  }, []);
  const submitClarification = useCallback(async () => {
    if (!clarification || !pendingIntentContext || busy || clarification.prompts.some((item) => !item.answer.trim())) return;
    const answers = [...pendingIntentContext.answers, ...clarification.prompts.map(({ prompt, answer }) => ({ prompt, answer: answer.trim() }))];
    const query = `${pendingIntentContext.originalQuery}\n\n澄清回答：\n${answers.map(({ prompt, answer }) => `- ${prompt}：${answer}`).join('\n')}`;
    setBusy(true); setError(null); setPhase('intent_pending');
    setMessage(`补充说明：\n${clarification.prompts.map(({ prompt, answer }) => `- ${prompt}：${answer.trim()}`).join('\n')}`, 'user');
    try {
      const request = options.intentRequest ?? requestIntent;
      const response = normalizeIntent(await (previousVersionStrategy
        ? request(query, strategy ?? undefined, previousVersionStrategy)
        : request(query, strategy ?? undefined)));
      applyIntentResponse(response, { originalQuery: pendingIntentContext.originalQuery, answers }, strategy ?? undefined);
    } catch (cause) {
      const message = errorText(cause); setError(message); setMessage(message, 'assistant', 'error'); setPhase('recoverable_error');
    } finally { setBusy(false); }
  }, [applyIntentResponse, busy, clarification, options.intentRequest, pendingIntentContext, previousVersionStrategy, setMessage, strategy]);
  const updateStrategy = useCallback((update: (current: Strategy) => Strategy) => {
    setStrategy((current) => current ? copyStrategy(update(current), current.version + 1) : current);
    setPhase('strategy_dirty');
  }, []);
  const updateCondition = useCallback((index: number, patch: Partial<Condition>) => updateStrategy((current) => ({ ...current, conditions: current.conditions.map((condition, i) => i === index ? { ...condition, ...patch } : condition) })), [updateStrategy]);
  const fixConflict = useCallback((conflict: StrategyConflict, fix: string) => updateStrategy((current) => {
    if (conflict.kind === 'empty_range') {
      const removeUpper = fix === 'remove_upper';
      const targetValue = removeUpper ? conflict.maximum : conflict.minimum;
      const targetOperators = removeUpper ? ['lt', 'lte'] : ['gt', 'gte'];
      if (!Number.isFinite(targetValue)) return current;
      return { ...current, conditions: current.conditions.filter((condition) => !(condition.field === conflict.field && targetOperators.includes(condition.operator) && condition.value === targetValue)) };
    }
    if (conflict.kind === 'equality_outside_range') {
      return { ...current, conditions: current.conditions.filter((condition) => !(condition.field === conflict.field && condition.operator === 'eq' && condition.value === conflict.value)) };
    }
    if (conflict.kind === 'multiple_equalities') {
      const keep = conflict.field === 'industry' && conflict.values.includes('银行') ? '银行' : conflict.values[0];
      return { ...current, conditions: current.conditions.filter((condition) => !(condition.field === conflict.field && condition.operator === 'eq' && conflict.values.includes(condition.value) && condition.value !== keep)) };
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
    try { const saved = storage.save(strategy, name?.trim() || strategy.name, id); refreshSavedStrategies(); setMessage(`已保存策略「${saved.name}」。`, 'assistant'); setError(null); return saved; }
    catch (cause) { setError(errorText(cause)); return null; }
  }, [refreshSavedStrategies, setMessage, storage, strategy]);
  const deleteStrategy = useCallback((id: string) => {
    try { storage.delete(id); refreshSavedStrategies(); setMessage('已删除保存的策略。', 'assistant'); setError(null); }
    catch (cause) { setError(errorText(cause)); }
  }, [refreshSavedStrategies, setMessage, storage]);
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
    phase, messages, draft, strategy, snapshot, snapshotEnvelope, result, baselineResult, previousStrategy: baselineStrategy, previousResult: baselineResult, mappings,
    conflicts, clarification, unsupportedItems, activeTab, selectedCode, compareCodes, diff, busy, error,
    actions: {
      setDraft, submitIntent, answerClarification, submitClarification, updateStrategy, updateCondition, updateConditionByField,
      addCondition, removeCondition, fixConflict, runScreen, setActiveTab, selectStock: setSelectedCode,
      setCompareCode, saveStrategy, loadStrategy, deleteStrategy, resetError: () => setError(null),
      rebaseDiff: () => { if (result && strategy) { setBaselineResult(result); setBaselineStrategy(copyStrategy(strategy)); } },
      canRun, canSave: Boolean(strategy && strategy.name.trim() && conflicts.length === 0),
    },
    savedStrategies,
    savedStrategyWarning,
  };
}
