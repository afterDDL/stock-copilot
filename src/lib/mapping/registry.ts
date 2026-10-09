import registry from '../../data/mapping/metric_registry.json';
import concepts from '../../data/mapping/concepts.json';
import profiles from '../../data/mapping/industry_profiles.json';
import type { ConditionOperator, Indicator } from '../domain/types';

export type MetricDefinition = (typeof registry.metrics)[number];
export type ConceptDefinition = (typeof concepts.concepts)[number];
export type IndustryProfile = (typeof profiles.profiles)[number];

export function conceptDefinition(id: string): ConceptDefinition | undefined {
  return concepts.concepts.find((concept) => concept.id === id);
}

export function industryProfile(industry: string): IndustryProfile | undefined {
  return profiles.profiles.find((profile) => profile.industry === industry);
}

export function companySizeDefault(): { operator: ConditionOperator; value: number; unit: string; source: string; editable: boolean } {
  const profile = industryProfile('bank');
  const metrics: unknown = profile?.metrics;
  const defaultValue = typeof metrics === 'object' && metrics !== null && 'company_size' in metrics
    ? (metrics.company_size as { default?: { operator: ConditionOperator; value: number; unit: string; source: string; editable: boolean } }).default
    : undefined;
  return defaultValue ?? { operator: 'gte', value: 100_000_000_000, unit: '元', source: '产品预设', editable: true };
}

export function executableMetrics(): MetricDefinition[] {
  return registry.metrics.filter((metric) => metric.verified && metric.executable);
}

export function metricDefinition(field: Indicator): MetricDefinition | undefined {
  return registry.metrics.find((metric) => metric.id === field);
}

export function isMetricExecutable(field: string): field is Indicator {
  const metric = registry.metrics.find((entry) => entry.id === field);
  return Boolean(metric?.verified && metric.executable);
}
