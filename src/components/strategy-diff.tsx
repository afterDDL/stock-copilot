'use client';

import type { DataSnapshot, ScreeningDiff, ScreeningResult, Strategy } from '../lib/domain/types';

type Props = { diff: ScreeningDiff | null; snapshot: DataSnapshot | null; previousResult: ScreeningResult | null; previousStrategy: Strategy | null; currentStrategy: Strategy | null; onSelectStock(code: string, query?: 'current' | 'previous'): void; onClose(): void };
const kinds = [
  { key: 'added', title: '新增入选', label: '新增' }, { key: 'retained', title: '继续入选', label: '保留' }, { key: 'removed', title: '不再入选', label: '剔除' },
] as const;

export function StrategyDiff({ diff, snapshot, previousResult, previousStrategy, currentStrategy, onSelectStock, onClose }: Props) {
  if (!diff) return null;
  const stocks = new Map(snapshot?.stocks.map((stock) => [stock.code, stock]) ?? []);
  const previousStocks = new Map(previousResult?.included.map((item) => [item.stock.code, item.stock]) ?? []);
  const oldThreshold = previousStrategy?.conditions.find((condition) => condition.field === 'market_cap_cny')?.value;
  const newThreshold = currentStrategy?.conditions.find((condition) => condition.field === 'market_cap_cny')?.value;
  return <section className="card diff-card" aria-labelledby="diff-heading" aria-label="筛选变化">
    <div className="section-heading"><div><p className="eyebrow">两次检索结果</p><h2 id="diff-heading">筛选变化</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭策略变化">关闭</button></div>
    <p className="diff-summary">比较两次入选名单。点击股票查看对应查询的证据。</p>
    {oldThreshold !== undefined && newThreshold !== undefined && oldThreshold !== newThreshold && <p className="threshold-change">总市值门槛从 {(Number(oldThreshold) / 100_000_000).toLocaleString('zh-CN')} 亿元调整为 {(Number(newThreshold) / 100_000_000).toLocaleString('zh-CN')} 亿元。</p>}
    <div className="diff-columns">{kinds.map(({ key, title, label }) => <div className="diff-column" key={key}><h3>{title}<span>{diff[key].length}</span></h3>{diff[key].length ? diff[key].map((code) => { const stock = key === 'removed' ? previousStocks.get(code) : stocks.get(code); return <button key={code} className="diff-stock" onClick={() => onSelectStock(code, key === 'removed' ? 'previous' : 'current')}><span>{stock?.name ?? code}</span><small>{code} · {label}</small></button>; }) : <p className="muted-copy">没有股票</p>}</div>)}</div>
  </section>;
}
