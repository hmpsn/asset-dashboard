import type {
  BriefingClientView,
} from '../shared/types/briefing.js';
import {
  buildBriefingClientView,
  type BuildBriefingClientViewOptions,
} from './briefing-client-projection.js';

export function buildClientBriefingView(
  workspaceId: string,
  opts?: BuildBriefingClientViewOptions,
): BriefingClientView | null {
  return buildBriefingClientView(workspaceId, opts);
}
