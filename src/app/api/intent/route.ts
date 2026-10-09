import { z } from 'zod';
import { strategySchema } from '../../../lib/domain/schema';
import { DeepSeekError, requestIntent } from '../../../lib/ai/deepseek';
import { IntentOutputError, parseIntentOutput } from '../../../lib/ai/intent-schema';
import { resolveIntent } from '../../../lib/mapping/resolver';

const requestSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  currentStrategy: strategySchema.optional(),
  previousStrategy: strategySchema.optional(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'invalid_request', message: '请求内容必须是有效 JSON。' } }, { status: 400 });
  }
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return Response.json({ error: { code: 'invalid_request', message: '请提供有效的 query 和可选 currentStrategy。' } }, { status: 400 });
  }
  const { query, currentStrategy, previousStrategy } = parsedRequest.data;
  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json({ error: { code: 'not_configured', message: '意图服务暂不可用。' } }, { status: 503 });
  }
  try {
    const result = await requestIntent(query, currentStrategy ?? null);
    const parsedIntent = parseIntentOutput(query, result.output, currentStrategy ?? null);
    const resolved = resolveIntent(query, parsedIntent.strategy, {
      ...(currentStrategy ? { currentStrategy } : {}),
      ...(previousStrategy ? { previousStrategy } : {}),
    });
    const unsupportedRequests = [...parsedIntent.unsupportedRequests];
    for (const item of resolved.unsupportedRequests) {
      if (!unsupportedRequests.some((existing) => existing.request === item.request)) unsupportedRequests.push(item);
    }
    const clarifications = [...new Set([...parsedIntent.clarifications, ...resolved.clarifications])];
    const assumptions = [...new Set([...parsedIntent.assumptions, ...resolved.assumptions])];
    const intent = {
      ...parsedIntent,
      ...resolved,
      assumptions,
      clarifications,
      unsupportedRequests,
      canExecute: parsedIntent.canExecute && resolved.canExecute && clarifications.length === 0 && unsupportedRequests.length === 0,
    };
    return Response.json({ intent });
  } catch (error) {
    if (error instanceof DeepSeekError && error.kind === 'missing_key') {
      return Response.json({ error: { code: 'not_configured', message: '意图服务暂不可用。' } }, { status: 503 });
    }
    if (error instanceof DeepSeekError && error.kind === 'timeout') {
      return Response.json({ error: { code: 'provider_timeout', message: '意图服务响应超时，请重试。' } }, { status: 504 });
    }
    if (error instanceof DeepSeekError) {
      return Response.json({ error: { code: 'provider_error', message: '意图服务暂时无法处理请求。' } }, { status: 502 });
    }
    if (error instanceof IntentOutputError) {
      return Response.json({ error: { code: 'invalid_model_output', kind: error.kind, message: '无法安全解析选股意图，请调整表述后重试。' } }, { status: 502 });
    }
    return Response.json({ error: { code: 'internal_error', message: '意图服务暂时无法处理请求。' } }, { status: 500 });
  }
}
