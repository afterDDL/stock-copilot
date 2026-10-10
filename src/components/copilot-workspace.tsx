'use client';

import { useEffect, useRef, useState } from 'react';
import type { Condition, Strategy } from '../lib/domain/types';
import { useCopilot } from '../hooks/use-copilot';
import type { StrategyStorage } from '../lib/storage/strategies';
import type { IntentEnvelope, SnapshotEnvelope } from '../hooks/use-copilot';
import type { ConditionMapping } from '../lib/mapping/resolver';
import { ChatPanel } from './chat-panel';
import { StrategyEditor } from './strategy-editor';
import { ConflictPanel } from './conflict-panel';
import { ResultsWorkspace } from './results-workspace';
import { SavedStrategies } from './saved-strategies';

type Props = {
  intentRequest?: (query: string, currentStrategy?: Strategy) => Promise<IntentEnvelope | { intent: IntentEnvelope }>;
  stockSearchRequest?: (strategy: Strategy) => Promise<SnapshotEnvelope>;
  storage?: Pick<StrategyStorage, 'list' | 'save' | 'load' | 'delete'> & Partial<Pick<StrategyStorage, 'warning'>>;
};
const sections = [{ id: 'conversation', label: '对话' }, { id: 'strategy', label: '策略' }, { id: 'research', label: '结果' }];
const mappingStateLabel: Record<ConditionMapping['state'], string> = {
  confirmed: '已确认', assumed: '产品预设', needs_clarification: '需要澄清', unsupported: '暂不支持',
};
const mappingFieldLabel: Record<string, string> = {
  industry: '所属行业', market_cap_cny: '总市值', net_profit_parent_yoy_pct: '归母净利润同比增长率',
};
const mappingConceptLabel: Record<string, string> = {
  industry_scope: '行业范围', company_size: '公司规模', profit_growth: '利润增长',
  valuation: '估值', financial_stability: '财务稳健', business_improvement: '经营改善',
  market_momentum: '市场表现', profitability: '盈利能力', price_stability: '股价稳定',
  strategy_version: '策略版本', strategy_patch: '条件调整',
};

function MappingPanel({ mappings }: { mappings: ConditionMapping[] }) {
  if (!mappings.length) return null;
  return <section className="card mapping-card" aria-label="意图映射">
    <div className="section-heading"><div><p className="eyebrow">原话 · 金融概念 · 可执行字段</p><h2>意图映射</h2></div></div>
    <div className="mapping-list">{mappings.map((mapping, index) => <article className="mapping-item" key={mapping.originalExpression + mapping.concept + index}>
      <div className="mapping-item-heading"><strong>“{mapping.originalExpression}”</strong><span className={'mapping-state mapping-' + mapping.state}>{mappingStateLabel[mapping.state]}</span></div>
      <p>{(mappingConceptLabel[mapping.concept] ?? '筛选要求') + (mapping.field ? ' → ' + (mappingFieldLabel[mapping.field] ?? '筛选条件') : '') + (mapping.unit ? ' · ' + mapping.unit : '') + (mapping.statisticDate ? ' · ' + mapping.statisticDate : '')}</p>
      <span>{mapping.explanation}</span>
      {mapping.defaultSource && <small>默认来源：{mapping.defaultSource}</small>}
    </article>)}</div>
  </section>;
}

