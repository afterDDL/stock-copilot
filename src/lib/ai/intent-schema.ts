import { z } from 'zod';
import { strategySchema } from '../domain/schema';
import { INDICATOR_META, type Condition, type Indicator, type Strategy } from '../domain/types';

const fieldSchema = z.enum(['industry', 'market_cap_cny', 'net_profit_parent_yoy_pct']);
const conditionChangeSchema = z.object({
  field: fieldSchema,
  operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']),
  value: z.union([z.number().finite(), z.string().min(1)]),
  unit: z.enum(['行业', '元', '%']),
  action: z.enum(['upsert', 'remove']),
  source_expression: z.string().min(1),
  ai_inferred: z.boolean(),
  editable: z.boolean(),
}).strict().superRefine((change, context) => {
  const isIndustry = change.field === 'industry';
  if (change.unit !== INDICATOR_META[change.field].unit) {
    context.addIssue({ code: 'custom', path: ['unit'], message: 'Unit does not match field.' });
  }
  if (isIndustry !== (typeof change.value === 'string')) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Value type does not match field.' });
  }
  if (isIndustry && (change.operator !== 'eq' || change.action === 'remove')) {
    context.addIssue({ code: 'custom', path: ['operator'], message: 'Bank industry cannot be changed or removed.' });
  }
});

export const intentDeltaSchema = z.object({
  condition_changes: z.array(conditionChangeSchema),
  sort_direction: z.enum(['asc', 'desc']).nullable(),
  assumptions: z.array(z.string().min(1)),
  clarifications: z.array(z.string().min(1)),
  unsupported_requests: z.array(z.object({ request: z.string().min(1), reason: z.string().min(1) }).strict()),
}).strict();

export type UnsupportedRequest = { request: string; reason: string };
export type IntentResponse = {
  strategy: Strategy;
  assumptions: string[];
  clarifications: string[];
  unsupportedRequests: UnsupportedRequest[];
  canExecute: boolean;
};

export class IntentOutputError extends Error {
  constructor(public readonly kind: 'empty' | 'truncated' | 'schema_invalid', message: string) {
    super(message);
    this.name = 'IntentOutputError';
  }
}

const freshCondition = (field: Indicator, value: number | string, operator: Condition['operator'], sourceExpression: string, aiInferred: boolean): Condition => ({
  field,
  operator,
  value,
  unit: INDICATOR_META[field].unit,
  statisticDate: field === 'industry' ? null : field === 'market_cap_cny' ? '2026-10-09' : '2026-06-30',
  sourceExpression,
  aiInferred,
  editable: aiInferred,
});

const defaultConditions = (query: string, strategy: Strategy | null): Condition[] => {
  const conditions = strategy?.conditions.map((condition) => ({ ...condition })) ?? [
    freshCondition('industry', '银行', 'eq', '银行股基础范围', false),
  ];
  if (/盘子大|大盘/.test(query) && !conditions.some((condition) => condition.field === 'market_cap_cny')) {
    conditions.push(freshCondition('market_cap_cny', 100000000000, 'gte', '盘子大（默认按总市值≥1000亿元）', true));
  }
  if (/业绩增长|利润增长/.test(query) && !conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct')) {
    conditions.push(freshCondition('net_profit_parent_yoy_pct', 0, 'gt', '业绩增长（归母净利润同比>0%）', false));
  }
  return conditions;
};

function parseModelOutput(output: unknown) {
  if (typeof output !== 'string') return intentDeltaSchema.safeParse(output);
  if (!output.trim()) throw new IntentOutputError('empty', 'DeepSeek returned an empty intent.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch {
    const opens = (output.match(/[\[{]/g) ?? []).length;
    const closes = (output.match(/[\]}]/g) ?? []).length;
    if (opens > closes || /[:,]\s*$/.test(output)) {
      throw new IntentOutputError('truncated', 'DeepSeek returned a truncated intent.');
    }
    throw new IntentOutputError('schema_invalid', 'DeepSeek returned invalid JSON.');
  }
  const parsed = intentDeltaSchema.safeParse(decoded);
  if (!parsed.success) throw new IntentOutputError('schema_invalid', 'DeepSeek intent did not match the required schema.');
  return { success: true as const, data: parsed.data };
}

