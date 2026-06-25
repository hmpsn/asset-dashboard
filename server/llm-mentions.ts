/**
 * llm-mentions — background job that reads the LLM-mention share-of-voice +
 * source domains for a workspace's owner domain and persists the result as a
 * dated `llm_mention_snapshots` row (SEO Decision Engine P8 / ai-visibility).
 *
 * Structurally mirrors `runNationalSerpRefreshJob` (server/national-serp.ts) but
 * is SINGLE-CALL: one domain → one provider read → one snapshot. There is no
 * per-keyword loop, so no heap backpressure / progress broadcast — but the cancel
 * checks, observe-only budget gate, broadcast, and `unregisterAbort` finally are
 * kept for consistency with the rest of the SEO Decision Engine job family.
 *
 * Tier + flag gating is enforced at the ROUTE. The tier guard here is defense in
 * depth — a non-Growth/Premium workspace finishes the job as a clean no-op.
 *
 * Budget gate (P5): `assertCreditBudget` is OBSERVE-ONLY at launch (it logs the
 * would-block and returns). The call is wired so flipping enforcement on later
 * needs no change here, and a thrown CreditBudgetError is logged-and-skipped
 * (the job still records a clean no-op rather than crashing the refresh).
 */
import { createLogger } from './logger.js';
import { getJob, updateJob, unregisterAbort } from './jobs.js';
import { getWorkspace, computeEffectiveTier } from './workspaces.js';
import { cleanDomain } from './local-seo.js';
import { workspaceProviderGeo } from './seo-target-geo.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { storeLlmMentionSnapshot } from './llm-mentions-store.js';
import { assertCreditBudget, CreditBudgetError } from './credit-budget-gate.js';
import { broadcastToWorkspace } from './broadcast.js';
import { addActivity } from './activity-log.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('llm-mentions');

/** Owner decision (P8): the AI-visibility surface tracks the ChatGPT platform. */
const LLM_MENTIONS_PLATFORM = 'chat_gpt' as const;

export interface LlmMentionsRefreshSummary {
  /** Headline mention count from the latest snapshot (0 when no LLM presence). */
  mentions: number;
  /** 0..1 share-of-voice (client brand ÷ all co-mentioned brands); undefined = not measured. */
  shareOfVoice?: number;
}

const EMPTY_SUMMARY: LlmMentionsRefreshSummary = { mentions: 0 };
/** "55%" or "not measured" — share-of-voice is undefined when the client's brand isn't identifiable. */
function formatSov(shareOfVoice: number | undefined): string {
  return shareOfVoice == null ? 'not measured' : `${Math.round(shareOfVoice * 100)}% share of voice`;
}

/** True while the job has been cancelled (route registers an AbortController). */
function isCancelled(jobId: string): boolean {
  return getJob(jobId)?.status === 'cancelled';
}

/**
 * Resolve the workspace's own brand name(s) so share-of-voice can identify the
 * CLIENT among the co-mentioned brands. The only brand-name source today is
 * `workspace.name` (BusinessProfile has no name field). Deduped + non-empty.
 */
function resolveOwnerBrandNames(name: string | undefined, ownerDomain: string): string[] {
  // workspace.name first; fall back to the domain root (e.g. 'squareup.com' → 'squareup') so the
  // client is still identifiable among co-mentioned brands when the workspace name is blank (P8
  // review: a blank name otherwise leaves share-of-voice unmeasured + the client in its own
  // competitor list). The provider's brand matcher has a length/ratio guard against over-matching.
  const domainRoot = ownerDomain.split('.')[0]?.trim() ?? '';
  const names = [name, domainRoot]
    .map(value => value?.trim())
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return Array.from(new Set(names));
}

