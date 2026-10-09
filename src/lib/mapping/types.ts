import type { Indicator, MetricUnit, Strategy } from '../domain/types';

export type MappingState = 'confirmed' | 'assumed' | 'needs_clarification' | 'unsupported';
export type MappingAction = 'condition' | 'preference' | 'patch' | 'restore' | 'clarify' | 'unsupported';

export type ConditionMapping = {
  originalExpression: string;
  concept: string;
  field?: Indicator;
  state: MappingState;
  action: MappingAction;
  explanation: string;
  unit?: MetricUnit;
  statisticDate?: string | null;
  defaultSource?: string | null;
};

export type ResolvedIntent = {
  strategy: Strategy;
  mappings: ConditionMapping[];
  assumptions: string[];
  clarifications: string[];
  unsupportedRequests: Array<{ request: string; reason: string }>;
  canExecute: boolean;
};
