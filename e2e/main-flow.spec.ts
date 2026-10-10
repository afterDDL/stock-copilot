import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Condition = {
  field: 'industry' | 'market_cap_cny' | 'net_profit_parent_yoy_pct';
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number;
  unit: '行业' | '元' | '%';
  statisticDate: string | null;
  sourceExpression: string;
  aiInferred: boolean;
  editable: boolean;
};

const snapshotEnvelope = JSON.parse(
  readFileSync(new URL('../data/bank-snapshot.json', import.meta.url), 'utf8'),
);

function condition(
  field: Condition['field'],
  operator: Condition['operator'],
  value: string | number,
  sourceExpression: string,
  aiInferred = false,
): Condition {
  return {
    field,
    operator,
    value,
    unit: field === 'industry' ? '行业' : field === 'market_cap_cny' ? '元' : '%',
    statisticDate: field === 'industry' ? null : field === 'market_cap_cny' ? '2026-10-09' : '2026-06-30',
    sourceExpression,
    aiInferred,
    editable: aiInferred || field !== 'industry',
  };
}

function strategy(conditions = [
  condition('industry', 'eq', '银行', '银行股基础范围'),
  condition('market_cap_cny', 'gte', 100_000_000_000, '盘子大（默认按总市值≥1000亿元）', true),
  condition('net_profit_parent_yoy_pct', 'gt', 0, '业绩增长（归母净利润同比>0%）'),
]) {
  return {
    id: 'bank-screening',
    version: 1,
    name: '银行股筛选',
    market: 'cn_a',
    conditions,
    sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
  };
}

function liveEnvelope(industry?: string) {
  const snapshot = structuredClone(snapshotEnvelope.snapshot);
  if (industry === '电子-半导体') {
    snapshot.snapshotId = 'ifind-electronics-e2e';
    snapshot.source = 'live';
    snapshot.stocks = [{
      code: '688001', name: '华兴源创', industry,
      metrics: {
        industry: { value: industry, unit: '行业', date: null, source: 'live', coverage: 'available' },
        market_cap_cny: { value: 26_030_422_168.8, unit: '元', date: '2026-10-09', source: 'live', coverage: 'available' },
        net_profit_parent_yoy_pct: { value: 20.85, unit: '%', date: '2026-06-30', source: 'live', coverage: 'available' },
      },
    }];
    snapshot.coverage = {
      expectedStocks: 1, returnedStocks: 1, complete: true,
      metrics: {
        industry: { available: 1, missing: 0 },
        market_cap_cny: { available: 1, missing: 0 },
        net_profit_parent_yoy_pct: { available: 1, missing: 0 },
      },
    };
  } else if (industry) {
    for (const stock of snapshot.stocks) {
      stock.industry = industry;
      stock.metrics.industry.value = industry;
    }
  }
  return {
    mode: 'live', snapshot, coverage: snapshot.coverage,
    evidence: {
      source: 'E2E deterministic iFinD fixture', capturedAt: '2026-10-10T00:00:00.000Z',
      statisticDates: { marketCap: '2026-10-09', netProfitYoy: '2026-06-30' }, liveRequests: 2,
    },
  };
}

function intent(strategyValue = strategy(), extra: Record<string, unknown> = {}) {
  return {
    strategy: strategyValue,
    assumptions: ['将“盘子大”按总市值≥1000亿元解释；此阈值可编辑。'],
    clarifications: [],
    unsupportedRequests: [],
    canExecute: true,
    ...extra,
  };
}

function strategyForQuery(query: string) {
  if (/全市场股票/u.test(query)) {
    return strategy([condition('market_cap_cny', 'gte', 1, '总市值大于0元')]);
  }
  if (/全市场|全A股|沪深北/u.test(query)) {
    return strategy([
      condition('market_cap_cny', 'gte', 100_000_000_000, '总市值至少1000亿元'),
      condition('net_profit_parent_yoy_pct', 'gt', 0, '归母净利润同比增长率大于0%'),
    ]);
  }
  if (/电子半导体行业/u.test(query)) {
    return strategy([
      condition('industry', 'eq', '电子-半导体', '电子半导体行业'),
      condition('market_cap_cny', 'gte', 20_000_000_000, '总市值至少200亿元'),
      condition('net_profit_parent_yoy_pct', 'gt', 0, '归母净利润同比增长率大于0%'),
    ]);
  }
  return strategy();
}

