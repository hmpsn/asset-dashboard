// TEMP walkthrough helper — drop duplicate-ID recs from one workspace's set AND
// recompute the summary so counts match, so the cockpit renders cleanly. Safe to delete.
import {
  loadRecommendations,
  saveRecommendations,
  computeRecommendationSummary,
} from '../server/recommendations.js';

const wsId = process.argv[2] || 'ws_1772637771590';
const set = loadRecommendations(wsId);
if (!set) {
  console.error('NO_REC_SET', wsId);
  process.exit(1);
}

const seen = new Set<string>();
const deduped = set.recommendations.filter((r) =>
  seen.has(r.id) ? false : (seen.add(r.id), true),
);
const removed = set.recommendations.length - deduped.length;

set.recommendations = deduped;
set.summary = computeRecommendationSummary(deduped);
saveRecommendations(set);

console.log('deduped + resummarized:', removed, 'removed | now', deduped.length, 'recs');
process.exit(0);
