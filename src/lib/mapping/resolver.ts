import type { Condition, ConditionOperator, Indicator, Strategy } from '../domain/types';
import { detectConflicts } from '../engine/conflicts';
import { conceptDefinition, companySizeDefault, isMetricExecutable, metricDefinition } from './registry';
import type { ConditionMapping, MappingState, ResolvedIntent } from './types';
import { extractIndustryFromQuery } from './industry';
export type { ConditionMapping, MappingAction, MappingState, ResolvedIntent } from './types';
type ResolveOptions = { currentStrategy?: Strategy; previousStrategy?: Strategy };
type Amount = { value: number; start: number; end: number; text: string };

const chineseDigits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function chineseNumber(text: string): number {
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of text) {
    if (character in chineseDigits) digit = chineseDigits[character] ?? 0;
    else if (character === '十') { section += (digit || 1) * 10; digit = 0; }
    else if (character === '百') { section += (digit || 1) * 100; digit = 0; }
    else if (character === '千') { section += (digit || 1) * 1000; digit = 0; }
    else if (character === '万') { total += (section + digit || 1) * 10_000; section = 0; digit = 0; }
  }
  return total + section + digit;
}
function amountValues(query: string): Amount[] {
  const amounts: Amount[] = [];
  const pattern = /(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(万亿元|万亿|亿元|亿|万元|万元|万元|万|元)/g;
  for (const match of query.matchAll(pattern)) {
    const numeral = match[1] ?? '';
    const unit = match[2] ?? '';
    const base = /^\d/.test(numeral) ? Number(numeral) : chineseNumber(numeral);
    const multiplier = unit === '万亿' || unit === '万亿元' ? 1e12 : unit === '亿' || unit === '亿元' ? 1e8 : unit === '万' || unit === '万元' ? 1e4 : 1;
    const start = match.index ?? 0;
    amounts.push({ value: base * multiplier, start, end: start + match[0].length, text: match[0] });
  }
  return amounts;
}
function dateFor(field: Indicator): string | null {
  return field === 'industry' ? null : field === 'market_cap_cny' ? '2026-10-09' : '2026-06-30';
}
function unsupportedCopy(request: string): string {
  return `暂不支持“${request}”指标查询。`;
}
function condition(field: Exclude<Indicator, 'industry'>, operator: ConditionOperator, value: number, sourceExpression: string, inferred = false): Condition {
  return {
    field, operator, value,
    unit: field === 'market_cap_cny' ? '元' : '%',
    statisticDate: dateFor(field),
    sourceExpression,
    aiInferred: inferred,
    editable: true,
  };
}
function hasAny(query: string, patterns: RegExp[]): boolean { return patterns.some((pattern) => pattern.test(query)); }
function capCue(query: string): boolean {
  return hasAny(query, [/总市值|市值|盘子|大盘|小盘|规模|大市值/]) || amountValues(query).length > 0;
}
function extractCapConditions(query: string): Condition[] {
  const range = query.match(/(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:到|至|[-~—])\s*(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(万亿元|万亿|亿元|亿|万元|万|元)/);
  if (range) {
    const parse = (value: string) => /^\d/.test(value) ? Number(value) : chineseNumber(value);
    const unit = range[3] ?? '';
    const multiplier = unit === '万亿' || unit === '万亿元' ? 1e12 : unit === '亿' || unit === '亿元' ? 1e8 : unit === '万' || unit === '万元' ? 1e4 : 1;
    const first = parse(range[1] ?? '') * multiplier;
    const second = parse(range[2] ?? '') * multiplier;
    return [
      condition('market_cap_cny', 'gte', Math.min(first, second), query),
      condition('market_cap_cny', 'lte', Math.max(first, second), query),
    ];
  }
  const amounts = amountValues(query);
  if (!amounts.length) return [];
  if (amounts.length >= 2 && /到|至|之间|[-~—]/.test(query.slice(amounts[0]?.end ?? 0, amounts[1]?.start ?? query.length))) {
    const first = amounts[0];
    const second = amounts[1];
    if (first && second) {
      return [
        condition('market_cap_cny', 'gte', Math.min(first.value, second.value), query),
        condition('market_cap_cny', 'lte', Math.max(first.value, second.value), query),
      ];
    }
  }
  return amounts.map((amount) => {
    const before = query.slice(Math.max(0, amount.start - 18), amount.start);
    const after = query.slice(amount.end, amount.end + 12);
    let operator: ConditionOperator = 'gte';
    let value = amount.value;
    if (/小于|低于|少于|<|不要超过|不超过|至多|最多|小于等于|不高于|<=|≤/.test(before) || /以下|以内|不超过/.test(after)) {
      operator = /小于|低于|少于|</.test(before) ? 'lt' : 'lte';
      if (/以下.{0,4}不要|以下.{0,4}不|以内.{0,4}不要/.test(after)) operator = 'gte';
    } else if (/大于等于|至少|不低于|以上|>=|≥/.test(before) || /以上|起/.test(after)) operator = 'gte';
    else if (/大于|超过|高于|多于|>/.test(before)) operator = 'gt';
    const sourceExpression = query.trim();
    return condition('market_cap_cny', operator, value, sourceExpression);
  });
}
function extractProfitCondition(query: string): Condition | null {
  const match = query.match(/(?:归母净利润(?:同比增长率|同比)?|净利润(?:同比增长率|同比)?|利润同比(?:增长率)?|利润增长|业绩增长)\s*(至少|不低于|大于等于|大于|超过|高于|不超过|至多|小于等于|小于|低于|门槛(?:设为|改为|调整为|定为)|设为|改为|调整为|定为|为|>=|<=|≥|≤|>|<)\s*(\d+(?:\.\d+)?)\s*[%％]/);
  if (!match) return null;
  const token = match[1] ?? '';
  const operator: ConditionOperator = ['大于', '超过', '高于', '>'].includes(token) ? 'gt'
    : ['小于', '低于', '<'].includes(token) ? 'lt'
      : ['不超过', '至多', '小于等于', '<=', '≤'].includes(token) ? 'lte'
        : 'gte';
  return condition('net_profit_parent_yoy_pct', operator, Number(match[2]), query);
}
function mappingForCondition(item: Condition): ConditionMapping {
  const field = item.field;
  const concept = field === 'industry' ? 'industry_scope' : field === 'market_cap_cny' ? 'company_size' : 'profit_growth';
  const metric = metricDefinition(field);
  const conceptInfo = conceptDefinition(concept);
  return {
    originalExpression: item.sourceExpression,
    concept,
    field,
    state: item.aiInferred ? 'assumed' : 'confirmed',
    action: 'condition',
    explanation: [conceptInfo?.meaning, metric?.definition].filter(Boolean).join('；') || '由已验证指标注册表映射。',
    unit: item.unit,
    statisticDate: item.statisticDate,
    defaultSource: item.aiInferred ? '产品预设' : null,
  };
}
function versioned(strategy: Strategy, version: number): Strategy {
  return { ...strategy, version, conditions: strategy.conditions.map((item) => ({ ...item })), sort: { ...strategy.sort } };
}

export function resolveIntent(query: string, candidateStrategy: Strategy, options: ResolveOptions = {}): ResolvedIntent {
  const original = query.trim();
  const normalized = original.normalize('NFKC');
  const current = options.currentStrategy;
  const strategy = versioned(current ?? candidateStrategy, current ? Math.max(candidateStrategy.version, current.version) : candidateStrategy.version);
  const assumptions: string[] = [];
  const clarifications: string[] = [];
  const unsupportedRequests: ResolvedIntent['unsupportedRequests'] = [];
  const mappings: ConditionMapping[] = [];
  const updateCondition = (field: Indicator, replacements: Condition[]) => {
    strategy.conditions = strategy.conditions.filter((entry) => entry.field !== field);
    strategy.conditions.push(...replacements);
  };
  const removeField = (field: Indicator) => { strategy.conditions = strategy.conditions.filter((entry) => entry.field !== field); };

  if (/取消行业(?:限制|筛选)|不限制行业|不看行业|全\s*A股|全市场|沪深北\s*A股/i.test(normalized)) {
    removeField('industry');
  } else {
    const industry = extractIndustryFromQuery(normalized);
    if (industry) {
      const item: Condition = {
        field: 'industry', operator: 'eq', value: industry, unit: '行业', statisticDate: null,
        sourceExpression: original, aiInferred: false, editable: true,
      };
      updateCondition('industry', [item]);
      mappings.push({ originalExpression: original, concept: 'industry_scope', field: 'industry', state: 'confirmed', action: current ? 'patch' : 'condition', explanation: '按所属行业名称精确匹配。', unit: '行业', statisticDate: null });
    }
  }

  if (/还是上次的策略|还是刚才那个|恢复上一策略|恢复上次策略/.test(normalized)) {
    if (options.previousStrategy) {
      const restored = versioned(options.previousStrategy, Math.max(strategy.version, options.previousStrategy.version) + 1);
      mappings.push({ originalExpression: original, concept: 'strategy_version', state: 'confirmed', action: 'restore', explanation: '恢复可用的上一策略版本。' });
      return { strategy: restored, mappings, assumptions, clarifications, unsupportedRequests, canExecute: true };
    }
    const message = '当前没有可恢复的上一策略版本，请选择一个历史策略或说明要恢复的条件。';
    clarifications.push(message);
    mappings.push({ originalExpression: original, concept: 'strategy_version', state: 'needs_clarification', action: 'clarify', explanation: message });
    return { strategy, mappings, assumptions, clarifications, unsupportedRequests, canExecute: false };
  }

  if (/再严格一点|严格一点|更严格一些|再保守一点/.test(normalized)) {
    const message = '你希望收紧哪项条件？可以指定总市值、利润同比或其他可验证条件及阈值。';
    clarifications.push(message);
    mappings.push({ originalExpression: original, concept: 'strategy_patch', state: 'needs_clarification', action: 'clarify', explanation: message });
  }

  const capAmounts = extractCapConditions(normalized);
  const isSizeSort = /按规模排序|按市值排序|规模优先|市值优先|先按规模/.test(normalized);
  const sizeConditionMentioned = capAmounts.length > 0 || /总市值|市值|盘子|大盘|小盘|大市值|不要太小/.test(normalized);
  if (!current && !sizeConditionMentioned) removeField('market_cap_cny');
  const sizeDefault = /盘子大|大盘股|大市值/.test(normalized) && capAmounts.length === 0;
  const vagueSize = /不要小盘|小盘股|不要太小|规模大一点/.test(normalized) && capAmounts.length === 0 && !sizeDefault;
  if (capCue(normalized)) {
    if (capAmounts.length) {
      updateCondition('market_cap_cny', capAmounts);
      mappings.push(...capAmounts.map((item) => ({
        originalExpression: original, concept: 'company_size', field: 'market_cap_cny' as const,
        state: 'confirmed' as const, action: current ? 'patch' as const : 'condition' as const,
        explanation: '从原话中的人民币市值数值和比较方向解析；使用快照总市值。',
        unit: '元' as const, statisticDate: item.statisticDate, defaultSource: null,
      })));
    } else if (sizeDefault) {
      const preset = companySizeDefault();
      const item = condition('market_cap_cny', preset.operator, preset.value, original, true);
      updateCondition('market_cap_cny', [item]);
      const presetText = (preset.value / 100_000_000).toLocaleString('zh-CN') + '亿元';
      const note = '将“盘子大”按总市值≥' + presetText + '解释；此阈值是可编辑产品预设。';
      assumptions.push(note);
      const conceptInfo = conceptDefinition('company_size');
      mappings.push({ originalExpression: original, concept: 'company_size', field: 'market_cap_cny', state: 'assumed', action: 'condition', explanation: (conceptInfo?.meaning ?? '') + '；产品预设，不是行业标准。', unit: '元', statisticDate: item.statisticDate, defaultSource: preset.source + '：' + presetText });
    } else if (vagueSize) {
      if (!current) removeField('market_cap_cny');
      const message = '“不要小盘股”没有给出规模阈值。请指定总市值下限，或确认使用1000亿元产品预设。';
      clarifications.push(message);
      mappings.push({ originalExpression: original, concept: 'company_size', state: 'needs_clarification', action: 'clarify', explanation: message });
    }
  }
  if (isSizeSort) {
    strategy.sort = { field: 'market_cap_cny', direction: 'desc' };
    mappings.push({ originalExpression: original, concept: 'company_size', field: 'market_cap_cny', state: 'confirmed', action: 'preference', explanation: '按快照总市值由高到低排序；不改变条件匹配资格。', unit: '元', statisticDate: '2026-10-09' });
  }

  const profitCue = hasAny(normalized, [/归母净利润|净利润同比|利润同比|利润增长|业绩增长|利润条件/]);
  if (!current && !profitCue) removeField('net_profit_parent_yoy_pct');
  const profitDelete = /不看利润|删除利润|移除利润|利润条件删掉|利润条件删除|删掉利润/.test(normalized);
  const profitPreference = /(?:利润|业绩|净利润|归母净利润).{0,8}(?:快|高).{0,8}(?:优先|排前|排序|越好)|(?:利润|业绩|净利润|归母净利润).{0,8}(?:降序|从高到低)(?:排序|排列)?|增长越快越好|利润增速优先/.test(normalized);
  const explicitStillGrowing = /还在增长|仍在增长|依然增长|正增长|利润增长为正/.test(normalized);
  const plainGrowthRequest = /业绩增长/.test(normalized) && !/(?:业绩|利润|净利润).{0,8}(?:快|高|优先|排前|排序|越好)/.test(normalized);
  const profitStillGrowing = explicitStillGrowing || plainGrowthRequest;
  const explicitProfit = extractProfitCondition(normalized);
  if (profitDelete) {
    removeField('net_profit_parent_yoy_pct');
    mappings.push({ originalExpression: original, concept: 'profit_growth', field: 'net_profit_parent_yoy_pct', state: 'confirmed', action: 'patch', explanation: '按请求移除归母净利润同比硬条件；排序偏好保持不变。', unit: '%', statisticDate: '2026-06-30' });
  } else if (explicitProfit) {
    updateCondition('net_profit_parent_yoy_pct', [explicitProfit]);
    if (profitPreference) strategy.sort = { field: 'net_profit_parent_yoy_pct', direction: 'desc' };
    mappings.push({ originalExpression: original, concept: 'profit_growth', field: 'net_profit_parent_yoy_pct', state: 'confirmed', action: current ? 'patch' : 'condition', explanation: '使用原话明确指定的归母净利润同比阈值。', unit: '%', statisticDate: explicitProfit.statisticDate });
  } else if (profitPreference) {
    if (profitStillGrowing) {
      const item = condition('net_profit_parent_yoy_pct', 'gt', 0, original);
      updateCondition('net_profit_parent_yoy_pct', [item]);
    } else if (!current) {
      removeField('net_profit_parent_yoy_pct');
    }
    strategy.sort = { field: 'net_profit_parent_yoy_pct', direction: 'desc' };
    mappings.push({ originalExpression: original, concept: 'profit_growth', field: 'net_profit_parent_yoy_pct', state: 'confirmed', action: 'preference', explanation: profitStillGrowing ? '将明确的正增长要求作为硬条件，并按归母净利润同比降序排序。' : '将归母净利润同比作为降序偏好，不增加正增长筛选门槛。', unit: '%', statisticDate: '2026-06-30' });
  } else if (profitStillGrowing) {
    const item = condition('net_profit_parent_yoy_pct', 'gt', 0, original);
    updateCondition('net_profit_parent_yoy_pct', [item]);
    mappings.push({ originalExpression: original, concept: 'profit_growth', field: 'net_profit_parent_yoy_pct', state: 'confirmed', action: current ? 'patch' : 'condition', explanation: '“仍在增长”映射为归母净利润同比大于0%。', unit: '%', statisticDate: item.statisticDate, defaultSource: null });
  }

  const unsupportedPatterns: Array<{ pattern: RegExp; concept: string; request: string; reason: string; state?: MappingState }> = [
    { pattern: /便宜|低估值|估值低/, concept: 'valuation', request: '便宜/低估值', reason: '估值可能指PB、PE或历史分位；这些指标当前未验证，不能以利润或市值替代。', state: 'unsupported' },
    { pattern: /股价低|股价便宜/, concept: 'valuation', request: '股价低一些', reason: '股价绝对金额不等同估值，当前没有已验证的股价筛选指标。', state: 'unsupported' },
    { pattern: /别是垃圾股|财务稳健|财务稳一点/, concept: 'financial_stability', request: '财务稳健/风险筛选', reason: '需要明确银行风险指标和阈值；当前注册表没有已验证执行字段。', state: 'unsupported' },
    { pattern: /经营持续改善|持续改善/, concept: 'business_improvement', request: '经营持续改善', reason: '持续改善需要多期指标；单期利润同比不能替代，相关指标尚未验证。', state: 'unsupported' },
    { pattern: /下周.{0,8}翻倍|肯定翻倍|稳赚|目标价|收益预测|回报预测/, concept: 'market_momentum', request: '确定性未来收益预测', reason: '不提供未来收益或股价预测；可改为指定期间的可验证历史指标。', state: 'unsupported' },
  ];
  for (const entry of unsupportedPatterns) {
    if (!entry.pattern.test(normalized)) continue;
    const existing = unsupportedRequests.some((item) => item.request === entry.request);
    const reason = unsupportedCopy(entry.request);
    if (!existing) unsupportedRequests.push({ request: entry.request, reason });
    mappings.push({ originalExpression: original, concept: entry.concept, state: entry.state ?? 'unsupported', action: 'unsupported', explanation: reason });
  }
  if (/业绩好一点|盈利能力好|赚钱能力强/.test(normalized)) {
    const message = '“业绩好”可能指盈利能力、盈利增长或盈利质量。请明确想比较的含义；当前只有归母净利润同比已验证。';
    clarifications.push(message);
    mappings.push({ originalExpression: original, concept: 'profitability', state: 'needs_clarification', action: 'clarify', explanation: message });
  }
  if (/稳一点|走势稳定|股价稳定/.test(normalized)) {
    const message = '“稳”可能指股价波动较小或财务经营稳健。你想表达哪一种？相关指标尚未验证。';
    clarifications.push(message);
    mappings.push({ originalExpression: original, concept: 'price_stability', state: 'needs_clarification', action: 'clarify', explanation: message });
    mappings.push({ originalExpression: original, concept: 'financial_stability', state: 'needs_clarification', action: 'clarify', explanation: message });
  }
  if (/银行龙头|行业龙头|龙头股/.test(normalized)) {
    const message = '“龙头”可按市值、资产规模或市场份额等不同口径定义。请指定口径；不会默认等同于市值最大。';
    clarifications.push(message);
    mappings.push({ originalExpression: original, concept: 'leadership', state: 'needs_clarification', action: 'clarify', explanation: message });
  }
  if (/走势稳定又要涨得快|稳.{0,8}涨得快|稳定.{0,8}涨得快/.test(normalized)) {
    const message = '请指定稳定性的观察区间和“涨得快”的比较期间；两项偏好当前都没有已验证指标。';
    clarifications.push(message);
    mappings.push({ originalExpression: original, concept: 'price_stability', state: 'needs_clarification', action: 'clarify', explanation: message });
    mappings.push({ originalExpression: original, concept: 'market_momentum', state: 'needs_clarification', action: 'clarify', explanation: message });
  }

  const existingMappedFields = new Set(mappings.map((item) => item.field).filter((field): field is Indicator => field !== undefined));
  for (const item of strategy.conditions) {
    if (!isMetricExecutable(item.field)) continue;
    if (!existingMappedFields.has(item.field)) mappings.push(mappingForCondition(item));
  }
  const conflicts = detectConflicts(strategy);
  const hasConflict = conflicts.length > 0;
  const canExecute = clarifications.length === 0 && unsupportedRequests.length === 0 && !hasConflict;
  return { strategy, mappings, assumptions, clarifications, unsupportedRequests, canExecute };
}
