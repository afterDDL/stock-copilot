import { readFileSync } from 'node:fs';
import type { Condition, Indicator, Strategy } from '../domain/types';
import { detectConflicts } from '../engine/conflicts';
import { resolveIntent, type MappingState } from './resolver';

export type IntentEvalCase = {
  id: string;
  input: string;
  context: { industry: 'bank'; strategy: 'empty' | 'industry_only' | 'existing_cap_1000' | 'existing_profit' | 'previous_available' };
  expected: {
    concepts: string[];
    conditionPreference: string;
    direction?: string;
    mapping: MappingState;
    action: 'execute' | 'clarify' | 'unsupported' | 'conflict' | 'patch' | 'restore';
    conflictPatch: boolean;
  };
  notes: string;
};
export type IntentEvalResult = {
  id: string;
  input: string;
  checks: { concept: boolean; conditionPreference: boolean; direction: boolean; mapping: boolean; action: boolean; conflictPatch: boolean };
  expectedAction: string;
  actualAction: string;
  passed: boolean;
};

const source = readFileSync(new URL('../../data/mapping/intent_eval.jsonl', import.meta.url), 'utf8');
export const intentEvalCorpus: IntentEvalCase[] = source.trim().split(/\r?\n/).map((line) => JSON.parse(line) as IntentEvalCase);

function industryCondition(): Condition {
  return { field: 'industry', operator: 'eq', value: '银行', unit: '行业', statisticDate: null, sourceExpression: '银行股基础范围', aiInferred: false, editable: false };
}
function startingStrategy(caseItem: IntentEvalCase): Strategy {
  const conditions: Condition[] = [industryCondition()];
  if (caseItem.context.strategy === 'existing_cap_1000') {
    conditions.push({ field: 'market_cap_cny', operator: 'gte', value: 100_000_000_000, unit: '元', statisticDate: '2026-10-09', sourceExpression: '盘子大', aiInferred: true, editable: true });
  }
  if (caseItem.context.strategy === 'existing_profit') {
    conditions.push({ field: 'net_profit_parent_yoy_pct', operator: 'gt', value: 0, unit: '%', statisticDate: '2026-06-30', sourceExpression: '业绩增长', aiInferred: false, editable: true });
  }
  return { id: 'intent-eval', version: 1, name: '评测银行策略', market: 'cn_a', conditions, sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' } };
}
function actionOf(result: ReturnType<typeof resolveIntent>): IntentEvalCase['expected']['action'] {
  if (result.mappings.some((item) => item.action === 'restore')) return 'restore';
  if (detectConflicts(result.strategy).length) return 'conflict';
  if (result.unsupportedRequests.length) return 'unsupported';
  if (result.clarifications.length) return 'clarify';
  if (result.mappings.some((item) => item.action === 'patch')) return 'patch';
  return 'execute';
}
function directionMatches(caseItem: IntentEvalCase, strategy: Strategy): boolean {
  const expected = caseItem.expected.direction;
  if (!expected) return true;
  const field: Indicator = /company_size|market_cap_cny/.test(caseItem.expected.conditionPreference) ? 'market_cap_cny' : 'net_profit_parent_yoy_pct';
  if (expected === 'desc') return strategy.sort.direction === 'desc' && strategy.sort.field === field;
  return strategy.conditions.some((condition) => condition.field === field && condition.operator === expected);
}
function conditionPreferenceMatches(caseItem: IntentEvalCase, result: ReturnType<typeof resolveIntent>): boolean {
  const conditions = result.strategy.conditions;
  const capConditions = conditions.filter((condition) => condition.field === 'market_cap_cny');
  const profitConditions = conditions.filter((condition) => condition.field === 'net_profit_parent_yoy_pct');
  const expected = caseItem.expected.conditionPreference;
  if (expected === 'hard company_size market_cap_cny between 100000000000 and 200000000000 CNY') {
    return capConditions.some((condition) => condition.operator === 'gte' && condition.value === 100_000_000_000)
      && capConditions.some((condition) => condition.operator === 'lte' && condition.value === 200_000_000_000);
  }
  if (expected === 'soft preference profit_growth desc') {
    return profitConditions.length === 0 && result.strategy.sort.field === 'net_profit_parent_yoy_pct' && result.strategy.sort.direction === 'desc';
  }
  if (expected === 'soft preference company_size desc') {
    return capConditions.length === 0 && result.strategy.sort.field === 'market_cap_cny' && result.strategy.sort.direction === 'desc';
  }
  if (expected === 'remove profit condition') return profitConditions.length === 0;
  if (expected === 'restore previous strategy') return result.mappings.some((mapping) => mapping.action === 'restore');
  if (expected === 'conflicting market cap range') {
    return detectConflicts(result.strategy).some((conflict) => conflict.kind === 'empty_range' && conflict.field === 'market_cap_cny');
  }
  if (expected.includes('clarif')) return result.clarifications.length > 0;
  if (expected.includes('unavailable') || expected.includes('unsupported')) return result.unsupportedRequests.length > 0;

  const capMatch = expected.match(/market_cap_cny\s*(>=|<=|>|<)\s*(\d+)/);
  if (capMatch) {
    const operators = { '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' } as const;
    const operator = operators[capMatch[1] as keyof typeof operators];
    const value = Number(capMatch[2]);
    return capConditions.some((condition) => condition.operator === operator && condition.value === value
      && (!expected.startsWith('assumed ') || condition.aiInferred));
  }
  const profitMatch = expected.match(/net_profit_parent_yoy_pct\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)/);
  if (profitMatch) {
    const operators = { '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' } as const;
    return profitConditions.some((condition) => condition.operator === operators[profitMatch[1] as keyof typeof operators] && condition.value === Number(profitMatch[2]));
  }
  return false;
}
function conflictPatchMatches(caseItem: IntentEvalCase, result: ReturnType<typeof resolveIntent>): boolean {
  const actual = result.mappings.some((mapping) => mapping.action === 'patch' || mapping.action === 'restore');
  return actual === caseItem.expected.conflictPatch;
}

