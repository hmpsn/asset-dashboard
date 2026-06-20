// TEMP walkthrough helper — populate the managed keyword set + regenerate recs
// (so signal-fold renders) for one workspace against the local DB. Safe to delete.
import db from '../server/db/index.js';
import { getWorkspace } from '../server/workspaces.js';
import { reconcileStrategyKeywordSet } from '../server/domains/strategy/managed-keyword-set.js';
import { generateRecommendations } from '../server/recommendations.js';

const wsId = process.argv[2] || 'ws_1772637771590';
const ws = getWorkspace(wsId);
if (!ws) {
  console.error('NO_WORKSPACE', wsId);
  process.exit(1);
}
console.log('workspace:', ws.name, '| hasStrategy:', !!ws.keywordStrategy);

// (1) Managed keyword set — AI-free reconcile from the existing strategy.
if (ws.keywordStrategy) {
  db.transaction(() => reconcileStrategyKeywordSet(wsId, ws.keywordStrategy!))();
  console.log('OK reconciled managed keyword set');
} else {
  console.log('WARN no keywordStrategy — managed set will stay empty');
}

// (2) Recs — regenerate so mintSignalRecs (strategy-signal-fold) folds signals in.
try {
  const set = await generateRecommendations(wsId);
  const recs = set.recommendations || [];
  const signalRecs = recs.filter((r: { source?: string }) => String(r.source || '').startsWith('signal:'));
  console.log('OK generated recs:', recs.length, '| signal-sourced:', signalRecs.length);
} catch (e) {
  console.error('REGEN_ERR', (e as Error)?.message || e);
}
process.exit(0);
