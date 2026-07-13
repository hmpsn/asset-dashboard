import type {
  KeywordCommandCenterInitialViewResponse,
  KeywordCommandCenterRowsQuery,
} from '../../../shared/types/keyword-command-center.js';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center.js';
import { createLogger } from '../../logger.js';
import { buildKeywordCommandCenterRows } from './rows-service.js';
import { buildKeywordCommandCenterSummary } from './summary-service.js';
import { buildKeywordCommandCenterSourceSnapshot } from './source-snapshot.js';

const log = createLogger('keyword-command-center');

export async function buildKeywordCommandCenterInitialView(
  workspaceId: string,
  rowsQuery: KeywordCommandCenterRowsQuery = {},
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterInitialViewResponse | null> {
  const startedAt = Date.now();
  if ((rowsQuery.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL) === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) {
    throw new Error('Keyword Command Center initial view does not support local_candidates');
  }
  const sourceSnapshot = buildKeywordCommandCenterSourceSnapshot(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeSummary: true,
  });
  if (!sourceSnapshot) return null;
  const summary = await buildKeywordCommandCenterSummary(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    sourceSnapshot,
  });
  const rows = await buildKeywordCommandCenterRows(workspaceId, rowsQuery, {
    includeLocalSeo: options.includeLocalSeo,
    sourceSnapshot,
  });
  if (!summary || !rows) return null;
  log.info({
    workspaceId,
    mode: 'initial-view-skinny',
    rowFilter: rowsQuery.filter ?? 'all',
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center initial view built');
  return { summary, rows };
}
