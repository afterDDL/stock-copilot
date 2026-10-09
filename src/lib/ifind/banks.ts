import type { DataSnapshot } from '../domain/types';
import { dataSnapshotSchema } from '../domain/schema';
import { IfindError, SnapshotError } from './errors';
import { IfindMcpClient } from './client';
import { parseMarkdownTable } from './markdown';

export interface BankSnapshotEvidence {
  source: string;
  capturedAt: string;
  statisticDates: { marketCap: string; netProfitYoy: string };
  liveRequests: number;
}

export interface BankSnapshotAcquisition {
  snapshot: DataSnapshot;
  evidence: BankSnapshotEvidence;
}

const CODE_HEADER = '股票代码';
const NAME_HEADER = '股票简称';
const INDUSTRY_HEADERS = ['所属同花顺行业', '所属行业'];
const CAP_HEADER = '总市值';
const PROFIT_HEADER = '归属于母公司所有者的净利润同比增长率';

function uniqueColumn(row: Record<string, string>, prefix: string, role: string): string {
  const matches = Object.keys(row).filter((key) => key === prefix || key.startsWith(`${prefix}[`));
  if (matches.length !== 1) throw new SnapshotError(`Expected exactly one ${role} column.`, 'wrong_columns');
  return matches[0];
}

function dateFor(header: string, role: string): string {
  const match = header.match(/\[(\d{8})\]$/);
  if (!match) throw new SnapshotError(`Missing statistic date for ${role}.`, 'missing_date');
  const date = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new SnapshotError(`Invalid statistic date for ${role}.`, 'invalid_date');
  }
  const expectedDate = role === 'market capitalization' ? '2026-10-09' : '2026-06-30';
  if (date !== expectedDate) {
    throw new SnapshotError(`Expected statistic date ${expectedDate} for ${role}.`, 'wrong_statistic_date');
  }
  return date;
}

function codeOf(row: Record<string, string>): string {
  const value = row[CODE_HEADER]?.trim() ?? '';
  const match = value.match(/^(\d{6})(?:\.(?:SZ|SH|BJ))?$/i);
  if (!match) throw new SnapshotError('iFinD returned an invalid stock code.', 'invalid_stock_code');
  return match[1];
}

function numericValue(raw: string, label: string): number {
  const value = Number(raw.replace(/,/g, '').replace(/%$/, '').trim());
  if (!Number.isFinite(value)) throw new SnapshotError(`iFinD returned a nonnumeric ${label}.`, 'invalid_metric');
  return value;
}

function uniqueRows(rows: Array<Record<string, string>>, label: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const code = codeOf(row);
    if (result.has(code)) throw new SnapshotError(`Duplicate stock row in ${label} result.`, 'duplicate_rows');
    result.set(code, row);
  }
  return result;
}

export function mergeBankTables(
  capRows: Array<Record<string, string>>,
  profitRows: Array<Record<string, string>>,
  options: { capturedAt: string; expectedStocks?: number },
): DataSnapshot {
  const capByCode = uniqueRows(capRows, 'market capitalization');
  const profitByCode = uniqueRows(profitRows, 'net profit growth');
  const expected = options.expectedStocks ?? 42;
  if (capByCode.size !== expected || profitByCode.size !== expected) {
    throw new SnapshotError(`Bank query coverage mismatch: expected ${expected} rows in each query.`, 'coverage_mismatch');
  }
  if ([...capByCode.keys()].some((code) => !profitByCode.has(code)) || [...profitByCode.keys()].some((code) => !capByCode.has(code))) {
    throw new SnapshotError('Bank query coverage mismatch: stock rows do not align.', 'coverage_mismatch');
  }

  const stocks = [...capByCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, capRow]) => {
    const profitRow = profitByCode.get(code)!;
    const industryColumn = INDUSTRY_HEADERS.find((header) => capRow[header] !== undefined && profitRow[header] !== undefined);
    const capColumn = uniqueColumn(capRow, CAP_HEADER, 'market capitalization');
    const profitColumn = uniqueColumn(profitRow, PROFIT_HEADER, 'net profit growth');
    const name = capRow[NAME_HEADER]?.trim();
    const industry = industryColumn ? capRow[industryColumn]?.trim() : undefined;
    if (!name || !industry || profitRow[NAME_HEADER]?.trim() !== name || profitRow[industryColumn!]?.trim() !== industry) {
      throw new SnapshotError('Bank query identity columns do not match.', 'identity_mismatch');
    }
    if (!industry.includes('银行')) throw new SnapshotError('iFinD returned a non-bank in the bank selection.', 'wrong_universe');
    return {
      code,
      name,
      industry,
      metrics: {
        industry: { value: industry, unit: '行业' as const, date: null, source: 'live' as const, coverage: 'available' as const },
        market_cap_cny: { value: numericValue(capRow[capColumn], 'market capitalization'), unit: '元' as const, date: dateFor(capColumn, 'market capitalization'), source: 'live' as const, coverage: 'available' as const },
        net_profit_parent_yoy_pct: { value: numericValue(profitRow[profitColumn], 'net profit growth'), unit: '%' as const, date: dateFor(profitColumn, 'net profit growth'), source: 'live' as const, coverage: 'available' as const },
      },
    };
  });
  const snapshot: DataSnapshot = {
    snapshotId: `ifind-banks-${options.capturedAt.slice(0, 10)}`,
    source: 'live',
    asOf: options.capturedAt.slice(0, 10),
    stocks,
    coverage: {
      expectedStocks: expected,
      returnedStocks: stocks.length,
      complete: stocks.length === expected,
      metrics: {
        industry: { available: stocks.length, missing: 0 },
        market_cap_cny: { available: stocks.length, missing: 0 },
        net_profit_parent_yoy_pct: { available: stocks.length, missing: 0 },
      },
    },
  };
  const parsed = dataSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new SnapshotError('Normalized iFinD snapshot failed validation.', 'invalid_snapshot');
  return parsed.data;
}

