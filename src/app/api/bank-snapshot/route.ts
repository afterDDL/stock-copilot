import historicalData from '../../../../data/bank-snapshot.json';
import { dataSnapshotSchema } from '../../../lib/domain/schema';
import { fetchBankSnapshotWithEvidence } from '../../../lib/ifind/banks';
import { safeErrorDetails } from '../../../lib/ifind/errors';

export const dynamic = 'force-dynamic';

const historical = dataSnapshotSchema.parse(historicalData.snapshot);
const historicalEvidence = historicalData.evidence;

export async function GET(request: Request): Promise<Response> {
  const requestedMode = new URL(request.url).searchParams.get('mode') ?? 'live';
  if (requestedMode !== 'live' && requestedMode !== 'historical') {
    return Response.json({ error: { code: 'invalid_mode', message: 'mode must be live or historical.', retryable: false } }, { status: 400 });
  }

  if (requestedMode === 'historical') {
    return Response.json({ mode: 'historical', snapshot: historical, coverage: historical.coverage, evidence: historicalEvidence });
  }

  try {
    const { snapshot, evidence } = await fetchBankSnapshotWithEvidence();
    return Response.json({ mode: 'live', snapshot, coverage: snapshot.coverage, evidence });
  } catch (error) {
    return Response.json({
      mode: 'historical',
      snapshot: historical,
      coverage: historical.coverage,
      evidence: historicalEvidence,
      error: safeErrorDetails(error),
    });
  }
}
