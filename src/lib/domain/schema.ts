import { z } from 'zod';
import { INDICATOR_META, SUPPORTED_FIELDS } from './types';

export const conditionSchema = z.object({
  field: z.enum(SUPPORTED_FIELDS),
  operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']),
  value: z.union([z.number().finite(), z.string().min(1)]),
  unit: z.enum(['行业', '元', '%']),
  statisticDate: z.string().date().nullable(),
  sourceExpression: z.string().min(1),
  aiInferred: z.boolean(),
  editable: z.boolean(),
}).strict().superRefine((condition, context) => {
  const numericField = condition.field !== 'industry';
  if (numericField && typeof condition.value !== 'number') {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Numeric fields require a numeric value.' });
  }
  if (!numericField && typeof condition.value !== 'string') {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Industry requires a string value.' });
  }
  if (condition.unit !== INDICATOR_META[condition.field].unit) {
    context.addIssue({ code: 'custom', path: ['unit'], message: 'Unit does not match the selected field.' });
  }
  if (condition.field === 'industry' && condition.operator !== 'eq') {
    context.addIssue({ code: 'custom', path: ['operator'], message: 'Industry only supports equality.' });
  }
  if (condition.field === 'industry' && condition.statisticDate !== null) {
    context.addIssue({ code: 'custom', path: ['statisticDate'], message: 'Industry is not date-bound.' });
  }
  if (condition.field !== 'industry' && condition.statisticDate === null) {
    context.addIssue({ code: 'custom', path: ['statisticDate'], message: 'Financial metrics require a statistic date.' });
  }
});

export const strategySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  market: z.literal('cn_a'),
  conditions: z.array(conditionSchema).min(1),
  sort: z.object({
    field: z.enum(['market_cap_cny', 'net_profit_parent_yoy_pct']),
    direction: z.enum(['asc', 'desc']),
  }).strict(),
}).strict();

const metricValueSchema = z.object({
  value: z.union([z.number().finite(), z.string().min(1)]).nullable(),
  unit: z.enum(['行业', '元', '%']),
  date: z.string().date().nullable(),
  source: z.enum(['live', 'historical']),
  coverage: z.enum(['available', 'missing']),
}).strict().superRefine((metric, context) => {
  if ((metric.value === null) !== (metric.coverage === 'missing')) {
    context.addIssue({ code: 'custom', path: ['coverage'], message: 'Coverage must match value availability.' });
  }
});

export const stockRecordSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().min(1),
  industry: z.string().min(1),
  metrics: z.object({
    industry: metricValueSchema,
    market_cap_cny: metricValueSchema,
    net_profit_parent_yoy_pct: metricValueSchema,
  }).strict().superRefine((metrics, context) => {
    for (const field of SUPPORTED_FIELDS) {
      if (metrics[field].unit !== INDICATOR_META[field].unit) {
        context.addIssue({ code: 'custom', path: [field, 'unit'], message: 'Unit does not match the selected field.' });
      }
      if (metrics[field].value !== null && field === 'industry' && typeof metrics[field].value !== 'string') {
        context.addIssue({ code: 'custom', path: [field, 'value'], message: 'Industry metrics require a string value.' });
      }
      if (metrics[field].value !== null && field !== 'industry' && typeof metrics[field].value !== 'number') {
        context.addIssue({ code: 'custom', path: [field, 'value'], message: 'Financial metrics require a numeric value.' });
      }
      if (field !== 'industry' && metrics[field].value !== null && metrics[field].date === null) {
        context.addIssue({ code: 'custom', path: [field, 'date'], message: 'Available financial metrics require a statistic date.' });
      }
    }
  }),
}).strict().superRefine((stock, context) => {
  if (stock.metrics.industry.value !== null && stock.industry !== stock.metrics.industry.value) {
    context.addIssue({
      code: 'custom',
      path: ['metrics', 'industry', 'value'],
      message: 'Stock industry must match the industry metric value.',
    });
  }
});

const metricCoverageSchema = z.object({ available: z.number().int().nonnegative(), missing: z.number().int().nonnegative() }).strict();

export const dataSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  source: z.enum(['live', 'historical']),
  asOf: z.string().date(),
  stocks: z.array(stockRecordSchema),
  coverage: z.object({
    expectedStocks: z.number().int().nonnegative(),
    returnedStocks: z.number().int().nonnegative(),
    complete: z.boolean(),
    metrics: z.object({
      industry: metricCoverageSchema,
      market_cap_cny: metricCoverageSchema,
      net_profit_parent_yoy_pct: metricCoverageSchema,
    }).strict(),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.coverage.returnedStocks !== snapshot.stocks.length) {
    context.addIssue({ code: 'custom', path: ['coverage', 'returnedStocks'], message: 'Returned stock count must match the stock records.' });
  }
  if (snapshot.coverage.expectedStocks < snapshot.coverage.returnedStocks) {
    context.addIssue({ code: 'custom', path: ['coverage', 'expectedStocks'], message: 'Expected stock count cannot be smaller than returned stock count.' });
  }
  if (snapshot.coverage.complete !== (snapshot.coverage.expectedStocks === snapshot.coverage.returnedStocks)) {
    context.addIssue({ code: 'custom', path: ['coverage', 'complete'], message: 'Completeness must match expected and returned stock counts.' });
  }
  for (const field of SUPPORTED_FIELDS) {
    const available = snapshot.stocks.filter((stock) => stock.metrics[field].coverage === 'available').length;
    const metricCoverage = snapshot.coverage.metrics[field];
    if (metricCoverage.available !== available || metricCoverage.missing !== snapshot.stocks.length - available) {
      context.addIssue({ code: 'custom', path: ['coverage', 'metrics', field], message: 'Metric coverage must match the stock records.' });
    }
  }
});
