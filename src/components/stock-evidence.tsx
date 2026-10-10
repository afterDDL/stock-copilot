'use client';

import type { StockScreeningEvidence } from '../lib/domain/types';

type Props = { item: StockScreeningEvidence | null; onClose(): void; historical?: boolean; asOf?: string; queryLabel?: string };
const fieldLabel: Record<string, string> = { industry: '所属行业', market_cap_cny: '总市值', net_profit_parent_yoy_pct: '归母净利润同比增长率' };
function valueText(value: number | string | null, unit: string) {
  if (value === null) return '缺少数据';
  if (unit === '元' && typeof value === 'number') return `${Number((value / 100_000_000).toFixed(2)).toLocaleString('zh-CN')} 亿元`;
  return `${value}${unit === '%' ? '%' : unit === '行业' ? '' : ` ${unit}`}`;
}
const statusText = { passed: '符合', failed: '未符合', unknown: '无法判定' };

export function StockEvidence({ item, onClose, historical = false, asOf, queryLabel }: Props) {
  if (!item) return null;
  return <section role="dialog" aria-modal="true" aria-labelledby="evidence-heading" className="drawer card evidence-drawer">
    <div className="drawer-heading"><div><p className="eyebrow">逐项核对</p><h2 id="evidence-heading">股票证据：{item.stock.name}</h2><span className="stock-code">{item.stock.code}</span></div><button className="icon-button close-button" aria-label="关闭股票证据" onClick={onClose}>关闭</button></div>
    {historical && <p className="provenance-note">历史快照 · 截至 {asOf ?? '日期未知'}</p>}
    {queryLabel && <p className="provenance-note">{queryLabel}</p>}
    <div className="evidence-list">{item.evidence.map((entry, index) => <article className="evidence-row" key={`${entry.condition.field}-${index}`}>
      <div className="evidence-title"><h3>{fieldLabel[entry.condition.field]}</h3><span className={`status status-${entry.status}`}>{statusText[entry.status]}</span></div>
      <p className="source-expression evidence-source">筛选表达：{entry.condition.sourceExpression}</p>
      <dl><div><dt>实际值</dt><dd>{valueText(entry.actual, entry.unit)}</dd></div><div><dt>指标日期</dt><dd>{entry.statisticDate ?? '不适用'}</dd></div><div><dt>数据来源</dt><dd>{entry.source === 'historical' ? '历史快照' : '实时'}</dd></div></dl>
      <p className="evidence-explanation">{entry.explanation}</p>
    </article>)}</div>
  </section>;
}
