import type { Strategy } from '../domain/types';

export const INTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    condition_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['industry', 'market_cap_cny', 'net_profit_parent_yoy_pct'] },
          operator: { type: 'string', enum: ['eq', 'gt', 'gte', 'lt', 'lte'] },
          value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
          unit: { type: 'string', enum: ['行业', '元', '%'] },
          action: { type: 'string', enum: ['upsert', 'remove'] },
          source_expression: { type: 'string' },
          ai_inferred: { type: 'boolean' },
          editable: { type: 'boolean' },
        },
        required: ['field', 'operator', 'value', 'unit', 'action', 'source_expression', 'ai_inferred', 'editable'],
        additionalProperties: false,
      },
    },
    sort_direction: { type: ['string', 'null'], enum: ['asc', 'desc', null] },
    assumptions: { type: 'array', items: { type: 'string' } },
    clarifications: { type: 'array', items: { type: 'string' } },
    unsupported_requests: {
      type: 'array',
      items: {
        type: 'object', properties: { request: { type: 'string' }, reason: { type: 'string' } },
        required: ['request', 'reason'], additionalProperties: false,
      },
    },
  },
  required: ['condition_changes', 'sort_direction', 'assumptions', 'clarifications', 'unsupported_requests'],
  additionalProperties: false,
} as const;

export function buildIntentPrompt(query: string, currentStrategy: Strategy | null): string {
  return [
    '将中文选股请求转换成对当前策略的结构化变更。只返回符合 JSON Schema 的 JSON。',
    '允许的字段只有 industry、market_cap_cny（人民币元）、net_profit_parent_yoy_pct（百分比）。不得发明或映射其他指标。',
    '以银行股为基础范围。industry 固定为银行，不能移除。',
    '“盘子大”默认总市值≥100000000000元（1000亿元），标记 ai_inferred=true、editable=true，并说明假设。',
    '“业绩还在增长”“正增长”或用户明确的利润增长阈值才生成归母净利润同比硬条件；“利润增长快的优先”“越快越好”只设利润同比降序偏好，不得自动增加>0%条件。',
    '“便宜”不能替换成低股价或市值；“稳”需区分价格稳定和财务稳健；“龙头”需明确口径。只有已验证指标才能执行。',
    '只输出用户明确要求的变更；局部修改时保留未提及字段（通过仅返回需要修改的 condition_changes 实现）。',
    '收益率、股价、回报或未来表现预测均不支持；放入 unsupported_requests，且不输出预测条件。信息不足以确定条件时写入 clarifications。',
    `当前策略：${currentStrategy ? JSON.stringify(currentStrategy) : '无（创建新策略）'}`,
    `用户请求：${query}`,
  ].join('\n');
}
