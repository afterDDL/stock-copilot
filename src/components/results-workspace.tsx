'use client';

import { useMemo, useState } from 'react';
import type { DataSnapshot, ScreeningDiff, ScreeningResult, Strategy } from '../lib/domain/types';
import type { SnapshotEnvelope } from '../hooks/use-copilot';
import { StockEvidence } from './stock-evidence';
import { StrategyDiff } from './strategy-diff';
import { StockCompare } from './stock-compare';
import { calculateStockPeerPosition, calculateUniverseStatistics } from '../lib/research/distribution';
import { buildResearchInsights } from '../lib/research/insights';

type Tab = 'included' | 'excluded' | 'unknown';
type Props = {
  result: ScreeningResult | null; previousResult: ScreeningResult | null; previousSnapshot: DataSnapshot | null; snapshot: DataSnapshot | null; snapshotEnvelope: SnapshotEnvelope | null;
  activeTab: Tab; selectedCode: string | null; selectedQuery: 'current' | 'previous'; comparingCodes: [string | null, string | null]; diff: ScreeningDiff | null; resultIsStale: boolean;
  previousStrategy: Strategy | null; currentStrategy: Strategy | null;
  onTabChange(tab: Tab): void; onSelectStock(code: string, query?: 'current' | 'previous'): void; onCompareSlotChange(slot: 0 | 1, code: string | null): void;
  onRebase(): void;
};
const tabMeta: Array<{ key: Tab; label: string }> = [{ key: 'included', label: '入选' }, { key: 'excluded', label: '排除' }, { key: 'unknown', label: '无法判定' }];
function metric(stock: DataSnapshot['stocks'][number], field: 'market_cap_cny' | 'net_profit_parent_yoy_pct') {
  const value = stock.metrics[field].value;
  if (value === null) return '缺少数据';
  return field === 'market_cap_cny' && typeof value === 'number' ? `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元` : `${value}%`;
}

