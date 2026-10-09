'use client';

import { useEffect, useState } from 'react';
import type { Condition, ConditionOperator, Strategy } from '../lib/domain/types';

type Props = {
  strategy: Strategy | null; disabled: boolean;
  onRename(name: string): void; onConditionChange(conditionIndex: number, patch: Partial<Condition>): void;
  onConditionRemove(conditionIndex: number): void; onConditionAdd(field: Condition['field']): void;
  onSortDirectionChange(direction: 'asc' | 'desc'): void; onRun(): void; canRun: boolean;
};
const operators: Array<{ value: ConditionOperator; label: string }> = [
  { value: 'eq', label: '等于' }, { value: 'gt', label: '大于' }, { value: 'gte', label: '不低于' }, { value: 'lt', label: '小于' }, { value: 'lte', label: '不高于' },
];

function NumericConditionInput({ condition, index, disabled, onChange }: { condition: Condition; index: number; disabled: boolean; onChange(index: number, patch: Partial<Condition>): void }) {
  const [draft, setDraft] = useState(String(condition.value));
  useEffect(() => setDraft(String(condition.value)), [condition.value]);
  const label = condition.field === 'market_cap_cny' ? '总市值门槛（元）' : '归母净利润同比增长率门槛（%）';
  return <input className="number-input" type="number" step="any" aria-label={label} value={draft} disabled={disabled} onChange={(event) => {
    setDraft(event.target.value);
  }} onBlur={() => {
    const value = Number(draft);
    if (draft !== '' && Number.isFinite(value) && value !== condition.value) onChange(index, { value });
    else if (draft === '' || !Number.isFinite(value)) setDraft(String(condition.value));
  }} />;
}

export function StrategyEditor({ strategy, disabled, onRename, onConditionChange, onConditionRemove, onConditionAdd, onSortDirectionChange, onRun, canRun }: Props) {
  const [newField, setNewField] = useState<Condition['field']>('market_cap_cny');
  const [nameDraft, setNameDraft] = useState(strategy?.name ?? '');
  useEffect(() => setNameDraft(strategy?.name ?? ''), [strategy?.name]);
  if (!strategy) return <section className="card strategy-card" aria-labelledby="strategy-heading"><div className="section-heading"><div><p className="eyebrow">可编辑 · 可追溯</p><h2 id="strategy-heading">筛选策略</h2></div></div><p className="empty-copy">发送选股需求后，策略条件会显示在这里。</p></section>;
  return <section className="card strategy-card" aria-labelledby="strategy-heading">
    <div className="section-heading"><div><p className="eyebrow">检查并微调</p><h2 id="strategy-heading">筛选策略</h2></div><span className="version-tag">v{strategy.version}</span></div>
    <label className="field-label" htmlFor="strategy-name">策略名称</label>
    <input id="strategy-name" className="text-input strategy-name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => { if (nameDraft !== strategy.name) onRename(nameDraft); }} disabled={disabled} />
    <div className="condition-list">{strategy.conditions.map((condition, index) => {
      const field = condition.field === 'industry' ? '所属行业' : condition.field === 'market_cap_cny' ? '总市值' : '归母净利润同比增长率';
      const numeric = typeof condition.value === 'number';
      return <article className="condition-card" key={`${condition.field}-${index}`}>
        <div className="condition-top"><span className="condition-title">{field}</span><div className="condition-badges">{condition.aiInferred && <span className="inferred-badge">AI 推断</span>}<span className="condition-unit">{condition.unit}</span></div></div>
        <p className="source-expression">“{condition.sourceExpression}”</p>
        <div className="condition-controls">
          <label className="sr-only" htmlFor={`condition-operator-${index}`}>{field}比较方式</label>
          <select id={`condition-operator-${index}`} aria-label={`${field}比较方式`} value={condition.operator} disabled={disabled || condition.field === 'industry'} onChange={(event) => onConditionChange(index, { operator: event.target.value as ConditionOperator })}>
            {operators.filter((operator) => condition.field !== 'industry' || operator.value === 'eq').map((operator) => <option value={operator.value} key={operator.value}>{operator.label}</option>)}
          </select>
          {numeric ? <NumericConditionInput condition={condition} index={index} disabled={disabled} onChange={onConditionChange} /> : <input className="text-input" aria-label="所属行业" value={condition.value} disabled />}
          {condition.field !== 'industry' && <button className="icon-button remove-condition" type="button" aria-label={`移除${field}条件`} disabled={disabled} onClick={() => onConditionRemove(index)}>移除</button>}
        </div>
        <span className="condition-date">指标日期：{condition.statisticDate ?? '不适用'}</span>
      </article>;
    })}</div>
    <div className="editor-actions"><label className="sr-only" htmlFor="add-condition">添加筛选条件</label><select id="add-condition" value={newField} onChange={(event) => setNewField(event.target.value as Condition['field'])}>
      <option value="market_cap_cny">总市值</option><option value="net_profit_parent_yoy_pct">归母净利润同比增长率</option>
    </select><button className="secondary-button" type="button" disabled={disabled || strategy.conditions.some((condition) => condition.field === newField)} onClick={() => onConditionAdd(newField)}>添加条件</button></div>
    <label className="field-label sort-label" htmlFor="sort-direction">{strategy.sort.field === 'market_cap_cny' ? '总市值排序' : '利润增长排序'}</label>
    <select id="sort-direction" value={strategy.sort.direction} disabled={disabled} onChange={(event) => onSortDirectionChange(event.target.value as 'asc' | 'desc')}><option value="desc">由高到低</option><option value="asc">由低到高</option></select>
    <button className="primary-button run-button" type="button" onClick={onRun} disabled={!canRun}>{disabled ? '正在筛选…' : '运行筛选'}</button>
    {!canRun && <p className="run-hint">请先完成澄清并修复冲突，再运行筛选。</p>}
  </section>;
}