export function evaluateIntentCorpus(cases: IntentEvalCase[] = intentEvalCorpus) {
  const results: IntentEvalResult[] = cases.map((caseItem) => {
    const baseline = startingStrategy(caseItem);
    const previous = caseItem.context.strategy === 'previous_available'
      ? { ...baseline, version: 0, conditions: [industryCondition()] }
      : undefined;
    const hasCurrent = caseItem.context.strategy === 'existing_cap_1000' || caseItem.context.strategy === 'existing_profit';
    const resolved = resolveIntent(caseItem.input, baseline, {
      ...(hasCurrent ? { currentStrategy: baseline } : {}),
      ...(previous ? { previousStrategy: previous } : {}),
    });
    const concepts = new Set(resolved.mappings.map((mapping) => mapping.concept));
    const actualAction = actionOf(resolved);
    const checks = {
      concept: caseItem.expected.concepts.every((concept) => concepts.has(concept)),
      conditionPreference: conditionPreferenceMatches(caseItem, resolved),
      direction: directionMatches(caseItem, resolved.strategy),
      mapping: caseItem.expected.concepts.length === 0
        ? resolved.mappings.some((mapping) => mapping.state === caseItem.expected.mapping)
        : caseItem.expected.concepts.every((concept) => resolved.mappings.some((mapping) => mapping.concept === concept && mapping.state === caseItem.expected.mapping)),
      action: actualAction === caseItem.expected.action,
      conflictPatch: conflictPatchMatches(caseItem, resolved),
    };
    return {
      id: caseItem.id,
      input: caseItem.input,
      checks,
      expectedAction: caseItem.expected.action,
      actualAction,
      passed: Object.values(checks).every(Boolean),
    };
  });
  return {
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    accuracy: Object.fromEntries((['concept', 'conditionPreference', 'direction', 'mapping', 'action', 'conflictPatch'] as const).map((key) => [
      key, results.length ? results.filter((item) => item.checks[key]).length / results.length : 1,
    ])),
    cases: results,
  };
}