function detectUnsupportedFinancialMetric(query: string): string | null {
  const patterns = [
    /经营现金流|现金流量(?:表)?|自由现金流|现金流/i,
    /营业收入|主营业务收入|营收|销售收入/i,
    /净资产收益率|总资产收益率|资产负债率|负债率|资本充足率|不良贷款率|拨备覆盖率|净息差/i,
    /市盈率|市净率|股息率|股息|股利|分红/i,
    /每股(?:收益|净资产|现金流)|(?:ROE|ROA|ROIC|EPS|PE|PB)\b/i,
    /[\u4e00-\u9fff]{2,10}(?:周转率|收益率|利润率|费用率|现金比率|流动比率|速动比率|偿债能力)/,
    /财务指标|财务比率|盈利能力指标/,
  ];
  const match = patterns.map((pattern) => query.match(pattern)?.[0]).find(Boolean);
  if (match) return match;

  const genericMetric = query.match(/[\u4e00-\u9fff]{2,10}(?:比率|增长率|收益率|周转率|利润率|现金流|每股收益)/)?.[0];
  if (!genericMetric) return null;
  const normalizedMetric = genericMetric.replace(/^(?:按|按照|根据|筛选|排序)+/, '');
  if (supportedMetricAliases.includes(normalizedMetric)) return null;
  if (/^(?:归母净利润同比增长率|净利润同比增长率|利润同比增长率)$/.test(normalizedMetric)) return null;
  if (/业绩增长|利润增长|归母净利润.*同比.*增长/.test(query) && /增长率/.test(genericMetric)) return null;
  return genericMetric;
}

const supportedMetricAliases = [
  '归母净利润同比增长率', '净利润同比增长率', '利润同比增长率', '归母净利润同比', '净利润同比',
  '归母净利润增速', '净利润增速', '利润增速', '业绩增速', '归母净利润', '总市值', '大市值',
  '盘子大', '大盘', '市值', '银行行业', '所属行业', '行业', '业绩增长', '利润增长',
].sort((left, right) => right.length - left.length);

function residualMetricText(subject: string): string {
  let residual = subject
    .replace(/(?:至少|不低于|大于等于|大于|小于|超过|高于|低于|达到|≥|<=|>=|<|>).*$/, '')
    .replace(/[\d.]+\s*(?:万亿|亿元|亿|万元|元|%?)$/g, '')
    .replace(/(?:按照?|根据|筛选|排序|降序|升序|条件|指标|选股|股票|个股|银行股?|的|里|中)/g, '');
  for (const alias of supportedMetricAliases) residual = residual.replaceAll(alias, '');
  return residual
    .replace(/(?:经营稳健|经营扎实|经营良好|治理规范|治理良好|治理优秀|管理规范|管理优秀)/g, '')
    .replace(/(?:非常|比较|相对|更加|較为|较为|偏|较|更|很|较高|较低|偏高|偏低|高|低|大|小|好|优秀|稳健|扎实|规范|良好|不错|靠谱|增长|同比|以上|以下|超过|达到|优质|较强|强劲)/g, '')
    .replace(/[和与及、，,\s]/g, '');
}

const supportedMetricSubject = (subject: string): boolean => {
  const residual = residualMetricText(subject);
  if (!residual) return true;
  return !/(?:比|率|收益|现金流|净息差|周转|偿债|杠杆|盈利|资产|负债|收入|利润|回款|资本|成本|每股|效率|规模|存贷)/.test(residual);
};

