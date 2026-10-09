import { describe, expect, it } from 'vitest';
import { mergeBankTables } from './banks';
import { SnapshotError } from './errors';

const headers = {
  code: '股票代码',
  name: '股票简称',
  industry: '所属同花顺行业',
  marketCap: '总市值[20261009]',
  profit: '归属于母公司所有者的净利润同比增长率[20260630]',
};

const caps = [
  { [headers.code]: '000001.SZ', [headers.name]: '平安银行', [headers.industry]: '银行-银行-股份制银行', [headers.marketCap]: '224914591914.82' },
  { [headers.code]: '600000.SH', [headers.name]: '浦发银行', [headers.industry]: '银行-银行-股份制银行', [headers.marketCap]: '317737697382' },
];
const profits = [
  { [headers.code]: '000001.SZ', [headers.name]: '平安银行', [headers.industry]: '银行-银行-股份制银行', [headers.profit]: '3.321270607157217' },
  { [headers.code]: '600000.SH', [headers.name]: '浦发银行', [headers.industry]: '银行-银行-股份制银行', [headers.profit]: '4.0824561993476145' },
];

describe('mergeBankTables', () => {
  it('joins distinct indicator queries by normalized six-digit code and preserves metric dates', () => {
    const snapshot = mergeBankTables(caps, profits, { capturedAt: '2026-10-09T15:53:37.301Z', expectedStocks: 2 });
    expect(snapshot.source).toBe('live');
    expect(snapshot.stocks.map((stock) => stock.code)).toEqual(['000001', '600000']);
    expect(snapshot.stocks[0].metrics.market_cap_cny).toMatchObject({ value: 224914591914.82, date: '2026-10-09' });
    expect(snapshot.stocks[0].metrics.net_profit_parent_yoy_pct).toMatchObject({ value: 3.321270607157217, date: '2026-06-30' });
    expect(snapshot.coverage).toMatchObject({ expectedStocks: 2, returnedStocks: 2, complete: true });
  });

  it('rejects duplicates and missing cross-query coverage', () => {
    expect(() => mergeBankTables([...caps, caps[0]], profits, { capturedAt: '2026-10-09T15:53:37.301Z', expectedStocks: 2 })).toThrowError(/duplicate/i);
    expect(() => mergeBankTables(caps, profits.slice(0, 1), { capturedAt: '2026-10-09T15:53:37.301Z', expectedStocks: 2 })).toThrowError(/coverage/i);
  });
});