export function CopilotWorkspace({ intentRequest, stockSearchRequest, storage }: Props) {
  const state = useCopilot({ intentRequest, stockSearchRequest, storage });
  const [currentSection, setCurrentSection] = useState('conversation');
  const evidenceTrigger = useRef<HTMLElement | null>(null);
  const compareTrigger = useRef<HTMLButtonElement | null>(null);
  const hadClarification = useRef(false);
  useEffect(() => {
    if (hadClarification.current && !state.clarification) requestAnimationFrame(() => document.getElementById('intent-draft')?.focus());
    hadClarification.current = Boolean(state.clarification);
  }, [state.clarification]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (state.selectedCode) { state.actions.selectStock(''); requestAnimationFrame(() => evidenceTrigger.current?.focus()); }
        else if (state.compareCodes.some(Boolean)) { state.actions.setCompareCode(0, null); state.actions.setCompareCode(1, null); requestAnimationFrame(() => compareTrigger.current?.focus()); }
        return;
      }
      if (event.key !== 'Tab' || !state.selectedCode) return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const focusable = dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')] : [];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.actions, state.compareCodes, state.selectedCode]);
  useEffect(() => {
    if (state.selectedCode) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.evidence-drawer .close-button')?.focus());
  }, [state.selectedCode]);

  const update = (fn: (current: Strategy) => Strategy) => state.actions.updateStrategy(fn);
  const rename = (name: string) => update((current) => ({ ...current, name }));
  const conditionChange = (index: number, patch: Partial<Condition>) => state.actions.updateCondition(index, patch);
  const sortDirection = (direction: 'asc' | 'desc') => update((current) => ({ ...current, sort: { ...current.sort, direction } }));
  const handleSelectStock = (code: string, query: 'current' | 'previous' = 'current') => {
    if (code) evidenceTrigger.current = document.activeElement as HTMLElement;
    state.actions.selectStock(code, query);
    if (!code) requestAnimationFrame(() => evidenceTrigger.current?.focus());
  };
  const handleCompare = (slot: 0 | 1, code: string | null) => {
    if (code) compareTrigger.current = document.activeElement as HTMLButtonElement;
    state.actions.setCompareCode(slot, code);
  };
  return <div className="app-shell">
    <header className="topbar"><a href="#top" className="brand-mark" aria-label="选股 coPilot 首页"><span className="brand-icon">◈</span><span>选股 <strong>coPilot</strong></span></a><div className="header-right"><span className="header-context">研究工作台</span><SavedStrategies entries={state.savedStrategies} canSave={state.actions.canSave} warning={state.savedStrategyWarning} onSave={state.actions.saveStrategy} onLoad={state.actions.loadStrategy} onDelete={state.actions.deleteStrategy} /></div></header>
    <main id="top" className="workspace-main">
      <div className="welcome-heading"><div><p className="eyebrow">选股 coPilot · 沪深北 A 股</p><h1>把想法，变成可验证的筛选。</h1><p className="welcome-copy">用自然语言开始，再检查条件、数据和每只股票的入选依据。</p></div><span className="scope-note">沪深北 A 股</span></div>
      <div className="quota-notice" role="note"><span aria-hidden="true">!</span><p>iFinD 账号调用额度已用完，当前无法获取实时数据。</p></div>
      <nav className="mobile-sections" aria-label="工作区章节">{sections.map((section) => <a key={section.id} href={`#${section.id}`} aria-current={currentSection === section.id ? 'location' : undefined} onClick={() => setCurrentSection(section.id)}>{section.label}</a>)}</nav>
      <div className="workspace-grid">
        <div className="conversation-column">
          <div id="conversation"><ChatPanel messages={state.messages} draft={state.draft} busy={state.busy} busyText={state.phase === 'data_loading' ? '正在查询沪深北 A 股…' : '正在整理你的筛选条件…'} error={state.error} clarification={state.clarification} onDraftChange={state.actions.setDraft} onSubmit={() => { void state.actions.submitIntent(); }} onClarificationAnswer={state.actions.answerClarification} onSubmitClarification={() => { void state.actions.submitClarification(); }} /></div>
          <div id="strategy"><StrategyEditor strategy={state.strategy} disabled={state.busy} onRename={rename} onConditionChange={conditionChange} onConditionRemove={state.actions.removeCondition} onConditionAdd={state.actions.addCondition} onSortDirectionChange={sortDirection} onRun={() => { void state.actions.runScreen(); }} canRun={state.actions.canRun} /></div>
          <MappingPanel mappings={state.mappings} />
          <ConflictPanel conflicts={state.conflicts} strategy={state.strategy} onFix={(conflict, fix) => { state.actions.fixConflict(conflict, fix); requestAnimationFrame(() => {
            const label = conflict.field === 'market_cap_cny' ? '总市值门槛（元）' : conflict.field === 'net_profit_parent_yoy_pct' ? '归母净利润同比增长率门槛（%）' : '所属行业';
            document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.focus();
          }); }} />
          {state.unsupportedItems.length > 0 && <section className="card unsupported-card" aria-labelledby="unsupported-heading"><h2 id="unsupported-heading">暂不支持的要求</h2>{state.unsupportedItems.map((item, index) => <p key={`${item.request}-${index}`}>暂不支持“{item.request}”指标查询。</p>)}</section>}
        </div>
        <div id="research" className="research-column"><ResultsWorkspace result={state.result} previousResult={state.previousResult} previousSnapshot={state.previousSnapshot} snapshot={state.snapshot} snapshotEnvelope={state.snapshotEnvelope} activeTab={state.activeTab} selectedCode={state.selectedCode} selectedQuery={state.selectedQuery} comparingCodes={state.compareCodes} diff={state.diff} previousStrategy={state.previousStrategy} currentStrategy={state.resultStrategy} resultIsStale={state.resultIsStale} onTabChange={state.actions.setActiveTab} onSelectStock={handleSelectStock} onCompareSlotChange={handleCompare} onRebase={state.actions.rebaseDiff} /></div>
      </div>
      <div className="live-announcer" aria-live="polite" aria-atomic="true">{state.busy && state.phase === 'data_loading' ? '正在查询沪深北 A 股。' : state.result ? `筛选完成，入选 ${state.result.included.length} 只，排除 ${state.result.excluded.length} 只，无法判定 ${state.result.unknown.length} 只。` : ''}</div>
    </main>
  </div>;
}
