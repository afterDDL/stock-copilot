import { IfindError } from './errors';

export interface IfindContent { type: string; text?: string }
export interface IfindToolResult { content: IfindContent[]; isError?: boolean }
export interface IfindClientOptions {
  token: string;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

const STOCK_ENDPOINT = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp';

export class IfindMcpClient {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private sessionId: string | undefined;
  private requestId = 0;

  constructor(options: IfindClientOptions) {
    this.token = options.token;
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private async post(payload: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<{ response: Response; body: Record<string, unknown> | null }> {
    let response: Response;
    try {
      response = await this.fetcher(STOCK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: this.token,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch {
      throw new IfindError('Unable to reach the iFinD data service.', 'upstream_unavailable', true);
    }

    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      throw new IfindError('iFinD returned an unreadable response.', 'invalid_upstream_response');
    }
    return { response, body };
  }

  private async initialize(): Promise<void> {
    if (this.sessionId) return;
    const { response, body } = await this.post({
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'stock-copilot', version: '1.0.0' },
      },
    }, Math.min(this.timeoutMs, 30_000));
    if (!response.ok || body?.error || !body?.result) {
      throw new IfindError('iFinD MCP initialization failed.', 'mcp_initialization_failed', response.status >= 500 || response.status === 429);
    }
    const sessionId = response.headers.get('Mcp-Session-Id');
    if (!sessionId) throw new IfindError('iFinD MCP initialization omitted its session.', 'mcp_session_missing');
    this.sessionId = sessionId;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, Math.min(this.timeoutMs, 10_000));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<IfindToolResult> {
    if (!this.token.trim()) throw new IfindError('iFinD credentials are not configured.', 'missing_credentials');
    await this.initialize();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { response, body } = await this.post({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      if (response.status === 429) {
        if (attempt === 0) {
          await this.sleep(300);
          continue;
        }
        throw new IfindError('iFinD rate limit remained after one retry.', 'rate_limited', true);
      }
      if (!response.ok || body?.error) {
        throw new IfindError('iFinD tool request failed.', response.status >= 500 ? 'upstream_unavailable' : 'upstream_error', response.status >= 500);
      }
      const result = body?.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new IfindError('iFinD returned an invalid tool result.', 'invalid_tool_result');
      }
      const toolResult = result as IfindToolResult;
      if (!Array.isArray(toolResult.content)) throw new IfindError('iFinD returned no readable tool content.', 'invalid_tool_result');
      const texts = toolResult.content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text!);
      const contentQuotaExhausted = texts.some((text) => /(?:工具.{0,12}(?:请求|调用)次数.{0,8}上限|(?:账号|账户).{0,8}权益.{0,8}上限)/u.test(text));
      if (contentQuotaExhausted) throw new IfindError('iFinD search quota is exhausted.', 'quota_exhausted');
      const contentRateLimit = texts.some((text) => /(?:\b429\b|too many requests|rate.?limit)/i.test(text));
      if (contentRateLimit) {
        if (attempt === 0) {
          await this.sleep(300);
          continue;
        }
        throw new IfindError('iFinD rate limit remained after one retry.', 'rate_limited', true);
      }
      if (toolResult.isError) throw new IfindError('iFinD rejected the controlled stock query.', 'tool_error');
      if (texts.length === 0) throw new IfindError('iFinD returned no table content.', 'empty_content');
      return { ...toolResult, content: texts.map((text) => ({ type: 'text', text })) };
    }
    throw new IfindError('iFinD rate limit remained after one retry.', 'rate_limited', true);
  }
}
