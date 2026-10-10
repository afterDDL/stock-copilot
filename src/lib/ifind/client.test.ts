import { describe, expect, it, vi } from 'vitest';
import type { Strategy } from '../domain/types';
import { fetchAshareCandidates } from './a-share-search';
import { IfindMcpClient } from './client';

describe('IfindMcpClient', () => {
  it('retries a 429 reported inside MCP content once before returning success', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), { status: 200, headers: { 'Mcp-Session-Id': 's1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: '429 Too Many Requests' }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'ok' }] } }), { status: 200 }));
    const client = new IfindMcpClient({ token: 'test-token', fetch: fetcher as typeof fetch, sleep: async () => undefined });

    const result = await client.callTool('search_stocks', { query: 'fixed fixture query' });

    expect(result.content[0].text).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(4); // initialize, initialized notification, tool call, retry
  });

  it('fails safely when credentials are missing', async () => {
    const client = new IfindMcpClient({ token: '', fetch: vi.fn() as typeof fetch });
    await expect(client.callTool('search_stocks', { query: 'x' })).rejects.toMatchObject({ code: 'missing_credentials' });
  });

  it.each(['该工具请求次数已达到上限', '当前账号权益上限不足'])('classifies Chinese quota notice before candidate parsing: %s', async (quotaNotice) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), { status: 200, headers: { 'Mcp-Session-Id': 's1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: '2.0', id: 2,
        result: { isError: true, content: [{ type: 'text', text: quotaNotice }] },
      }), { status: 200 }));
    const client = new IfindMcpClient({ token: 'test-token', fetch: fetcher as typeof fetch, sleep: async () => undefined });
    const strategy: Strategy = {
      id: 'quota-check', version: 1, name: '行业策略', market: 'cn_a',
      conditions: [{
        field: 'industry', operator: 'eq', value: '电子-半导体', unit: '行业', statisticDate: null,
        sourceExpression: '电子半导体', aiInferred: false, editable: true,
      }],
      sort: { field: 'net_profit_parent_yoy_pct', direction: 'desc' },
    };

    await expect(fetchAshareCandidates(strategy, client)).rejects.toMatchObject({
      name: 'IfindError', code: 'quota_exhausted', retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(3); // initialize, initialized notification, quota error; no retry or second search
  });
});
