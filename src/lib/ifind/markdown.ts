import { SnapshotError } from './errors';

export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
  dateByColumn: Map<string, string>;
  reportedRows?: number;
}

export function parseMarkdownTable(
  markdown: string,
  columns: Record<string, string[]>,
): ParsedTable {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new SnapshotError('iFinD returned empty table content.', 'empty_content');
  }

  let source = markdown.trim();
  let reportedRows: number | undefined;
  if (source.startsWith('{')) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(source);
    } catch {
      throw new SnapshotError('iFinD returned a malformed response envelope.', 'invalid_upstream_response');
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new SnapshotError('iFinD returned an invalid response envelope.', 'invalid_upstream_response');
    }
    const data = (envelope as { code?: unknown; msg?: unknown; data?: unknown }).data;
    if ((envelope as { code?: unknown }).code !== 1 || !data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SnapshotError('iFinD did not return a successful selection result.', 'upstream_error');
    }
    const answer = (data as { answer?: unknown }).answer;
    const selectedCount = (data as { selectedSecuritiesCount?: unknown }).selectedSecuritiesCount;
    if (typeof answer !== 'string' || (selectedCount !== undefined && (!Number.isInteger(selectedCount) || (selectedCount as number) < 0))) {
      throw new SnapshotError('iFinD selection result is missing its table or row count.', 'invalid_upstream_response');
    }
    source = answer;
    reportedRows = selectedCount as number | undefined;
  }

  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('|'));
  const separatorIndex = lines.findIndex((line) => /^\|?\s*:?-{3,}/.test(line.replace(/\|/g, '')));
  if (separatorIndex < 1) {
    throw new SnapshotError('iFinD table content is missing a valid header or separator.', 'truncated_content');
  }
  const splitRow = (line: string) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const headers = splitRow(lines[separatorIndex - 1]);
  if (headers.length < 2 || headers.some((header) => !header)) {
    throw new SnapshotError('iFinD returned a truncated table header.', 'truncated_content');
  }
  for (const [role, choices] of Object.entries(columns)) {
    if (!headers.some((header) => choices.some((choice) => header === choice || (role === 'metric' && header.startsWith(`${choice}[`))))) {
      throw new SnapshotError(`iFinD table is missing the expected ${role} column.`, 'wrong_columns');
    }
  }

  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(separatorIndex + 1)) {
    if (!line.endsWith('|')) throw new SnapshotError('iFinD table content is truncated.', 'truncated_content');
    const cells = splitRow(line);
    if (cells.length !== headers.length || cells.some((cell) => cell === '')) {
      throw new SnapshotError('iFinD table content is truncated or has inconsistent columns.', 'truncated_content');
    }
    rows.push(Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
  }
  if (rows.length === 0) throw new SnapshotError('iFinD returned an empty result table.', 'empty_content');
  if (reportedRows !== undefined && rows.length !== reportedRows) {
    throw new SnapshotError('iFinD table row count does not match its reported coverage.', 'coverage_mismatch');
  }

  const dateByColumn = new Map<string, string>();
  for (const header of headers) {
    const match = header.match(/\[(\d{8})\]$/);
    if (match) dateByColumn.set(header, `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`);
  }
  return { headers, rows, dateByColumn, ...(reportedRows !== undefined ? { reportedRows } : {}) };
}