async function installDeterministicApiRoutes(page: Page) {
  await page.route('**/api/intent', async (route: Route) => {
    const request = route.request().postDataJSON() as { query: string };
    const query = request.query;
    if (query.includes('稳一点') && !query.includes('澄清回答')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ intent: intent(strategy([condition('industry', 'eq', '银行', '银行股基础范围')]), {
          assumptions: [],
          clarifications: ['你说的“稳”是指股价波动较小，还是财务状况稳健？'],
          canExecute: false,
        }) }),
      });
      return;
    }
    if (query.includes('冲突')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ intent: intent(strategy([
          condition('industry', 'eq', '银行', '银行股基础范围'),
          condition('market_cap_cny', 'gte', 200_000_000_000, '总市值不低于2000亿元'),
          condition('market_cap_cny', 'lte', 100_000_000_000, '总市值不高于1000亿元'),
          condition('net_profit_parent_yoy_pct', 'gt', 0, '业绩增长（归母净利润同比>0%）'),
        ]), {
          assumptions: [],
        }) }),
      });
      return;
    }
    if (query.includes('PB') || query.includes('收益') || query.includes('翻倍')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ intent: intent(strategy([condition('industry', 'eq', '银行', '银行股基础范围')]), {
          assumptions: [],
          unsupportedRequests: [
            { request: 'PB估值', reason: '当前没有经过验证的 PB 数据，不能用于筛选。' },
            { request: '收益预测', reason: '当前功能不提供未来收益或股价预测。' },
          ],
          canExecute: false,
        }) }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ intent: intent(strategyForQuery(query)) }) });
  });

  await page.route('**/api/stock-search', async (route: Route) => {
    const { strategy: requestStrategy } = route.request().postDataJSON() as { strategy: ReturnType<typeof strategy> };
    const narrow = !requestStrategy.conditions.some((item) => item.field === 'industry')
      && requestStrategy.conditions.every((item) => item.field !== 'market_cap_cny'
        || (typeof item.value === 'number' && item.value < 100_000_000_000));
    await route.fulfill({
      status: narrow ? 422 : 200,
      contentType: 'application/json',
      body: JSON.stringify(narrow
        ? { error: { code: 'needs_narrowing', message: '结果较多，请补充行业或提高筛选门槛。' } }
        : liveEnvelope(requestStrategy.conditions.find((item) => item.field === 'industry')?.value as string | undefined)),
    });
  });
}

async function submitIntent(page: Page, query: string) {
  await page.getByRole('textbox', { name: '请输入选股需求' }).fill(query);
  await page.getByRole('button', { name: '发送' }).click();
}

