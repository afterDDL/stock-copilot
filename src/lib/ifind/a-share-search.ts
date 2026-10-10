import { dataSnapshotSchema } from '../domain/schema';
import type { DataSnapshot, Indicator, MetricValue, Strategy } from '../domain/types';
import { AshareSearchError, IfindError, SnapshotError } from './errors';
import { IfindMcpClient, type IfindToolResult } from './client';
import { parseMarkdownTable } from './markdown';

export interface QuerySnapshotAcquisition {
  snapshot: DataSnapshot;
  evidence: {
    source: string;
    capturedAt: string;
    statisticDates: Record<string, string | null>;
    liveRequests: number;
  };
}

const CAP = 'market_cap_cny';
const PROFIT = 'net_profit_parent_yoy_pct';
const CAP_LABEL = '总市值';
const PROFIT_LABEL = '归属于母公司所有者的净利润同比增长率';
const CODE = '股票代码';
const NAME = '股票简称';
const INDUSTRY = '所属同花顺行业';
const SOURCE = 'iFinD MCP search_stocks controlled single-indicator queries';
const columns = (metric: string) => ({ code: [CODE], name: [NAME], industry: [INDUSTRY], metric: [metric] });

function conditionText(strategy: Strategy): string {
  const operator: Record<string, string> = { eq: '等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于' };
  return strategy.conditions.map((condition) => {
    const value = typeof condition.value === 'string' ? `“${condition.value.replace(/[“”]/g, '')}”` : String(condition.value);
    const unit = condition.field === CAP ? '元' : condition.field === PROFIT ? '%' : '';
    return `${condition.field === 'industry' ? '所属行业' : condition.field === CAP ? CAP_LABEL : PROFIT_LABEL}${operator[condition.operator]}${value}${unit}`;
  }).join('，');
}

export function buildSearchQueries(strategy: Strategy): [string, string] {
  const scope = `在沪深北A股范围筛选${conditionText(strategy) ? `，条件为${conditionText(strategy)}` : ''}`;
  const shared = `${scope}；按股票代码升序，每只股票一行，完整返回全部结果；`;
  return [
    `${shared}只返回股票代码、股票简称、所属同花顺行业和${CAP_LABEL}[${dateCompact(strategy, CAP)}]，数值单位为元，使用Markdown表格。`,
    `${shared}只返回股票代码、股票简称、所属同花顺行业和${PROFIT_LABEL}[${dateCompact(strategy, PROFIT)}]，数值单位为百分比，使用Markdown表格。`,
  ];
}

function dateCompact(strategy: Strategy, field: Indicator): string {
  const date = strategy.conditions.find((condition) => condition.field === field)?.statisticDate;
  return date ? date.replaceAll('-', '') : field === CAP ? '最新交易日' : '最近已披露期';
}

function responseText(result: IfindToolResult): string {
  if (result.isError) throw new IfindError('iFinD rejected the controlled stock query.', 'tool_error');
  const text = result.content.filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
  if (!text.trim()) throw new SnapshotError('iFinD returned empty table content.', 'empty_content');
  if (/\b(?:truncated|too many rows omitted|showing\s+\d+\s+of\s+\d+)\b|显示(?:前|了)\s*\d+\s*(?:条|行).*(?:共|总计)\s*\d+/i.test(text)) {
    throw new SnapshotError('iFinD result was truncated.', 'truncated_content');
  }
  return text;
}

function validDate(header: string, metric: string, required: string | null): string {
  const match = header.match(/\[(\d{8})\]$/);
  if (!match) throw new SnapshotError(`Missing statistic date for ${metric}.`, 'missing_date');
  const compact = match[1];
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) throw new SnapshotError(`Invalid statistic date for ${metric}.`, 'invalid_date');
  if (required && date !== required) throw new SnapshotError(`Unexpected statistic date for ${metric}.`, 'wrong_statistic_date');
  return date;
}

function normalizeCode(raw: string): string {
  const match = raw.trim().match(/^(\d{6})(?:\.(?:SZ|SH|BJ))?$/i);
  if (!match) throw new SnapshotError('iFinD returned an invalid stock code.', 'invalid_stock_code');
  return match[1];
}

function numeric(raw: string, field: typeof CAP | typeof PROFIT): number | null {
  const value = raw.trim();
  if (!value || /^(?:--|—|-|N\/A|NA|暂无|不适用)$/i.test(value)) return null;
  if (field === CAP) {
    const match = value.replace(/,/g, '').match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(元|万元|亿元)?$/);
    if (!match) throw new SnapshotError('iFinD returned a market capitalization with an invalid unit.', 'invalid_metric_unit');
    const multiplier = match[2] === '亿元' ? 100_000_000 : match[2] === '万元' ? 10_000 : 1;
    const result = Number(match[1]) * multiplier;
    if (!Number.isFinite(result)) throw new SnapshotError('iFinD returned an invalid market capitalization.', 'invalid_metric');
    return result;
  }
  const match = value.replace(/,/g, '').match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*%?$/);
  if (!match) throw new SnapshotError('iFinD returned profit growth with an invalid unit.', 'invalid_metric_unit');
  const result = Number(match[1]);
  if (!Number.isFinite(result)) throw new SnapshotError('iFinD returned invalid profit growth.', 'invalid_metric');
  return result;
}

