'use client';

import { useMemo, useState } from 'react';
import type { DataSnapshot, ScreeningDiff, ScreeningResult, Strategy } from '../lib/domain/types';
import type { SnapshotEnvelope } from '../hooks/use-copilot';
import { StockEvidence } from './stock-evidence';
import { StrategyDiff } from './strategy-diff';
import { StockCompare } from './stock-compare';

type Tab = 'included' | 'excluded' | 'unknown';
type Props = {
  result: ScreeningResult | null; snapshot: DataSnapshot | null; snapshotEnvelope: SnapshotEnvelope | null;
  activeTab: Tab; selectedCode: string | null; comparingCodes: [string | null, string | null]; diff: ScreeningDiff | null;
  previousStrategy: Strategy | null; currentStrategy: Strategy | null;
  onTabChange(tab: Tab): void; onSelectStock(code: string): void; onCompareSlotChange(slot: 0 | 1, code: string | null): void;
  onRebase(): void;
};
const tabMeta: Array<{ key: Tab; label: string }> = [{ key: 'included', label: '入选' }, { key: 'excluded', label: '排除' }, { key: 'unknown', label: '无法判定' }];
function metric(stock: DataSnapshot['stocks'][number], field: 'market_cap_cny' | 'net_profit_parent_yoy_pct') {
  const value = stock.metrics[field].value;
  if (value === null) return '缺少数据';
  return field === 'market_cap_cny' && typeof value === 'number' ? `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元` : `${value}%`;
}