async function runScreen(page: Page) {
  await page.getByRole('button', { name: '运行筛选' }).click();
  await expect(page.getByRole('tab', { name: /入选/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installDeterministicApiRoutes(page);
  await page.goto('/');
});

test('turns a fuzzy bank-stock request into an editable 1000→2000 billion diff with evidence and profit sorting', async ({ page }) => {
  await submitIntent(page, '找盘子大的银行股，利润增长快的优先');
  await expect(page.getByText('AI 推断')).toBeVisible();
  await expect(page.getByText(/已按此理解：将“盘子大”/)).toBeVisible();
  await runScreen(page);

  await expect(page.getByRole('tab', { name: /入选/ })).toContainText('16');
  await expect(page.getByText('实时数据').first()).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toContainText('宁波银行');

  const marketCap = page.getByRole('spinbutton', { name: '总市值门槛（元）' });
  await marketCap.fill('200000000000');
  await marketCap.press('Tab');
  await runScreen(page);

  await expect(page.getByRole('tab', { name: /入选/ })).toContainText('12');
  await expect(page.getByText('总市值门槛从 1,000 亿元调整为 2,000 亿元。')).toBeVisible();
  await expect(page.locator('.diff-column').filter({ hasText: '不再入选' })).toContainText('4');
  await page.getByRole('tab', { name: /排除/ }).click();
  const nanjing = page.getByRole('row', { name: /南京银行/ });
  await expect(nanjing).toBeVisible();
  await nanjing.getByRole('button', { name: '南京银行' }).click();
  await expect(page.getByRole('dialog', { name: /股票证据：南京银行/ })).toContainText('总市值为 1472.5 亿元，不低于门槛 2000 亿元');
});

test('blocks contradictory conditions until the user removes the conflicting upper bound', async ({ page }) => {
  await submitIntent(page, '找一只条件冲突的银行股');

  await expect(page.getByRole('heading', { name: '条件存在冲突' })).toBeVisible();
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeDisabled();
  await page.getByRole('button', { name: '移除上限条件' }).click();
  await expect(page.getByRole('heading', { name: '条件存在冲突' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeEnabled();
  await runScreen(page);
  await expect(page.getByRole('tab', { name: /入选/ })).toContainText('12');
});

test('asks for clarification before making an ambiguous stability request executable', async ({ page }) => {
  await submitIntent(page, '找稳一点的银行股');

  await expect(page.getByRole('heading', { name: '请补充以下信息' })).toBeVisible();
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeDisabled();
  await page.getByRole('textbox', { name: /澄清回答 1/ }).fill('指财务状况稳健');
  await page.getByRole('button', { name: '提交补充说明' }).click();
  await expect(page.getByRole('heading', { name: '请补充以下信息' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeEnabled();
});

test('compares two stocks and saves then restores an edited strategy', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await submitIntent(page, '找盘子大的银行股，利润增长快的优先');
  await runScreen(page);

  await page.getByRole('button', { name: '比较股票' }).click();
  await page.getByRole('combobox', { name: '选择股票A' }).selectOption('002142');
  await page.getByRole('combobox', { name: '选择股票B' }).selectOption('600036');
  const comparison = page.getByRole('table', { name: '股票指标对比' });
  await expect(comparison).toContainText('宁波银行');
  await expect(comparison).toContainText('招商银行');

  await page.getByRole('button', { name: /已保存策略/ }).click();
  await page.getByRole('textbox', { name: '保存名称' }).fill('我的银行策略');
  await page.getByRole('button', { name: '保存策略', exact: true }).click();
  const savedStrategy = page.locator('.saved-load').filter({ hasText: '我的银行策略' });
  await expect(savedStrategy).toBeVisible();

  const marketCap = page.getByRole('spinbutton', { name: '总市值门槛（元）' });
  await marketCap.fill('300000000000');
  await marketCap.press('Tab');
  await expect(marketCap).toHaveValue('300000000000');

  await page.reload();
  await expect(page.getByRole('button', { name: /已保存策略/ })).toContainText('1');
  await page.getByRole('button', { name: /已保存策略/ }).click();
  await savedStrategy.click();
  await expect(marketCap).toHaveValue('100000000000');
  await expect(page.getByText('已载入策略，请运行筛选以获取当前数据。')).toBeVisible();
  expect(pageErrors).not.toEqual(expect.arrayContaining([expect.stringContaining('Hydration failed')]));
});

test('keeps unsupported valuation and return prediction requests visible and non-executable', async ({ page }) => {
  await submitIntent(page, '找 PB 估值低、下周收益翻倍的银行股');

  await expect(page.getByRole('heading', { name: '暂不支持的要求' })).toBeVisible();
  await expect(page.getByText('暂不支持“PB估值”指标查询。', { exact: true })).toBeVisible();
  await expect(page.getByText('暂不支持“收益预测”指标查询。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeDisabled();
});

test('sends the exact natural-language request through the intent API without marking supported criteria unsupported', async ({ page }) => {
  const exactPrompt = '找些业绩还在增长、利润增长越快越好的银行股';
  const apiRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/intent');
  const apiResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/intent');

  await submitIntent(page, exactPrompt);

  const apiRequest = await apiRequestPromise;
  const apiResponse = await apiResponsePromise;
  expect(apiRequest.method()).toBe('POST');
  expect(apiRequest.postDataJSON()).toEqual({ query: exactPrompt });
  expect(apiResponse.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '暂不支持的要求' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeEnabled();
});

test('runs bounded market-wide and explicit non-bank searches through POST /api/stock-search', async ({ page }) => {
  await submitIntent(page, '全市场总市值至少1000亿元且利润同比增长');
  await expect(page.getByRole('button', { name: '运行筛选' })).toBeEnabled();
  const marketRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/stock-search');
  await runScreen(page);
  const marketPost = await marketRequest;
  expect(marketPost.method()).toBe('POST');
  const marketStrategy = (marketPost.postDataJSON() as { strategy: { conditions: Condition[] } }).strategy;
  expect(marketStrategy.conditions.some((item) => item.field === 'industry')).toBe(false);
  await expect(page.getByText('实时数据')).toBeVisible();
  await page.getByRole('button', { name: '查看数据来源详情' }).click();
  await expect(page.locator('#source-details')).toContainText('本次结果是条件检索返回的候选，不保证覆盖沪深北 A 股全部股票。');

  await submitIntent(page, '筛选电子半导体行业股票，总市值至少200亿元且利润同比增长');
  const industryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/stock-search');
  await runScreen(page);
  const industryPost = await industryRequest;
  expect(industryPost.method()).toBe('POST');
  expect((industryPost.postDataJSON() as { strategy: { conditions: Condition[] } }).strategy.conditions)
    .toContainEqual(expect.objectContaining({ field: 'industry', value: '电子-半导体' }));
  await expect(page.getByRole('row').nth(1)).toContainText('华兴源创');
  await expect(page.getByRole('row').nth(1)).toContainText('688001');
  await expect(page.getByRole('row').nth(1)).toContainText('260.3 亿元');
  await expect(page.getByRole('row').nth(1)).toContainText('20.85%');
  await page.getByRole('row').nth(1).getByRole('button', { name: '华兴源创' }).click();
  await expect(page.getByRole('dialog')).toContainText('电子-半导体');
});

test('shows the concise narrowing message when broad candidate search is rejected', async ({ page }) => {
  await submitIntent(page, '全市场股票');
  await page.getByRole('button', { name: '运行筛选' }).click();
  await expect(page.getByRole('region', { name: '选股对话' }).getByRole('alert'))
    .toHaveText('结果较多，请补充行业或提高筛选门槛。');
  await expect(page.getByRole('tab', { name: /入选/ })).toHaveCount(0);
});