function rowsByCode(rows: Array<Record<string, string>>, field: typeof CAP | typeof PROFIT): Map<string, Record<string, string>> {
  if (rows.length > 100) throw new SnapshotError('iFinD returned more than 100 candidate rows.', 'coverage_mismatch');
  const result = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const code = normalizeCode(row[CODE] ?? '');
    if (result.has(code)) throw new SnapshotError(`Duplicate stock code in ${field} query.`, 'duplicate_rows');
    result.set(code, row);
  }
  return result;
}

function parsedQuery(markdown: string, field: typeof CAP | typeof PROFIT, strategy: Strategy) {
  const label = field === CAP ? CAP_LABEL : PROFIT_LABEL;
  const table = parseMarkdownTable(markdown, columns(label), { allowEmptyRows: true, allowEmptyMetric: true });
  if (table.headers.length !== 4) throw new SnapshotError('iFinD returned unexpected columns for a single-indicator query.', 'wrong_columns');
  if (table.rows.length > 100 || (table.reportedRows ?? 0) > 100) throw new SnapshotError('iFinD returned more than 100 candidate rows.', 'coverage_mismatch');
  const column = table.headers.filter((header) => header === label || header.startsWith(`${label}[`));
  if (column.length !== 1) throw new SnapshotError(`Expected one ${label} column.`, 'wrong_columns');
  const expectedDate = strategy.conditions.find((condition) => condition.field === field)?.statisticDate ?? null;
  const date = validDate(column[0], label, expectedDate);
  return { rows: rowsByCode(table.rows, field), date };
}

export async function fetchAshareCandidates(strategy: Strategy, client?: IfindMcpClient): Promise<QuerySnapshotAcquisition> {
  const mcp = client ?? new IfindMcpClient({ token: process.env.IFIND_MCP_AUTH_TOKEN ?? '' });
  const queries = buildSearchQueries(strategy);
  const results = [
    await mcp.callTool('search_stocks', { query: queries[0] }),
    await mcp.callTool('search_stocks', { query: queries[1] }),
  ];
  try {
    const cap = parsedQuery(responseText(results[0]), CAP, strategy);
    const profit = parsedQuery(responseText(results[1]), PROFIT, strategy);
    if (cap.rows.size !== profit.rows.size || [...cap.rows.keys()].some((code) => !profit.rows.has(code))) {
      throw new SnapshotError('iFinD candidate code sets did not match.', 'coverage_mismatch');
    }
    const stocks = [...cap.rows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([code, capRow]) => {
      const profitRow = profit.rows.get(code)!;
      const name = capRow[NAME]?.trim();
      const industry = capRow[INDUSTRY]?.trim();
      if (!name || !industry || profitRow[NAME]?.trim() !== name || profitRow[INDUSTRY]?.trim() !== industry) {
        throw new SnapshotError('iFinD identity columns did not match across queries.', 'identity_mismatch');
      }
      const capValue = numeric(capRow[Object.keys(capRow).find((key) => key === CAP_LABEL || key.startsWith(`${CAP_LABEL}[`))!], CAP);
      const profitValue = numeric(profitRow[Object.keys(profitRow).find((key) => key === PROFIT_LABEL || key.startsWith(`${PROFIT_LABEL}[`))!], PROFIT);
      const metric = (value: number | null, unit: '元' | '%', date: string): MetricValue => ({ value, unit, date, source: 'live', coverage: value === null ? 'missing' : 'available' });
      return {
        code, name, industry,
        metrics: {
          industry: { value: industry, unit: '行业' as const, date: null, source: 'live' as const, coverage: 'available' as const },
          market_cap_cny: metric(capValue, '元', cap.date),
          net_profit_parent_yoy_pct: metric(profitValue, '%', profit.date),
        },
      };
    });
    const capturedAt = new Date().toISOString();
    const snapshot: DataSnapshot = {
      snapshotId: `ifind-a-shares-${capturedAt.slice(0, 10)}`, source: 'live', asOf: capturedAt.slice(0, 10), stocks,
      coverage: {
        expectedStocks: stocks.length, returnedStocks: stocks.length, complete: true,
        metrics: Object.fromEntries((['industry', CAP, PROFIT] as const).map((field) => [field, {
          available: stocks.filter((stock) => stock.metrics[field].coverage === 'available').length,
          missing: stocks.filter((stock) => stock.metrics[field].coverage === 'missing').length,
        }])) as DataSnapshot['coverage']['metrics'],
      },
    };
    const parsed = dataSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new SnapshotError('Normalized iFinD candidates failed validation.', 'invalid_snapshot');
    return { snapshot: parsed.data, evidence: { source: SOURCE, capturedAt, statisticDates: { marketCap: cap.date, netProfitYoy: profit.date }, liveRequests: 2 } };
  } catch (error) {
    if (error instanceof SnapshotError && ['truncated_content', 'coverage_mismatch', 'duplicate_rows'].includes(error.code)) {
      throw new AshareSearchError();
    }
    throw error;
  }
}