const capColumns = { code: ['股票代码', '证券代码'], name: ['股票简称', '证券简称'], industry: INDUSTRY_HEADERS, metric: [CAP_HEADER] };
const profitColumns = { code: ['股票代码', '证券代码'], name: ['股票简称', '证券简称'], industry: INDUSTRY_HEADERS, metric: [PROFIT_HEADER] };
const SOURCE = 'iFinD MCP search_stocks controlled single-indicator queries';

function contentText(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  if (result.isError) throw new IfindError('iFinD rejected the controlled bank query.', 'tool_error');
  const text = result.content.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n');
  if (!text.trim()) throw new SnapshotError('iFinD returned empty bank table content.', 'empty_content');
  if (/\b(?:truncated|too many rows omitted|showing\s+\d+\s+of\s+\d+)\b/i.test(text)) {
    throw new SnapshotError('iFinD bank result was truncated.', 'truncated_content');
  }
  return text;
}

export async function fetchBankSnapshotWithEvidence(client?: IfindMcpClient): Promise<BankSnapshotAcquisition> {
  const mcp = client ?? new IfindMcpClient({ token: process.env.IFIND_MCP_AUTH_TOKEN ?? '' });
  const capResult = await mcp.callTool('search_stocks', {
    query: '列出全部A股银行股，不要筛除个股；以股票代码、股票简称、所属同花顺行业、最新交易日总市值返回Markdown表格；每只股票一行，按股票代码升序，完整返回全部结果。',
  });
  const profitResult = await mcp.callTool('search_stocks', {
    query: '列出与上一查询相同的全部A股银行股，不要筛除个股；以股票代码、股票简称、所属同花顺行业、最近一期已披露的归属于母公司所有者的净利润同比增长率返回Markdown表格；每只股票一行，按股票代码升序，完整返回全部结果。',
  });
  const capTable = parseMarkdownTable(contentText(capResult), capColumns);
  const profitTable = parseMarkdownTable(contentText(profitResult), profitColumns);
  const capRows = capTable.rows.map((row) => ({ ...row, [CODE_HEADER]: row[CODE_HEADER] ?? row['证券代码'], [NAME_HEADER]: row[NAME_HEADER] ?? row['证券简称'] }));
  const profitRows = profitTable.rows.map((row) => ({ ...row, [CODE_HEADER]: row[CODE_HEADER] ?? row['证券代码'], [NAME_HEADER]: row[NAME_HEADER] ?? row['证券简称'] }));
  const capturedAt = new Date().toISOString();
  const snapshot = mergeBankTables(capRows, profitRows, { capturedAt });
  const marketCapDate = dateFor(uniqueColumn(capRows[0], CAP_HEADER, 'market capitalization'), 'market capitalization');
  const netProfitYoyDate = dateFor(uniqueColumn(profitRows[0], PROFIT_HEADER, 'net profit growth'), 'net profit growth');
  return {
    snapshot,
    evidence: { source: SOURCE, capturedAt, statisticDates: { marketCap: marketCapDate, netProfitYoy: netProfitYoyDate }, liveRequests: 2 },
  };
}

export async function fetchBankSnapshot(client?: IfindMcpClient): Promise<DataSnapshot> {
  return (await fetchBankSnapshotWithEvidence(client)).snapshot;
}
