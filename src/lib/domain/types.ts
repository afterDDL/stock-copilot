export const SUPPORTED_FIELDS = [
  'industry',
  'market_cap_cny',
  'net_profit_parent_yoy_pct',
] as const;

export type Indicator = (typeof SUPPORTED_FIELDS)[number];
export type ConditionOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
export type MetricUnit = '行业' | '元' | '%';
export type MetricSource = 'live' | 'historical';

export const INDICATOR_META: Record<Indicator, { label: string; unit: MetricUnit }> = {
  industry: { label: '所属行业', unit: '行业' },
  market_cap_cny: { label: '总市值', unit: '元' },
  net_profit_parent_yoy_pct: { label: '归母净利润同比增长率', unit: '%' },
};

export interface Condition {
  field: Indicator;
  operator: ConditionOperator;
  value: number | string;
  unit: MetricUnit;
  statisticDate: string | null;
  sourceExpression: string;
  aiInferred: boolean;
  editable: boolean;
}

export interface Strategy {
  id: string;
  version: number;
  name: string;
  industry: 'bank';
  conditions: Condition[];
  sort: {
    field: 'market_cap_cny' | 'net_profit_parent_yoy_pct';
    direction: 'asc' | 'desc';
  };
}

export interface MetricValue {
  value: number | string | null;
  unit: MetricUnit;
  date: string | null;
  source: MetricSource;
  coverage: 'available' | 'missing';
}

export interface StockRecord {
  code: string;
  name: string;
  industry: string;
  metrics: Record<Indicator, MetricValue>;
}

export interface MetricCoverage {
  available: number;
  missing: number;
}

export interface DataSnapshot {
  snapshotId: string;
  source: MetricSource;
  asOf: string;
  stocks: StockRecord[];
  coverage: {
    expectedStocks: number;
    returnedStocks: number;
    complete: boolean;
    metrics: Record<Indicator, MetricCoverage>;
  };
}

export interface ConditionEvidence {
  condition: Condition;
  status: 'passed' | 'failed' | 'unknown';
  actual: number | string | null;
  unit: MetricUnit;
  statisticDate: string | null;
  source: MetricSource;
  explanation: string;
}

export interface StockScreeningEvidence {
  stock: StockRecord;
  evidence: ConditionEvidence[];
}

export interface ScreeningResult {
  snapshotId: string;
  strategyVersion: number;
  included: StockScreeningEvidence[];
  excluded: StockScreeningEvidence[];
  unknown: StockScreeningEvidence[];
}

export type StrategyConflict =
  | { field: Indicator; kind: 'empty_range'; minimum: number; maximum: number }
  | {
      field: Indicator;
      kind: 'equality_outside_range';
      value: number;
      minimum: number | null;
      maximum: number | null;
    }
  | { field: Indicator; kind: 'multiple_equalities'; values: Array<number | string> };

export interface ScreeningDiff {
  added: string[];
  retained: string[];
  removed: string[];
}