export async function runLlmMentionsRefreshJob(workspaceId: string, jobId: string): Promise<void> {
  try {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
      return;
    }

    // Defense in depth — the route already gates to Growth/Premium. Free finishes as a no-op.
    const tier = computeEffectiveTier(workspace);
    if (tier !== 'growth' && tier !== 'premium') {
      updateJob(jobId, {
        status: 'done',
        progress: 100,
        total: 100,
        message: 'AI visibility tracking requires a Growth or Premium plan',
        result: EMPTY_SUMMARY,
      });
      return;
    }

    const ownerDomain = cleanDomain(workspace.liveDomain);
    if (!ownerDomain) {
      const message = 'No live domain configured — connect a domain to track AI visibility';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }

    // Provider must support the optional LLM-mentions capability; feature-detect before use.
    const provider = getConfiguredProvider();
    if (!provider?.getLlmMentions) {
      const message = 'AI visibility tracking requires the DataForSEO provider (not configured)';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }
    const getLlmMentions = provider.getLlmMentions.bind(provider);

    // Own brand name(s) — passed so share-of-voice identifies the client among co-mentioned brands.
    const ownerBrandNames = resolveOwnerBrandNames(workspace.name, ownerDomain);

    // Target-geo (P4): admin target-geo → local primary market → US/'en'. Flag-gated inside the
    // helper; returns {} when geo-targeting is off, so the provider falls back to its US default.
    // LLM-mentions uses DataForSEO `location_name` rather than `location_code`; pass both the
    // resolved name and code so non-US workspaces do not silently fall back to United States.
    const { locationCode, locationName, languageCode } = workspaceProviderGeo(workspaceId);

    // P5 budget gate — observe-only at launch (logs the would-block, returns). Wrapped so a thrown
    // CreditBudgetError (only possible once enforcement is enabled) is logged-and-skipped: the job
    // records a clean no-op rather than crashing.
    try {
      assertCreditBudget(workspaceId, 'llm_mentions', tier);
    } catch (err) {
      if (err instanceof CreditBudgetError) {
        log.warn({ workspaceId, tier }, 'llm-mentions refresh: credit budget would-block — skipping refresh (observe-only)');
        updateJob(jobId, {
          status: 'done',
          progress: 100,
          total: 100,
          message: 'AI visibility refresh skipped — credit budget reached',
          result: EMPTY_SUMMARY,
        });
        return;
      }
      throw err;
    }

    updateJob(jobId, { status: 'running', total: 1, progress: 0, message: 'Reading AI visibility...' });

    const today = new Date().toISOString().slice(0, 10);

    // Cancel check BEFORE spending provider credits.
    if (isCancelled(jobId)) return;

    const result = await getLlmMentions(
      { domain: ownerDomain, platform: LLM_MENTIONS_PLATFORM, ownerBrandNames, locationCode, locationName, languageCode },
      workspaceId,
    );

    // Cancel check BEFORE persisting (the read is already paid; just don't write/broadcast).
    if (isCancelled(jobId)) return;

    storeLlmMentionSnapshot(workspaceId, today, LLM_MENTIONS_PLATFORM, {
      domain: result.domain,
      mentions: result.mentions,
      aiSearchVolume: result.aiSearchVolume,
      shareOfVoice: result.shareOfVoice,
      competitors: result.competitors,
      sourceDomains: result.sourceDomains,
    });

    const summary: LlmMentionsRefreshSummary = {
      mentions: result.mentions,
      shareOfVoice: result.shareOfVoice,
    };

    addActivity(
      workspaceId,
      'rank_snapshot',
      'AI visibility refreshed',
      `${result.mentions} AI-answer mentions captured for ${today} (${formatSov(result.shareOfVoice)})`,
      {
        source: 'llm_mentions',
        platform: LLM_MENTIONS_PLATFORM,
        mentions: result.mentions,
        shareOfVoice: result.shareOfVoice,
      },
    );

    broadcastToWorkspace(workspaceId, WS_EVENTS.LLM_MENTIONS_SNAPSHOTS_REFRESHED, {
      action: 'refresh_completed',
      date: today,
      platform: LLM_MENTIONS_PLATFORM,
      mentions: result.mentions,
      shareOfVoice: result.shareOfVoice,
      updatedAt: new Date().toISOString(),
    });

    updateJob(jobId, {
      status: 'done',
      progress: 1,
      total: 1,
      message: `AI visibility refreshed — ${result.mentions} mentions, ${formatSov(result.shareOfVoice)}`,
      result: summary,
    });
  } finally {
    unregisterAbort(jobId);
  }
}
