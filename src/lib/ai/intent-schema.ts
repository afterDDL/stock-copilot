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
  if (/^(?:归母净利润同比增长率|净利润同比增长率|利润同比增长率)$/.test(genericMetric)) return null;
  if (/业绩增长|利润增长|归母净利润.*同比.*增长/.test(query) && /增长率/.test(genericMetric)) return null;
  return genericMetric;
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
