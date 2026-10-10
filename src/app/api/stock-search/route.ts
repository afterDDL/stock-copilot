import { z } from 'zod';
import { strategySchema } from '../../../lib/domain/schema';
import { AshareSearchError } from '../../../lib/ifind/errors';
import { fetchAshareCandidates } from '../../../lib/ifind/a-share-search';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ strategy: strategySchema }).strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'invalid_request', message: '请提供有效的选股策略。' } }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: 'invalid_strategy', message: '请提供有效的选股策略。' } }, { status: 400 });
  }

  try {
    const { snapshot, evidence } = await fetchAshareCandidates(parsed.data.strategy);
    return Response.json({ mode: 'live', snapshot, coverage: snapshot.coverage, evidence });
  } catch (error) {
    if (error instanceof AshareSearchError && error.code === 'needs_narrowing') {
      return Response.json({ error: { code: 'needs_narrowing', message: '结果较多，请补充行业或提高筛选门槛。' } }, { status: 422 });
    }
    return Response.json({ error: { code: 'data_unavailable', message: '数据暂时不可用，请稍后重试。' } }, { status: 503 });
  }
}
