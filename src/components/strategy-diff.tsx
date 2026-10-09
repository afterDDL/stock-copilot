'use client';

import type { DataSnapshot, ScreeningDiff, Strategy } from '../lib/domain/types';

type Props = { diff: ScreeningDiff | null; snapshot: DataSnapshot | null; previousStrategy: Strategy | null; currentStrategy: Strategy | null; onSelectStock(code: string): void; onClose(): void };
const kinds = [
  { key: 'added', title: '新增入选', label: '新增' }, { key: 'retained', title: '继续入选', label: '保留' }, { key: 'removed', title: '不再入选', label: '剔除' },
] as const;

export function StrategyDiff({ diff, snapshot, previousStrategy, currentStrategy, onSelectStock, onClose }: Props) {
  if (!diff) return null;
  const stocks = new Map(snapshot?.stocks.map((stock) => [stock.code, stock]) ?? []);
  const oldThreshold = previousStrategy?.conditions.find((condition) => condition.field === 'market_cap_cny')?.value;
  const newThreshold = currentStrategy?.conditions.find((condition) => condition.field === 'market_cap_cny')?.value;
  return <section className="card diff-card" aria-labelledby="diff-heading" aria-label="筛选变化">
    <div className="section-heading"><div><p className="eyebrow">同一份数据快照</p><h2 id="diff-heading">筛选变化</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭策略变化">关闭</button></div>
    <p className="diff-summary">本次变化由筛选条件调整产生，集合按“入选”状态比较。无法判定的状态变化不计入 Diff。</p>
    {oldThreshold !== undefined && newThreshold !== undefined && oldThreshold !== newThreshold && <p className="threshold-change">总市值门槛从 {(Number(oldThreshold) / 100_000_000).toLocaleString('zh-CN')} 亿元调整为 {(Number(newThreshold) / 100_000_000).toLocaleString('zh-CN')} 亿元。</p>}
    <div className="diff-columns">{kinds.map(({ key, title, label }) => <div className="diff-column" key={key}><h3>{title}<span>{diff[key].length}</span></h3>{diff[key].length ? diff[key].map((code) => { const stock = stocks.get(code); return <button key={code} className="diff-stock" onClick={() => onSelectStock(code)}><span>{stock?.name ?? code}</span><small>{code} · {label}</small></button>; }) : <p className="muted-copy">没有股票</p>}</div>)}</div>
  </section>;
}