function detectUnsupportedMetricClauses(query: string): string[] {
  const unsupported = new Set<string>();
  const clauses = [
    /(?:按|按照)\s*([^，,。；;]+?)\s*(?:进行)?(?:筛选|筛|排序|升序|降序)/g,
    /(?:筛选|筛|找|寻找|选择|选出|选)\s*([^，,。；;]{1,40}?)(?=(?:的)?(?:银行(?:股|业)?|个股|股票)|[，,。；;]|$)/g,
  ];
  for (const selectionClauses of clauses) {
    for (const match of query.matchAll(selectionClauses)) {
      const subject = match[1]?.trim();
      if (subject && !supportedMetricSubject(subject)) unsupported.add(subject);
    }
  }
  const thresholdClauses = /([^，,。；;]{1,20}?)(?:至少|不低于|大于等于|大于|小于|超过|高于|低于|达到|≥|<=|>=|<|>)\s*\d+(?:\.\d+)?\s*(?:万亿|亿元|亿|万元|元|%?)/g;
  for (const match of query.matchAll(thresholdClauses)) {
    const subject = match[1]?.trim().replace(/^(?:找|筛选|银行股?|个股|股票|并且|且|和|的)+/, '');
    if (subject && !supportedMetricSubject(subject)) unsupported.add(subject);
  }
  return [...unsupported];
}

function extractExplicitMarketCap(query: string): { value: number; operator: Condition['operator'] } | null {
  const match = query.match(/(?:总市值|市值)\s*(至少|不低于|大于等于|大于|超过|高于|达到|≥|>=|>)\s*(\d+(?:\.\d+)?)\s*(万亿|亿元|亿|万元|元)/);
  if (!match) return null;
  const amount = Number(match[2]);
  const multiplier = match[3] === '万亿' ? 1e12 : match[3] === '万元' ? 1e4 : match[3] === '元' ? 1 : 1e8;
  const operator: Condition['operator'] = ['大于', '超过', '高于', '>'].includes(match[1] ?? '') ? 'gt' : 'gte';
  return { value: amount * multiplier, operator };
}

