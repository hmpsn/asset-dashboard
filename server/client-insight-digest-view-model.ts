import type { MonthlyDigestData } from '../shared/types/narrative.js';
import type { Workspace } from './workspaces.js';
import { generateMonthlyDigest } from './monthly-digest.js';

export async function buildClientMonthlyDigestView(
  ws: Workspace,
): Promise<MonthlyDigestData> {
  return generateMonthlyDigest(ws);
}
