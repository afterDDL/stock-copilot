import type { ScreeningDiff, ScreeningResult } from '../domain/types';

export function diffResults(previous: ScreeningResult, next: ScreeningResult): ScreeningDiff {
  const previousCodes = new Set(previous.included.map((item) => item.stock.code));
  const nextCodes = new Set(next.included.map((item) => item.stock.code));
  return {
    added: [...nextCodes].filter((code) => !previousCodes.has(code)).sort(),
    retained: [...nextCodes].filter((code) => previousCodes.has(code)).sort(),
    removed: [...previousCodes].filter((code) => !nextCodes.has(code)).sort(),
  };
}
