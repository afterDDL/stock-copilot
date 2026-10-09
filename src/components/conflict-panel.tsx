'use client';

import type { Strategy, StrategyConflict } from '../lib/domain/types';

type Props = { conflicts: StrategyConflict[]; strategy: Strategy | null; onFix(conflict: StrategyConflict, fix: string): void };
const labels: Record<string, string> = { industry: '所属行业', market_cap_cny: '总市值', net_profit_parent_yoy_pct: '归母净利润同比增长率' };

export function ConflictPanel({ conflicts, strategy, onFix }: Props) {
  if (!conflicts.length || !strategy) return null;
  return <section className="card conflict-card" aria-labelledby="conflict-heading" role="alert">
    <div className="section-heading"><div><p className="eyebrow">需要先处理</p><h2 id="conflict-heading">条件存在冲突</h2></div><span className="conflict-count">{conflicts.length}</span></div>
    <p className="conflict-intro">当前条件没有可执行的交集，修复后即可筛选。</p>
    {conflicts.map((conflict, index) => <article className="conflict-item" key={`${conflict.field}-${conflict.kind}-${index}`}>
      <strong>{labels[conflict.field]}</strong>
      {conflict.kind === 'empty_range' && <><p>下限 {conflict.minimum.toLocaleString('zh-CN')} 高于上限 {conflict.maximum.toLocaleString('zh-CN')}。</p><button className="secondary-button" type="button" onClick={() => onFix(conflict, 'remove_upper')}>移除上限条件</button></>}
      {conflict.kind === 'equality_outside_range' && <><p>相等条件 {conflict.value.toLocaleString('zh-CN')} 不在现有范围内。</p><button className="secondary-button" type="button" onClick={() => onFix(conflict, 'remove_equality')}>移除相等条件</button></>}
      {conflict.kind === 'multiple_equalities' && <><p>同一指标有多个相等值：{conflict.values.join('、')}。</p><button className="secondary-button" type="button" onClick={() => onFix(conflict, 'remove_equality')}>保留一个值，移除其他相等条件</button></>}
    </article>)}
  </section>;
}
