import { describe, expect, it } from 'vitest';
import { parseMarkdownTable } from './markdown';
import { SnapshotError } from './errors';

const capTable = `| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261009] |
|---|---|---|---:|
| 000001.SZ | 平安银行 | 银行-银行-股份制银行 | 224914591914.82 |
| 600000.SH | 浦发银行 | 银行-银行-股份制银行 | 317737697382 |`;

describe('parseMarkdownTable', () => {
  it('maps the statistic date from each metric column header', () => {
    const table = parseMarkdownTable(capTable, {
      code: ['股票代码'],
      name: ['股票简称'],
      industry: ['所属同花顺行业'],
      metric: ['总市值'],
    });

    expect(table.dateByColumn.get('总市值[20261009]')).toBe('2026-10-09');
    expect(table.rows[0]).toEqual({
      '股票代码': '000001.SZ',
      '股票简称': '平安银行',
      '所属同花顺行业': '银行-银行-股份制银行',
      '总市值[20261009]': '224914591914.82',
    });
  });

  it('unwraps iFinD JSON content envelopes before parsing the embedded answer table', () => {
    const wrapped = JSON.stringify({
      code: 1,
      msg: 'success',
      data: {
        selectedSecuritiesCount: 1,
        answer: `| 股票代码 | 股票简称 | 所属同花顺行业 | 总市值[20261009] |\n|---|---|---|---|\n| 000001.SZ | 平安银行 | 银行-银行-股份制银行 | 224914591914.82 |`,
      },
    });
    const table = parseMarkdownTable(wrapped, { code: ['股票代码'], metric: ['总市值'] });
    expect(table.rows).toHaveLength(1);
    expect(table.dateByColumn.get('总市值[20261009]')).toBe('2026-10-09');
  });

  it('rejects empty or truncated tables instead of treating them as successful empty results', () => {
    expect(() => parseMarkdownTable('', { metric: ['总市值'] })).toThrowError(SnapshotError);
    expect(() => parseMarkdownTable('| 股票代码 | 总市值[20261009] |\n|---|---|\n| 000001.SZ |', {
      code: ['股票代码'], metric: ['总市值'],
    })).toThrowError(/truncated/i);
  });

  it('rejects wrong columns instead of silently mapping a similarly named field', () => {
    expect(() => parseMarkdownTable('| 股票代码 | 市值 |\n|---|---|\n| 000001.SZ | 12 |', {
      code: ['股票代码'], metric: ['总市值'],
    })).toThrowError(/column/i);
  });
});
