// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopilotWorkspace } from './copilot-workspace';
import type { DataSnapshot, Strategy } from '../lib/domain/types';

const strategy: Strategy = {
  id: 'banks', version: 1, name: '银行股筛选', industry: 'bank',
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
  it('shows distinct result tabs and opens condition evidence for a selected stock', async () => {
    const user = userEvent.setup();
    render(<CopilotWorkspace intentRequest={vi.fn().mockResolvedValue({ strategy, assumptions: [], clarifications: [], unsupportedRequests: [], canExecute: true })}
      snapshotRequest={vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: { marketCap: '2026-10-09', netProfitYoy: '2026-06-30' }, liveRequests: [] } })} />);
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
      snapshotRequest={vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: {}, liveRequests: [] } })} />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '找大市值银行股');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('AI 推断');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    await within(screen.getByRole('table', { name: '入选股票列表' })).findByText('浦发银行');
    await user.clear(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }));
    await user.type(screen.getByRole('spinbutton', { name: '总市值门槛（元）' }), '200000000000');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    expect(await screen.findByRole('region', { name: '筛选变化' })).toHaveTextContent('剔除');
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
      snapshotRequest={vi.fn().mockResolvedValue({ mode: 'historical', snapshot, coverage: snapshot.coverage, evidence: { source: 'fixture', capturedAt: '2026-10-09T00:00:00Z', statisticDates: {}, liveRequests: [] } })}
    />);
    await user.type(screen.getByRole('textbox', { name: '请输入选股需求' }), '盘子大一点');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('region', { name: '意图映射' })).toHaveTextContent('盘子大一点');
    expect(screen.getByRole('region', { name: '意图映射' })).toHaveTextContent('产品预设：1000亿元');
    await user.click(screen.getByRole('button', { name: '运行筛选' }));
    expect(await screen.findByRole('heading', { name: '条件匹配' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '偏好排序' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '研究辅助' })).toHaveTextContent('样本');
    expect(screen.getByText('条件匹配和排序不等于投资价值判断')).toBeInTheDocument();
  });
});