function largeCny(value: number | null) {
  return value === null ? '暂无数据' : (value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' 亿元';
}

export function ResultsWorkspace({ result, previousResult, previousSnapshot, snapshot, snapshotEnvelope, activeTab, selectedCode, selectedQuery, comparingCodes, diff, previousStrategy, currentStrategy, resultIsStale, onTabChange, onSelectStock, onCompareSlotChange, onRebase }: Props) {
  const [showDiff, setShowDiff] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const buckets = result ? { included: result.included, excluded: result.excluded, unknown: result.unknown } : null;
  const items = buckets?.[activeTab] ?? [];
  const evidenceResult = selectedQuery === 'previous' ? previousResult : result;
  const evidenceSnapshot = selectedQuery === 'previous' ? previousSnapshot : snapshot;
  const selected = useMemo(() => [...(evidenceResult?.included ?? []), ...(evidenceResult?.excluded ?? []), ...(evidenceResult?.unknown ?? [])].find((item) => item.stock.code === selectedCode) ?? null, [evidenceResult, selectedCode]);
  const threshold = currentStrategy?.conditions.find((condition) => condition.field === 'market_cap_cny' && typeof condition.value === 'number')?.value as number | undefined;
  const universeStatistics = useMemo(() => snapshot ? calculateUniverseStatistics(snapshot, threshold ?? 100_000_000_000) : null, [snapshot, threshold]);
  const insights = useMemo(() => snapshot && result && currentStrategy
    ? buildResearchInsights(snapshot, result, previousResult, currentStrategy, previousStrategy)
    : null, [snapshot, result, previousResult, currentStrategy, previousStrategy]);
  const lookup = (code: string | null) => code ? [...(result?.included ?? []), ...(result?.excluded ?? []), ...(result?.unknown ?? [])].find((item) => item.stock.code === code) ?? null : null;
  return <section className="results-column" aria-labelledby="results-heading">
    <section className="card results-card" aria-labelledby="results-heading">
      <div className="section-heading results-title-row"><div><p className="eyebrow">基于真实数据</p><h2 id="results-heading">研究结果</h2></div>
        {result && <div className="result-count">{result.included.length + result.excluded.length + result.unknown.length} 只股票</div>}
      </div>
      {snapshot && snapshotEnvelope ? <div className={`snapshot-banner snapshot-${snapshotEnvelope.mode}`}>
        <div className="snapshot-icon">{snapshotEnvelope.mode === 'historical' ? '◷' : '●'}</div><div className="snapshot-copy"><strong>{snapshotEnvelope.mode === 'historical' ? '历史快照' : '实时数据'}</strong><span>{snapshotEnvelope.mode === 'historical' ? `截至 ${snapshot.asOf} · 采集于 ${new Date(snapshotEnvelope.evidence.capturedAt).toLocaleString('zh-CN')}` : `数据日期 ${snapshot.asOf}`}</span></div>
        <button className="text-button" type="button" aria-expanded={sourceOpen} aria-label="查看数据来源详情" onClick={() => setSourceOpen((open) => !open)}>数据详情</button>
        <details id="source-details" className="source-details" open={sourceOpen}><summary className="sr-only">数据来源与覆盖情况</summary><p>数据来源：iFinD</p><p>本次候选：{snapshot.coverage.returnedStocks} 只</p><p>总市值日期：{snapshotEnvelope.evidence.statisticDates.marketCap ?? '未知'}</p><p>利润增长日期：{snapshotEnvelope.evidence.statisticDates.netProfitYoy ?? '未知'}</p><p>本次结果是条件检索返回的候选，不保证覆盖沪深北 A 股全部股票。</p>{snapshotEnvelope.error && <p>数据查询暂不可用，请稍后重试。</p>}</details>
      </div> : <div className="results-empty-state"><div className="empty-illustration">⌕</div><h3>你的研究结果会出现在这里</h3><p>运行筛选后，可查看入选、排除和无法判定的股票与对应证据。</p></div>}
      {result && buckets && <>
        {resultIsStale && <p className="provenance-note">显示上次成功查询的结果；修改后的条件尚未取得新结果。</p>}
        <div className="result-layers" aria-label="结果分析层">
          <section className="result-layer" aria-labelledby="condition-match-heading">
            <h3 id="condition-match-heading">条件匹配</h3>
            <p>通过 {result.included.length} 只 · 排除 {result.excluded.length} 只 · 无法判定 {result.unknown.length} 只</p>
            <span>依据本次成功查询的条件逐项判定并展示数据证据。</span>
          </section>
          <section className="result-layer" aria-labelledby="preference-sort-heading">
            <h3 id="preference-sort-heading">偏好排序</h3>
            <p>按{currentStrategy?.sort.field === 'market_cap_cny' ? '总市值' : '归母净利润同比增长率'}{currentStrategy?.sort.direction === 'asc' ? '由低到高' : '由高到低'}</p>
            <span>排序表达本次成功查询的偏好，不改变条件匹配资格。</span>
          </section>
          {snapshot && universeStatistics && insights && <section className="result-layer research-insights" aria-label="研究辅助">
            <h3>研究辅助</h3>
            <p>样本：{universeStatistics.sampleCount} 只，数据日期 {universeStatistics.asOf}；总市值最小 {largeCny(universeStatistics.minimumCny)}、中位数 {largeCny(universeStatistics.medianCny)}、最大 {largeCny(universeStatistics.maximumCny)}。</p>
            <p>样本中总市值达到 {largeCny(universeStatistics.threshold)} 或以上的有 {universeStatistics.atOrAboveThreshold}/{universeStatistics.sampleCount} 只；候选前30%相对门槛约 {largeCny(universeStatistics.top30ThresholdCny)}。</p>
            {insights.limitingCondition && <p>当前限制最多的条件：{insights.limitingCondition.label}（{insights.limitingCondition.excludedCount} 只被排除）。</p>}
            {!!insights.boundaryStocks.length && <p>接近市值门槛：{insights.boundaryStocks.slice(0, 4).map((stock) => stock.name + '（相差' + largeCny(stock.distanceCny) + '）').join('、')}。</p>}
            {!!insights.removedAfterTightening.length && <p>本次收紧后剔除 {insights.removedAfterTightening.length} 只，其中利润同比仍为正的 {insights.removedButStillPositiveProfitGrowth.length} 只。</p>}
            {!!insights.compareSuggestions.length && <p>可比较：{insights.compareSuggestions.slice(0, 2).map((item) => {
              const left = snapshot.stocks.find((stock) => stock.code === item.leftCode)?.name ?? item.leftCode;
              const right = snapshot.stocks.find((stock) => stock.code === item.rightCode)?.name ?? item.rightCode;
              return left + ' 与 ' + right;
            }).join('；')}。这些是基于快照的研究线索。</p>}
            <small>统计采用本次候选中有总市值数据的股票。</small>
          </section>}
        </div>
        <p className="research-disclaimer">条件匹配和排序不等于投资价值判断</p>
        <div className="result-controls"><div className="result-tabs" role="tablist" aria-label="筛选结果类别" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const currentIndex = tabMeta.findIndex((tab) => tab.key === activeTab);
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabMeta.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : tabMeta.length - 1)) % tabMeta.length;
          onTabChange(tabMeta[nextIndex].key);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
        }}>{tabMeta.map(({ key, label }) => <button id={`results-tab-${key}`} role="tab" aria-selected={activeTab === key} aria-controls="results-panel" tabIndex={activeTab === key ? 0 : -1} className={`result-tab ${activeTab === key ? 'active' : ''}`} key={key} onClick={() => onTabChange(key)}>{label}<span>{buckets[key].length}</span></button>)}</div>
          <button className={`secondary-button compare-toggle ${compareOpen ? 'selected' : ''}`} type="button" aria-expanded={compareOpen} onClick={() => setCompareOpen((open) => !open)}>比较股票</button></div>
        <p className="sr-only" role="status">当前显示{tabMeta.find((tab) => tab.key === activeTab)?.label}：{items.length} 只股票。</p>
        <div id="results-panel" role="tabpanel" aria-labelledby={`results-tab-${activeTab}`} tabIndex={0}>
        {items.length ? <div className="stock-list-wrap"><table className="stock-table"><caption className="sr-only">{tabMeta.find((tab) => tab.key === activeTab)?.label}股票列表</caption><thead><tr><th scope="col">股票</th><th scope="col">总市值</th><th scope="col">利润同比</th><th scope="col">本次候选中的市值位置</th><th scope="col">状态</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{items.map((item) => {
          const peer = calculateStockPeerPosition(snapshot!, item.stock.code);
          return <tr key={item.stock.code}>
          <th scope="row"><button className="stock-name-button" onClick={() => onSelectStock(item.stock.code)}><span>{item.stock.name}</span><small>{item.stock.code}</small></button></th>
          <td data-label="总市值">{metric(item.stock, 'market_cap_cny')}</td><td data-label="利润同比">{metric(item.stock, 'net_profit_parent_yoy_pct')}</td><td data-label="本次候选中的市值位置">{peer ? '第' + peer.rank + '/' + peer.total + ' · 前' + peer.percentile.toFixed(0) + '%' : '暂无数据'}</td>
          <td data-label="状态"><span className={`status status-${activeTab === 'included' ? 'passed' : activeTab === 'excluded' ? 'failed' : 'unknown'}`}>{activeTab === 'included' ? '入选' : activeTab === 'excluded' ? '排除' : '无法判定'}</span></td>
          <td><button className="text-button row-compare" onClick={() => { setCompareOpen(true); const next = comparingCodes[0] ? 1 : 0; onCompareSlotChange(next, item.stock.code); }}>{compareOpen && comparingCodes[0] && !comparingCodes[1] ? '加入 B' : '比较'}</button></td>
        </tr>; })}</tbody></table></div> : <div className="empty-tab"><strong>{activeTab === 'included' ? '暂时没有入选股票' : activeTab === 'excluded' ? '没有股票被排除' : '没有无法判定的股票'}</strong><span>{activeTab === 'unknown' ? '数据缺失或指标日期不匹配时，股票会显示在这里。' : '可以调整筛选条件后重新运行。'}</span></div>}
        </div>
      </>}
    </section>
    {compareOpen && snapshot && <StockCompare left={lookup(comparingCodes[0])} right={lookup(comparingCodes[1])} snapshot={snapshot} onChoose={onCompareSlotChange} onClose={() => { setCompareOpen(false); onCompareSlotChange(0, null); onCompareSlotChange(1, null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.compare-toggle')?.focus()); }} />}
    {showDiff && diff ? <><StrategyDiff diff={diff} snapshot={snapshot} previousResult={previousResult} previousStrategy={previousStrategy} currentStrategy={currentStrategy} onSelectStock={onSelectStock} onClose={() => setShowDiff(false)} /><div className="rebase-row"><button className="text-button" onClick={onRebase}>设为比较基准</button></div></> : diff ? <button className="secondary-button show-diff" onClick={() => setShowDiff(true)}>查看筛选变化</button> : null}
    <StockEvidence item={selected} historical={evidenceSnapshot?.source === 'historical'} asOf={evidenceSnapshot?.asOf} queryLabel={selectedQuery === 'previous' ? `比较基准查询 · 策略版本 ${previousResult?.strategyVersion} · 数据日期 ${previousSnapshot?.asOf ?? '未知'}` : undefined} onClose={() => onSelectStock('')} />
  </section>;
}
