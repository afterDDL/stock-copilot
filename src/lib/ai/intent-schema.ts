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

const profitGrowthAliases = [
  '归母净利润同比增长率', '净利润同比增长率', '利润同比增长率', '归母净利润同比', '净利润同比',
  '归母净利润增速', '净利润增速', '利润增速', '业绩增速', '归母净利润', '业绩增长', '利润增长',
].sort((left, right) => right.length - left.length);

// Cover only recognized P0 concepts. Modifiers, comparators and numbers belong
// to a field span; removing them globally could hide an unsupported criterion.
const numericComparator = '(?:大于等于|小于等于|不低于|不高于|不超过|至少|至多|大于|小于|超过|高于|低于|达到|等于|>=|<=|≥|≤|>|<|=)';
const numericAmount = '[+-]?\\d+(?:\\.\\d+)?';
const threshold = (unit: string) => `(?:${numericComparator}|提高到|降低到|调整到|改为|设为)?\\s*${numericAmount}\\s*(?:${unit})(?:以上|以下)?`;
const marketCapLanguage = new RegExp(`(?:总市值|大市值|市值|盘子大|盘子|大盘)(?:门槛|阈值|条件)?(?:\\s*(?:${threshold('万亿元|万亿|亿元|亿|万元|元')}|(?:比较|相对|较为|非常|偏|较|更|很)?(?:大|小)))?`, 'g');
const profitGrowthLanguage = new RegExp(`(?:${profitGrowthAliases.join('|')})(?:门槛|阈值|条件)?(?:\\s*(?:${threshold('%|％|百分比')}|越高越好|从高到低(?:排序|排列)?|降序(?:排序|排列)?|排序|排列|优先|(?:比较|相对|较为|非常|偏|较|更|很)?(?:高|低)|为正|正增长))?`, 'g');
const bankLanguage = /(?:银行行业|银行业|银行股|银行|所属行业|行业)/g;
const requestScaffolding = /(?:请帮我|帮我|请|我想要|我想|我要|寻找|找|按照|根据|按|进行|筛选|选出|选择|选股|选|些|还在|仍在|依然|把|将|门槛|阈值|条件|指标|取消|删除|移除|保留|股票|个股|并且|而且|以及|并|且|和|与|及|的|中|里)/g;

function detectUncoveredCriteria(query: string): string[] {
  // Spaces preserve boundaries, so separated fragments cannot accidentally
  // combine into a recognized alias after another field has been consumed.
  const residual = query.normalize('NFKC')
    .replace(marketCapLanguage, ' ')
    .replace(profitGrowthLanguage, ' ')
    .replace(/(?:归母净利润|净利润|业绩|利润)还在增长|(?:归母净利润|净利润|利润)仍在增长|利润增长越快越好/g, ' ')
    .replace(/越快越好/g, ' ')
    .replace(bankLanguage, ' ')
    .replace(requestScaffolding, ' ');
  return [...new Set(residual.split(/[\s\p{P}]+/u).filter(Boolean))];
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
  for (const criterion of detectUncoveredCriteria(query)) {
    if (!unsupportedRequests.some(({ request }) => request === criterion)) {
      unsupportedRequests.push({ request: criterion, reason: '该要求未被当前支持的语言覆盖；仅支持银行行业、总市值和归母净利润同比增长率。' });
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
