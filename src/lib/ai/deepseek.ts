import { IntentOutputError } from './intent-schema';
import { INTENT_JSON_SCHEMA, buildIntentPrompt } from './prompt';
import type { Strategy } from '../domain/types';

export class DeepSeekError extends Error {
  constructor(public readonly kind: 'missing_key' | 'http' | 'provider' | 'incomplete' | 'timeout', message: string) {
    super(message);
    this.name = 'DeepSeekError';
  }
}

type DeepSeekResult = { output: string; durationMs: number };

function extractOutput(body: Record<string, unknown>): string {
  if (typeof body.output_text === 'string') return body.output_text;
  const output = body.output;
  if (!Array.isArray(output)) return '';
  return output.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const message = item as Record<string, unknown>;
    if (message.type !== 'message') return [];
    const content = message.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'output_text' && typeof (part as Record<string, unknown>).text === 'string'
      ? [(part as Record<string, string>).text]
      : []);
  }).join('');
}

export async function requestIntent(query: string, currentStrategy: Strategy | null, apiKey = process.env.DEEPSEEK_API_KEY): Promise<DeepSeekResult> {
  if (!apiKey) throw new DeepSeekError('missing_key', 'DeepSeek is not configured.');
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-flash',
        input: buildIntentPrompt(query, currentStrategy),
        text: { format: { type: 'json_schema', name: 'stock_screening_intent', strict: true, schema: INTENT_JSON_SCHEMA } },
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new DeepSeekError('timeout', 'DeepSeek request timed out.');
    throw new DeepSeekError('provider', 'DeepSeek request failed.');
  }
  const durationMs = Date.now() - startedAt;
  if (!response.ok) throw new DeepSeekError('http', `DeepSeek returned HTTP ${response.status}.`);
  let body: Record<string, unknown>;
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    throw new IntentOutputError('schema_invalid', 'DeepSeek response body was not valid JSON.');
  }
  if (body.status === 'incomplete') throw new DeepSeekError('incomplete', 'DeepSeek response was incomplete.');
  if (body.status === 'failed' || body.error) throw new DeepSeekError('provider', 'DeepSeek could not process the request.');
  return { output: extractOutput(body), durationMs };
}