function extractExplicitProfitThreshold(query: string): { value: number; operator: Condition['operator'] } | null {
  const match = query.match(/(?:归母净利润(?:同比增长率|同比)?|净利润同比|业绩增长|利润增长)\s*(至少|不低于|大于等于|大于|超过|高于|≥|>=|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const operator: Condition['operator'] = ['大于', '超过', '高于', '>'].includes(match[1] ?? '') ? 'gt' : 'gte';
  return { value: Number(match[2]), operator };
}

export function parseIntentOutput(query: string, output: unknown, currentStrategy: Strategy | null): IntentResponse {
  const parsed = parseModelOutput(output);
  if (!parsed.success) throw new IntentOutputError('schema_invalid', 'DeepSeek intent did not match the required schema.');
  const delta = parsed.data;
  const conditions = defaultConditions(query, currentStrategy);
  const unsupportedRequests = [...delta.unsupported_requests];
  for (const change of delta.condition_changes) {
    if (change.field === 'industry' && change.action === 'upsert' && change.value !== '银行') {
      unsupportedRequests.push({ request: String(change.value), reason: '当前基础股票池限定为银行股，不能更改为其他行业。' });
      continue;
    }
    const index = conditions.findIndex((condition) => condition.field === change.field);
    if (change.action === 'remove') {
      if (change.field === 'industry') continue;
      if (index >= 0) conditions.splice(index, 1);
      continue;
    }
    const previous = index >= 0 ? conditions[index] : undefined;
    const condition: Condition = {
      field: change.field,
      operator: change.operator,
      value: change.value,
      unit: change.unit,
      statisticDate: previous?.statisticDate ?? (change.field === 'industry' ? null : change.field === 'market_cap_cny' ? '2026-10-09' : '2026-06-30'),
      sourceExpression: change.source_expression,
      aiInferred: change.ai_inferred,
      editable: change.editable,
    };
    if (index >= 0) conditions[index] = condition;
    else conditions.push(condition);
  }
  if (/盘子大|大盘/.test(query)) {
    const index = conditions.findIndex((condition) => condition.field === 'market_cap_cny');
    const fuzzyCap = freshCondition('market_cap_cny', 100000000000, 'gte', '盘子大（默认按总市值≥1000亿元）', true);
    if (index >= 0) conditions[index] = { ...fuzzyCap, statisticDate: conditions[index].statisticDate };
    else conditions.push(fuzzyCap);
  }
  if (/业绩增长|利润增长/.test(query)) {
    const index = conditions.findIndex((condition) => condition.field === 'net_profit_parent_yoy_pct');
    const profitGrowth = freshCondition('net_profit_parent_yoy_pct', 0, 'gt', '业绩增长（归母净利润同比>0%）', false);
    if (index >= 0) conditions[index] = { ...profitGrowth, statisticDate: conditions[index].statisticDate };
    else conditions.push(profitGrowth);
  }
  const explicitMarketCap = extractExplicitMarketCap(query);
  if (explicitMarketCap) {
    const condition = freshCondition('market_cap_cny', explicitMarketCap.value, explicitMarketCap.operator, '用户明确指定的总市值门槛', false);
    const index = conditions.findIndex((item) => item.field === 'market_cap_cny');
    if (index >= 0) conditions[index] = { ...condition, statisticDate: conditions[index].statisticDate };
    else conditions.push(condition);
  }
  const explicitProfit = extractExplicitProfitThreshold(query);
  if (explicitProfit) {
    const condition = freshCondition('net_profit_parent_yoy_pct', explicitProfit.value, explicitProfit.operator, '用户明确指定的归母净利润同比增长率门槛', false);
    const index = conditions.findIndex((item) => item.field === 'net_profit_parent_yoy_pct');
    if (index >= 0) conditions[index] = { ...condition, statisticDate: conditions[index].statisticDate };
    else conditions.push(condition);
  }
  if (!conditions.some((condition) => condition.field === 'industry' && condition.value === '银行')) {
    conditions.unshift(freshCondition('industry', '银行', 'eq', '银行股基础范围', false));
  }
  const hasProfitCondition = conditions.some((condition) => condition.field === 'net_profit_parent_yoy_pct');
  const strategy = strategySchema.parse({
    id: currentStrategy?.id ?? 'bank-screening',
    version: currentStrategy ? currentStrategy.version + 1 : 1,
    name: currentStrategy?.name ?? '银行股筛选',
    industry: 'bank',
    conditions,
    sort: { field: 'net_profit_parent_yoy_pct', direction: hasProfitCondition ? 'desc' : (delta.sort_direction ?? 'desc') },
  });
  const unsupportedMetric = detectUnsupportedFinancialMetric(query);
  if (unsupportedMetric && !unsupportedRequests.some(({ request }) => request.toLowerCase() === unsupportedMetric.toLowerCase())) {
    unsupportedRequests.push({ request: unsupportedMetric, reason: '当前仅支持所属行业、总市值和归母净利润同比增长率。' });
  }
  for (const clause of detectUnsupportedMetricClauses(query)) {
    if (!unsupportedRequests.some(({ request }) => request === clause)) {
      unsupportedRequests.push({ request: clause, reason: '该筛选或阈值指标不在当前支持范围内；当前仅支持行业、总市值和归母净利润同比增长率。' });
    }
  }
  if (/预测.{0,20}(收益|回报|涨幅|股价|价格)|未来.{0,20}(收益|回报|涨幅|股价|价格)|收益率|回报率|稳赚|目标价/.test(query) && !unsupportedRequests.some(({ request }) => /收益预测|回报预测|股价预测/.test(request))) {
    unsupportedRequests.push({ request: '收益预测', reason: '当前功能不提供收益率、股价或回报预测；选股结果仅基于历史数据条件。' });
  }
  const assumptions = [...delta.assumptions];
  if (/盘子大|大盘/.test(query) && conditions.some((condition) => condition.field === 'market_cap_cny' && condition.value === 100000000000 && condition.aiInferred)) {
    const note = '将“盘子大”按总市值≥1000亿元解释；此阈值可编辑。';
    if (!assumptions.includes(note)) assumptions.push(note);
  }
  return {
    strategy,
    assumptions,
    clarifications: delta.clarifications,
    unsupportedRequests,
    canExecute: delta.clarifications.length === 0 && unsupportedRequests.length === 0,
  };
}
