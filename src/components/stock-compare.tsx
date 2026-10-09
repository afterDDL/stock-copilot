'use client';

import type { DataSnapshot, StockScreeningEvidence } from '../lib/domain/types';

type Props = { left: StockScreeningEvidence | null; right: StockScreeningEvidence | null; snapshot: DataSnapshot | null; onChoose(slot: 0 | 1, code: string | null): void; onClose(): void };
const fields = [
  { key: 'industry', label: '所属行业' }, { key: 'market_cap_cny', label: '总市值' }, { key: 'net_profit_parent_yoy_pct', label: '归母净利润同比增长率' },
] as const;
function formatValue(value: number | string | null, unit: string) {
  if (value === null) return '缺少数据';
  if (unit === '元' && typeof value === 'number') return `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元`;
  return `${value}${unit === '%' ? '%' : ''}`;
}

export function StockCompare({ left, right, snapshot, onChoose, onClose }: Props) {
  if (!snapshot) return null;
  const choices = snapshot.stocks;
  const renderStock = (item: StockScreeningEvidence | null, slot: 0 | 1) => {
    const stock = item?.stock ?? null;
    return <div className="compare-stock" key={slot}>
      <label htmlFor={`compare-stock-${slot}`}>股票 {slot === 0 ? 'A' : 'B'}</label>
      <select id={`compare-stock-${slot}`} aria-label={`选择股票${slot === 0 ? 'A' : 'B'}`} value={stock?.code ?? ''} onChange={(event) => onChoose(slot, event.target.value || null)}>
        <option value="">选择一只股票</option>{choices.filter((candidate) => candidate.code === stock?.code || candidate.code !== (slot === 0 ? right?.stock.code : left?.stock.code)).map((candidate) => <option value={candidate.code} key={candidate.code}>{candidate.name} · {candidate.code}</option>)}
      </select>
      {stock && <><h3>{stock.name}</h3><span className="stock-code">{stock.code}</span></>}
    </div>;
  };
  const valueAt = (stock: StockScreeningEvidence['stock'] | null, field: typeof fields[number]['key']) => {
    const metric = stock?.metrics[field];
    return metric ? <><strong>{formatValue(metric.value, metric.unit)}</strong><small>{metric.date ? `指标日期 ${metric.date}` : '无统计日期'} · {metric.source === 'historical' ? '历史快照' : '实时'} · {metric.coverage === 'available' ? '有数据' : '缺少数据'}</small></> : <><strong>选择股票后显示</strong><small>包含数据日期、来源和覆盖情况</small></>;
  };
  return <section className="card compare-card" aria-labelledby="compare-heading" aria-label="股票比较">
    <div className="section-heading"><div><p className="eyebrow">使用相同快照</p><h2 id="compare-heading">股票比较</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭股票比较">关闭</button></div>
    <div className="compare-picker">{renderStock(left, 0)}{renderStock(right, 1)}</div>
    {left && right && <div className="compare-table" role="table" aria-label="股票指标对比"><div className="compare-row compare-head" role="row"><span role="columnheader">指标</span><span role="columnheader">{left.stock.name}</span><span role="columnheader">{right.stock.name}</span></div>{fields.map((field) => <div className="compare-row" role="row" key={field.key}><strong role="rowheader">{field.label}</strong><span role="cell">{valueAt(left.stock, field.key)}</span><span role="cell">{valueAt(right.stock, field.key)}</span></div>)}</div>}
    {(!left || !right) && <p className="muted-copy">选择两只不同的股票后，显示三项支持指标和各自的数据来源。</p>}
  </section>;
}