export function ResultsWorkspace({ result, snapshot, snapshotEnvelope, activeTab, selectedCode, comparingCodes, diff, previousStrategy, currentStrategy, onTabChange, onSelectStock, onCompareSlotChange, onRebase }: Props) {
  const [showDiff, setShowDiff] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const buckets = result ? { included: result.included, excluded: result.excluded, unknown: result.unknown } : null;
  const items = buckets?.[activeTab] ?? [];
  const selected = useMemo(() => [...(result?.included ?? []), ...(result?.excluded ?? []), ...(result?.unknown ?? [])].find((item) => item.stock.code === selectedCode) ?? null, [result, selectedCode]);
  const lookup = (code: string | null) => code ? [...(result?.included ?? []), ...(result?.excluded ?? []), ...(result?.unknown ?? [])].find((item) => item.stock.code === code) ?? null : null;
  return <section className="results-column" aria-labelledby="results-heading">
    <section className="card results-card" aria-labelledby="results-heading">
      <div className="section-heading results-title-row"><div><p className="eyebrow">基于真实数据</p><h2 id="results-heading">研究结果</h2></div>
        {result && <div className="result-count">{result.included.length + result.excluded.length + result.unknown.length} 只银行股</div>}
      </div>
      {snapshot && snapshotEnvelope ? <div className={`snapshot-banner snapshot-${snapshotEnvelope.mode}`}>
        <div className="snapshot-icon">{snapshotEnvelope.mode === 'historical' ? '◷' : '●'}</div><div className="snapshot-copy"><strong>{snapshotEnvelope.mode === 'historical' ? '历史快照' : '实时数据'}</strong><span>{snapshotEnvelope.mode === 'historical' ? `截至 ${snapshot.asOf} · 采集于 ${new Date(snapshotEnvelope.evidence.capturedAt).toLocaleString('zh-CN')}` : `数据日期 ${snapshot.asOf}`}</span></div>
        <button className="text-button" type="button" aria-expanded={sourceOpen} aria-label="查看数据来源详情" onClick={() => setSourceOpen((open) => !open)}>数据详情</button>
        <details id="source-details" className="source-details" open={sourceOpen}><summary className="sr-only">数据来源与覆盖情况</summary><p>数据来源：{snapshotEnvelope.evidence.source}</p><p>股票覆盖：{snapshot.coverage.returnedStocks}/{snapshot.coverage.expectedStocks} 只</p><p>总市值日期：{snapshotEnvelope.evidence.statisticDates.marketCap ?? '未知'}</p><p>利润增长日期：{snapshotEnvelope.evidence.statisticDates.netProfitYoy ?? '未知'}</p><p>实时查询步骤：{snapshotEnvelope.evidence.liveRequests.length}</p>{snapshotEnvelope.error && <p>实时查询失败原因：{snapshotEnvelope.error}</p>}</details>
      </div> : <div className="results-empty-state"><div className="empty-illustration">⌕</div><h3>你的研究结果会出现在这里</h3><p>运行筛选后，可查看入选、排除和无法判定的股票与对应证据。</p></div>}
      {result && buckets && <>
        <div className="result-controls"><div className="result-tabs" role="tablist" aria-label="筛选结果类别" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const currentIndex = tabMeta.findIndex((tab) => tab.key === activeTab);
          const nextIndex = (currentIndex + (event.key === 'ArrowRight' ? 1 : tabMeta.length - 1)) % tabMeta.length;
          onTabChange(tabMeta[nextIndex].key);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
        }}>{tabMeta.map(({ key, label }) => <button role="tab" aria-selected={activeTab === key} className={`result-tab ${activeTab === key ? 'active' : ''}`} key={key} onClick={() => onTabChange(key)}>{label}<span>{buckets[key].length}</span></button>)}</div>
          <button className={`secondary-button compare-toggle ${compareOpen ? 'selected' : ''}`} type="button" aria-expanded={compareOpen} onClick={() => setCompareOpen((open) => !open)}>比较股票</button></div>
        <p className="sr-only" role="status">当前显示{tabMeta.find((tab) => tab.key === activeTab)?.label}：{items.length} 只股票。</p>
        {items.length ? <div className="stock-list-wrap"><table className="stock-table"><caption className="sr-only">{tabMeta.find((tab) => tab.key === activeTab)?.label}股票列表</caption><thead><tr><th scope="col">股票</th><th scope="col">总市值</th><th scope="col">利润同比</th><th scope="col">状态</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.stock.code}>
          <th scope="row"><button className="stock-name-button" onClick={() => onSelectStock(item.stock.code)}><span>{item.stock.name}</span><small>{item.stock.code}</small></button></th>
          <td data-label="总市值">{metric(item.stock, 'market_cap_cny')}</td><td data-label="利润同比">{metric(item.stock, 'net_profit_parent_yoy_pct')}</td>
          <td data-label="状态"><span className={`status status-${activeTab === 'included' ? 'passed' : activeTab === 'excluded' ? 'failed' : 'unknown'}`}>{activeTab === 'included' ? '入选' : activeTab === 'excluded' ? '排除' : '无法判定'}</span></td>
          <td><button className="text-button row-compare" onClick={() => { setCompareOpen(true); const next = comparingCodes[0] ? 1 : 0; onCompareSlotChange(next, item.stock.code); }}>{compareOpen && comparingCodes[0] && !comparingCodes[1] ? '加入 B' : '比较'}</button></td>
        </tr>)}</tbody></table></div> : <div className="empty-tab"><strong>{activeTab === 'included' ? '暂时没有入选股票' : activeTab === 'excluded' ? '没有股票被排除' : '没有无法判定的股票'}</strong><span>{activeTab === 'unknown' ? '数据缺失或指标日期不匹配时，股票会显示在这里。' : '可以调整筛选条件后重新运行。'}</span></div>}
      </>}
    </section>
    {compareOpen && snapshot && <StockCompare left={lookup(comparingCodes[0])} right={lookup(comparingCodes[1])} snapshot={snapshot} onChoose={onCompareSlotChange} onClose={() => { setCompareOpen(false); onCompareSlotChange(0, null); onCompareSlotChange(1, null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.compare-toggle')?.focus()); }} />}
    {showDiff && diff ? <><StrategyDiff diff={diff} snapshot={snapshot} previousStrategy={previousStrategy} currentStrategy={currentStrategy} onSelectStock={onSelectStock} onClose={() => setShowDiff(false)} /><div className="rebase-row"><button className="text-button" onClick={onRebase}>设为比较基准</button></div></> : diff ? <button className="secondary-button show-diff" onClick={() => setShowDiff(true)}>查看筛选变化</button> : null}
    <StockEvidence item={selected} historical={snapshot?.source === 'historical'} asOf={snapshot?.asOf} onClose={() => onSelectStock('')} />
  </section>;
}
