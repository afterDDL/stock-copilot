// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopilotWorkspace } from './copilot-workspace';
import type { DataSnapshot, Strategy } from '../lib/domain/types';

const strategy: Strategy = {
  id: 'banks', version: 1, name: '银行股筛选', market: 'cn_a',
  conditions: [
    { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股', aiInferred: false, editable: false },
    { field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '总市值至少1000亿元', aiInferred: true, editable: true },
  ], sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
};
const makeStock = (code: string, name: string, cap: number | null): DataSnapshot['stocks'][number] => ({
  code, name, industry: '银行', metrics: {
    industry: { value: '银行', unit: '行业', date: null, source: 'historical', coverage: 'available' },
    market_cap_cny: { value: cap, unit: '元', date: cap === null ? null : '2026-10-09', source: 'historical', coverage: cap === null ? 'missing' : 'available' },
    net_profit_parent_yoy_pct: { value: 4, unit: '%', date: '2026-06-30', source: 'historical', coverage: 'available' },
  },
});
const snapshot: DataSnapshot = {
  snapshotId: 'snap', source: 'historical', asOf: '2026-10-09',
  stocks: [makeStock('600000', '浦发银行', 110_000_000_000), makeStock('600001', '平安银行', 50_000_000_000), makeStock('600002', '未知银行', null)],
  coverage: { expectedStocks: 3, returnedStocks: 3, complete: true, metrics: {
    industry: { available: 3, missing: 0 }, market_cap_cny: { available: 2, missing: 1 }, net_profit_parent_yoy_pct: { available: 3, missing: 0 },
  } },
};

describe('CopilotWorkspace', () => {
  it('opens on the full A-share market with the requested example and no bank-only product copy', () => {
    render(<CopilotWorkspace />);
    expect(screen.getAllByText('沪深北 A 股').length).toBeGreaterThan(0);
    expect(screen.getByText('描述你想找的股票')).toBeInTheDocument();
    expect(screen.getByText('找市值较大、利润仍在增长的股票，增长更快的优先。')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/仅支持银行|银行股研究|描述你想找的银行股|银行股 · P0/);
  });

  it('lets users add and remove an optional industry condition', async () => {
    const user = userEvent.setup();
    const noIndustryStrategy = { ...strategy, conditions: strategy.conditions.filter((condition) => condition.field !== 'industry') };
    render(<CopilotWorkspace intentRequest={vi.fn().mockResolvedValue({ strategy: noIndustryStrategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '找利润增长的股票');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('AI 推断')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '所属行业' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('添加筛选条件'), 'industry');
    await user.click(screen.getByRole('button', { name: '添加条件' }));
    expect(screen.getByRole('textbox', { name: '所属行业' })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: '所属行业' }), '电子');
    expect(screen.getByRole('textbox', { name: '所属行业' })).toHaveValue('电子');
    await user.click(screen.getByRole('button', { name: '移除所属行业条件' }));
    expect(screen.queryByRole('textbox', { name: '所属行业' })).not.toBeInTheDocument();
  });

  it('shows one concise unsupported-indicator message without internal details', async () => {
    const user = userEvent.setup();
    render(<CopilotWorkspace intentRequest={vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [{ request: 'ROE', reason: 'internal_field=roe_pct' }], canExecute: false })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '找 ROE 高的股票');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('暂不支持“ROE”指标查询。')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/internal_field|暂不支持「ROE」/);
  });

  it('describes market-wide mixed-industry ranks as candidate positions', async () => {
    const user = userEvent.setup();
    const mixedSnapshot: DataSnapshot = { ...snapshot, stocks: snapshot.stocks.map((stock, index) => index === 0 ? stock : { ...stock, industry: '电子', metrics: { ...stock.metrics, industry: { ...stock.metrics.industry, value: '电子' } } }) };
    const allMarket = { ...strategy, conditions: strategy.conditions.filter((item) => item.field !== 'industry') };
    render(<CopilotWorkspace
      intentRequest={async () => ({ strategy: allMarket, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })}
      stockSearchRequest={async () => ({ mode: 'live', snapshot: mixedSnapshot, coverage: mixedSnapshot.coverage, evidence: { source: 'iFinD', capturedAt: '2026-10-10T00:00:00Z', statisticDates: {}, liveRequests: 2 } })}
    />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '市值至少1000亿元');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await user.click(await screen.findByRole('button', { name: '运行筛选' }));
    expect(await screen.findByRole('columnheader', { name: '本次候选中的市值位置' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '研究辅助' })).toHaveTextContent('候选前30%');
    expect(document.body).not.toHaveTextContent('同业');
  });

  it('renders industry concepts and unknown concepts without internal identifiers', async () => {
    const user = userEvent.setup();
    render(<CopilotWorkspace intentRequest={async () => ({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true, mappings: [
      { originalExpression: '银行股', concept: 'industry_scope', field: 'industry', state: 'confirmed', action: 'condition', explanation: '按行业匹配。' },
      { originalExpression: '其他要求', concept: 'provider_internal_concept', state: 'needs_clarification', action: 'clarify', explanation: '请补充条件。' },
    ] })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    const panel = await screen.findByRole('region', { name: '意图映射' });
    expect(panel).toHaveTextContent('行业范围 → 所属行业');
    expect(panel).toHaveTextContent('筛选要求');
    expect(panel).not.toHaveTextContent(/industry_scope|provider_internal_concept/);
  });

  it('keeps the last successful result when a later search needs narrowing and hides the data boundary in details', async () => {
    const user = userEvent.setup();
    const stockSearchRequest = vi.fn()
      .mockResolvedValueOnce({ mode: 'live', snapshot, coverage: snapshot.coverage, evidence: { source: 'iFinD MCP search_stocks controlled single-indicator queries', capturedAt: '2026-10-10T00:00:00Z', statisticDates: {}, liveRequests: 2 } })
      .mockRejectedValueOnce(new Error('结果较多，请补充行业或提高筛选门槛。'));
    render(<CopilotWorkspace
      intentRequest={vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })}
      stockSearchRequest={stockSearchRequest}
    />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '找市值较大的股票');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('AI 推断');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    const includedTable = await screen.findByRole('table', { name: '入选股票列表' });
    expect(within(includedTable).getByText('浦发银行')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看数据来源详情' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: '查看数据来源详情' }));
    expect(document.body).toHaveTextContent('本次结果是条件检索返回的候选，不保证覆盖沪深北 A 股全部股票。');
    expect(document.body).toHaveTextContent('数据来源：iFinD');
    expect(document.body).not.toHaveTextContent(/MCP|search_stocks|实时查询步骤|ceil/);
    await user.clear(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }));
    await user.type(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }), '200000000000');
    await user.selectOptions(screen.getByLabelText('利润增长排序'), 'asc');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('结果较多，请补充行业或提高筛选门槛。');
    expect(within(screen.getByRole('table', { name: '入选股票列表' })).getByText('浦发银行')).toBeInTheDocument();
    expect(screen.getByText('显示上次成功查询的结果；修改后的条件尚未取得新结果。')).toBeInTheDocument();
    expect(screen.getByText('按归母净利润同比增长率由高到低')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '研究辅助' })).toHaveTextContent('达到 1,000 亿元');
    expect(stockSearchRequest).toHaveBeenCalledTimes(2);
  });

  it('opens the original named stock evidence when a fresh candidate query removes it', async () => {
    const user = userEvent.setup();
    const smallerSnapshot: DataSnapshot = { ...snapshot, snapshotId: 'smaller-snap', asOf: '2026-10-10', stocks: [], coverage: { expectedStocks: 0, returnedStocks: 0, complete: true, metrics: { industry: { available: 0, missing: 0 }, market_cap_cny: { available: 0, missing: 0 }, net_profit_parent_yoy_pct: { available: 0, missing: 0 } } } };
    const wrap = (value: DataSnapshot) => ({ mode: 'live', snapshot: value, coverage: value.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-10T00:00:00Z', statisticDates: {}, liveRequests: 2 } });
    render(<CopilotWorkspace
      intentRequest={async () => ({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })}
      stockSearchRequest={vi.fn().mockResolvedValueOnce(wrap(snapshot)).mockResolvedValueOnce(wrap(smallerSnapshot))}
    />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await user.click(await screen.findByRole('button', { name: '运行筛选' }));
    await screen.findByRole('table', { name: '入选股票列表' });
    await user.clear(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }));
    await user.type(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }), '200000000000');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    const changes = await screen.findByRole('region', { name: '筛选变化' });
    await user.click(within(changes).getByRole('button', { name: /浦发银行.*600000.*剔除/ }));
    const evidence = screen.getByRole('dialog', { name: '股票证据：浦发银行' });
    expect(evidence).toHaveTextContent('比较基准查询 · 策略版本 1 · 数据日期 2026-10-09');
    expect(evidence).toHaveTextContent('门槛 1000 亿元');
    expect(evidence).not.toHaveTextContent('门槛 2000 亿元');
  });

  it('shows distinct result tabs and opens condition evidence for a selected stock', async () => {
    const user = userEvent.setup();
    render(<CopilotWorkspace intentRequest={vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })}
      stockSearchRequest={vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: { marketCap: '2026-10-09', netProfitYoy: '2026-06-30' }, liveRequests: [] } })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '找大市值银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('AI 推断');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    expect(await screen.findByText('历史快照')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /入选/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /排除/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /无法判定/ })).toHaveTextContent('1');
    expect(screen.queryByRole('region', { name: '筛选变化' })).not.toBeInTheDocument();
    screen.getByRole('tab', { name: /入选/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /排除/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /排除/ })).toHaveAttribute('aria-controls', 'results-panel');
    expect(screen.getByRole('tabpanel', { name: /排除/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /排除/ })).toHaveAttribute('tabindex', '0');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /无法判定/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /无法判定/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /入选/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /入选/ }));
    await user.click(within(screen.getByRole('table', { name: '入选股票列表' })).getByRole('button', { name: /浦发银行/ }));
    const evidence = screen.getByRole('dialog', { name: '股票证据：浦发银行' });
    expect(within(evidence).getByText(/筛选表达：总市值至少1000亿元/)).toBeInTheDocument();
    expect(within(evidence).getAllByText(/2026-10-09/).length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits a threshold, shows same-snapshot Diff, compares distinct stocks, and saves locally', async () => {
    const user = userEvent.setup();
    const storage = { list: vi.fn().mockReturnValue([]), save: vi.fn().mockReturnValue({ id: 'saved-1', name: '自定义策略', strategy, createdAt: '', updatedAt: '' }), load: vi.fn(), delete: vi.fn() };
    render(<CopilotWorkspace storage={storage} intentRequest={vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })}
      stockSearchRequest={vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: {}, liveRequests: [] } })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '找大市值银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('AI 推断');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    await within(screen.getByRole('table', { name: '入选股票列表' })).findByText('浦发银行');
    await user.clear(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }));
    await user.type(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }), '200000000000');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    expect(await screen.findByRole('region', { name: '筛选变化' })).toHaveTextContent('剔除');
    expect(screen.getByRole('region', { name: '研究辅助' })).toHaveTextContent('利润同比仍为正');
    expect(screen.getByRole('region', { name: '研究辅助' })).not.toHaveTextContent('正利润同比偏好');
    await user.click(screen.getByRole('button', { name: '比较股票' }));
    expect(await screen.findByRole('region', { name: '股票比较' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /排除/ }));
    await user.click(within(screen.getByRole('table', { name: '排除股票列表' })).getAllByRole('button', { name: '比较' })[0]);
    await user.selectOptions(screen.getByRole('combobox', { name: '选择股票B' }), '600001');
    const compareRegion = screen.getByRole('region', { name: '股票比较' });
    expect(await within(compareRegion).findByRole('table', { name: '股票指标对比' })).toHaveTextContent('平安银行');
    await user.click(screen.getByRole('button', { name: /已保存策略/ }));
    await user.click(screen.getByRole('button', { name: /^保存策略$/ }));
    expect(storage.save).toHaveBeenCalled();
    expect(await screen.findByText('已保存策略')).toBeInTheDocument();
  });

  it('blocks a conflicting strategy and repairs the named upper-bound condition in one action', async () => {
    const conflicting: Strategy = { ...strategy, conditions: [...strategy.conditions,
      { ...strategy.conditions[1], operator: 'lte', value: 50_000_000_000, sourceExpression: '总市值最多500亿元' },
    ] };
    const user = userEvent.setup();
    render(<CopilotWorkspace intentRequest={vi.fn().mockResolvedValue({ strategy: conflicting, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '大市值银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('alert', { name: /条件存在冲突/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行筛选' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '移除上限条件' }));
    expect(screen.queryByRole('alert', { name: /条件存在冲突/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行筛选' })).toBeEnabled();
  });

  it('renders every clarification as a real answer field and resubmits the original query with the current strategy', async () => {
    const intentRequest = vi.fn()
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: ['使用哪个报告期？', '总市值最低门槛是多少？'], unsupportedRequests: [], canExecute: false })
      .mockResolvedValueOnce({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true });
    const user = userEvent.setup();
    render(<CopilotWorkspace intentRequest={intentRequest} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '帮我挑选银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByLabelText('澄清回答 1：使用哪个报告期？')).toBeInTheDocument();
    expect(screen.getByLabelText('澄清回答 2：总市值最低门槛是多少？')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /按 2026 年中报/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行筛选' })).toBeDisabled();
    await user.type(screen.getByLabelText('澄清回答 1：使用哪个报告期？'), '2026年中报');
    await user.type(screen.getByLabelText('澄清回答 2：总市值最低门槛是多少？'), '至少1000亿元');
    await user.click(screen.getByRole('button', { name: '提交补充说明' }));
    await waitFor(() => expect(intentRequest).toHaveBeenCalledTimes(2));
    expect(intentRequest).toHaveBeenNthCalledWith(2,
      '帮我挑选银行股\n\n澄清回答：\n- 使用哪个报告期？：2026年中报\n- 总市值最低门槛是多少？：至少1000亿元', strategy);
    await waitFor(() => expect(screen.getByRole('button', { name: '运行筛选' })).toBeEnabled());
  });

  it('surfaces storage failures as a visible, non-blocking saved-strategy warning', () => {
    const storage = { list: () => [], save: vi.fn(), load: vi.fn(), delete: vi.fn(), warning: () => '本地保存暂不可用，已保存的策略无法读取。' };
    render(<CopilotWorkspace storage={storage} />);
    expect(screen.getByRole('status')).toHaveTextContent('本地保存暂不可用');
    expect(screen.getByRole('textbox', { name: '请输入选股需求' })).toBeEnabled();
  });

  it('shows resolver provenance and separates matching, sorting, and research facts', async () => {
    const user = userEvent.setup();
    const mappings = [
      { originalExpression: '盘子大一点', concept: 'company_size', field: 'market_cap_cny', state: 'assumed', action: 'condition', explanation: '银行场景产品预设，不是行业标准。', unit: '元', statisticDate: '2026-10-09', defaultSource: '产品预设：1000亿元' },
    ];
    render(<CopilotWorkspace
      intentRequest={vi.fn().mockResolvedValue({ strategy, assumptions: ['按总市值≥1000亿元处理'], clarifications: [], unsupportedRequests: [], canExecute: true, mappings })}
      stockSearchRequest={vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: {}, liveRequests: [] } })}
    />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '盘子大一点');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('region', { name: '意图映射' })).toHaveTextContent('盘子大一点');
    expect(screen.getByRole('region', { name: '意图映射' })).toHaveTextContent('产品预设：1000亿元');
    expect(screen.getByRole('region', { name: '意图映射' })).toHaveTextContent('公司规模 → 总市值');
    expect(screen.getByRole('region', { name: '意图映射' })).not.toHaveTextContent(/company_size|market_cap_cny/);
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    expect(await screen.findByRole('heading', { name: '条件匹配' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '偏好排序' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '研究辅助' })).toHaveTextContent('样本');
    expect(screen.getByRole('region', { name: '研究辅助' })).toHaveTextContent('候选前30%');
    expect(screen.getByRole('columnheader', { name: '本次候选中的市值位置' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('同业');
    expect(screen.getByText('条件匹配和排序不等于投资价值判断')).toBeInTheDocument();
  });
});
