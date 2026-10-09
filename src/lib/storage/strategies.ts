import { z } from 'zod';
import { strategySchema } from '../domain/schema';
import type { Strategy } from '../domain/types';

const STORAGE_KEY = 'stock-copilot:saved-strategies:v1';
const entrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  strategy: strategySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
const envelopeSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(entrySchema) }).strict();

export type SavedStrategySummary = z.infer<typeof entrySchema>;
export type StrategyStorage = ReturnType<typeof createStrategyStorage>;

function defaultStorage(): Storage {
  if (typeof window === 'undefined' || !window.localStorage) throw new Error('本地保存暂不可用。');
  return window.localStorage;
}

function read(storage: Pick<Storage, 'getItem'>): { entries: SavedStrategySummary[]; warning: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [], warning: null };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { entries: [], warning: '已保存的策略格式无效，已忽略这些数据。' }; }
    const envelope = envelopeSchema.safeParse(parsed);
    if (envelope.success) return { entries: envelope.data.entries, warning: null };
    if (parsed && typeof parsed === 'object' && 'entries' in parsed && Array.isArray(parsed.entries)) {
      if (!('schemaVersion' in parsed) || parsed.schemaVersion !== 1) return { entries: [], warning: '已保存策略来自不支持的格式版本，已忽略这些数据。' };
      const results = parsed.entries.map((entry) => entrySchema.safeParse(entry));
      const entries = results.filter((entry) => entry.success).map((entry) => entry.data);
      return { entries, warning: entries.length === results.length ? null : '部分已保存策略无效，已忽略无效项目。' };
    }
    return { entries: [], warning: '已保存的策略格式无效，已忽略这些数据。' };
  } catch {
    return { entries: [], warning: '本地保存暂不可用，已保存的策略无法读取。' };
  }
}

export function createStrategyStorage(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const resolve = () => storage ?? defaultStorage();
  let lastWarning: string | null = null;
  const readEntries = (): SavedStrategySummary[] => {
    const result = read(resolve());
    lastWarning = result.warning;
    return result.entries;
  };
  return {
    list(): SavedStrategySummary[] {
      try { return readEntries(); }
      catch { lastWarning = '本地保存暂不可用，已保存的策略无法读取。'; return []; }
    },
    warning(): string | null {
      if (!storage && typeof window === 'undefined') return null;
      try { readEntries(); }
      catch { lastWarning = '本地保存暂不可用，已保存的策略无法读取。'; }
      return lastWarning;
    },
    save(strategy: Strategy, name = strategy.name, id?: string): SavedStrategySummary {
      if (!name.trim()) throw new Error('策略名称不能为空。');
      const parsedStrategy = strategySchema.parse({ ...strategy, name: name.trim() });
      const target = resolve();
      const entries = read(target).entries;
      const now = new Date().toISOString();
      const existing = id ? entries.find((entry) => entry.id === id) : undefined;
      const entry: SavedStrategySummary = {
        id: existing?.id ?? globalThis.crypto?.randomUUID?.() ?? `strategy-${Date.now()}`,
        name: name.trim(), strategy: parsedStrategy,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      const next = existing ? entries.map((item) => item.id === existing.id ? entry : item) : [entry, ...entries];
      target.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, entries: next }));
      return entry;
    },
    load(id: string): Strategy | null {
      return readEntries().find((entry) => entry.id === id)?.strategy ?? null;
    },
    delete(id: string): boolean {
      const target = resolve();
      const entries = read(target).entries;
      if (!entries.some((entry) => entry.id === id)) return false;
      target.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, entries: entries.filter((entry) => entry.id !== id) }));
      return true;
    },
  };
}
