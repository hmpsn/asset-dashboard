import { useState } from 'react';
import { Check, Copy, KeyRound, LockKeyhole } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { VoiceProfile, VoiceSample } from '../../../../shared/types/brand-engine';
import type {
  GetBrandVoicePageResult,
  VoiceAnchorSelector,
  VoiceProfileFinalizationInput,
} from '../../../../shared/types/voice-finalization';
import { voice } from '../../../api/brand-engine';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { formatDateTime } from '../../../utils/formatDates';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Disclosure,
  InlineBanner,
  Mono,
  Skeleton,
} from '../../ui';
import { useToast } from '../../Toast';

interface VoiceApprovalSectionProps {
  workspaceId: string;
  profile: VoiceProfile & { samples: VoiceSample[] };
  readiness?: GetBrandVoicePageResult;
  isReadinessLoading: boolean;
  readinessError: unknown;
  onChanged: () => void;
  onRetryReadiness: () => void;
}

function selectorKey(selector: VoiceAnchorSelector): string {
  return selector.kind === 'voice_sample'
    ? `voice:${selector.voiceSampleId}`
    : `intake:${selector.intakeRevisionId}:${selector.intakeRevision}:${selector.sampleId}`;
}

function commandKey(mode: 'platform' | 'mcp', profile: VoiceProfile): string {
  return `voice-${mode}-${profile.id}-${profile.revision}-${Date.now()}`;
}

export function VoiceApprovalSection({
  workspaceId,
  profile,
  readiness,
  isReadinessLoading,
  readinessError,
  onChanged,
  onRetryReadiness,
}: VoiceApprovalSectionProps) {
  const { toast } = useToast();
  const [excludedAnchorKeys, setExcludedAnchorKeys] = useState<Set<string>>(() => new Set());
  const [attestSampleId, setAttestSampleId] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<{
    token: string;
    expiresAt: string;
    profileRevision: number;
  } | null>(null);

  const proposedSamples = profile.samples.filter(sample => sample.source === 'mcp_proposed');
  const eligibleAnchors = readiness?.eligibleAnchors.items ?? [];
  const selectedAnchors = eligibleAnchors.filter(
    anchor => !excludedAnchorKeys.has(selectorKey(anchor.selector)),
  );
  const isFinalized = readiness?.readiness.state === 'finalized';
  const hasRequiredDraft = Boolean(profile.voiceDNA && profile.guardrails);
  const canFinalize = hasRequiredDraft && selectedAnchors.length > 0 && !isFinalized;

  const buildCommand = (mode: 'platform' | 'mcp'): VoiceProfileFinalizationInput | null => {
    if (!profile.voiceDNA || !profile.guardrails || selectedAnchors.length === 0) return null;
    return {
      expectedProfileRevision: profile.revision,
      voiceDNA: profile.voiceDNA,
      guardrails: profile.guardrails,
      contextModifiers: profile.contextModifiers ?? [],
      anchorSelectors: selectedAnchors.map(anchor => anchor.selector) as [
        VoiceAnchorSelector,
        ...VoiceAnchorSelector[],
      ],
      calibrationSelections: [],
      idempotencyKey: commandKey(mode, profile),
    };
  };

  const attestMutation = useMutation({
    mutationFn: (sampleId: string) =>
      voice.attestSample(workspaceId, sampleId, profile.revision),
    onSuccess: () => {
      setAttestSampleId(null);
      setAuthorization(null);
      onChanged();
      toast('Sample confirmed as authentic brand voice');
    },
    onError: (error) => {
      setAttestSampleId(null);
      toast(extractErrorMessage(error, 'Failed to confirm voice sample'), 'error');
      onChanged();
    },
  });

  const attestAllMutation = useMutation({
    mutationFn: (sampleIds: string[]) =>
      voice.attestSamples(workspaceId, sampleIds, profile.revision),
    onSuccess: (result) => {
      setAuthorization(null);
      onChanged();
      toast(`${result.samples.length} voice proposal${result.samples.length === 1 ? '' : 's'} approved`);
    },
    onError: (error) => {
      toast(extractErrorMessage(error, 'Failed to approve voice proposals'), 'error');
      onChanged();
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: (command: VoiceProfileFinalizationInput) => voice.finalize(workspaceId, command),
    onSuccess: () => {
      setAuthorization(null);
      onChanged();
      toast('Brand voice approved and locked');
    },
    onError: (error) => {
      toast(extractErrorMessage(error, 'Failed to approve brand voice'), 'error');
      onChanged();
    },
  });

  const authorizationMutation = useMutation({
    mutationFn: (command: VoiceProfileFinalizationInput) =>
      voice.createFinalizationAuthorization(workspaceId, command),
    onSuccess: (result) => {
      setAuthorization({
        token: result.authorizationToken,
        expiresAt: result.authorization.expiresAt,
        profileRevision: result.authorization.expectedProfileRevision,
      });
      toast('One-time MCP approval code created');
    },
    onError: (error) => {
      toast(extractErrorMessage(error, 'Failed to create MCP approval code'), 'error');
      onChanged();
    },
  });

  const handleFinalize = () => {
    const command = buildCommand('platform');
    if (command) finalizeMutation.mutate(command);
  };

  const handleCreateAuthorization = () => {
    const command = buildCommand('mcp');
    if (command) {
      setAuthorization(null);
      authorizationMutation.mutate(command);
    }
  };

  const visibleAuthorization = authorization?.profileRevision === profile.revision
    ? authorization
    : null;

  if (isReadinessLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (readinessError || !readiness) {
    return (
      <InlineBanner
        tone="error"
        title="Approval status unavailable"
        message={
          <span className="flex flex-wrap items-center gap-3">
            We could not verify whether this voice is ready to lock.
            <Button type="button" variant="secondary" size="sm" onClick={onRetryReadiness}>
              Try again
            </Button>
          </span>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="t-body font-semibold text-[var(--brand-text-bright)]">Approval checklist</p>
        <p className="t-caption text-[var(--brand-text-muted)]">
          Confirm chat proposals, review the exact voice rules below, select authentic examples,
          then lock this revision in the platform or hand a one-time code back to MCP chat.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge
            label={profile.voiceDNA ? 'Voice DNA ready' : 'Voice DNA needed'}
            tone={profile.voiceDNA ? 'emerald' : 'amber'}
          />
          <Badge
            label={profile.guardrails ? 'Guardrails ready' : 'Guardrails needed'}
            tone={profile.guardrails ? 'emerald' : 'amber'}
          />
          <Badge
            label={`${eligibleAnchors.length} authentic ${eligibleAnchors.length === 1 ? 'sample' : 'samples'}`}
            tone={eligibleAnchors.length > 0 ? 'emerald' : 'amber'}
          />
          {proposedSamples.length > 0 && (
            <Badge label={`${proposedSamples.length} chat proposal${proposedSamples.length === 1 ? '' : 's'} to confirm`} tone="amber" />
          )}
        </div>
      </div>

      {proposedSamples.length > 0 && (
        <Disclosure
          summary="Confirm chat-proposed samples"
          badges={[{ label: String(proposedSamples.length), tone: 'amber' }]}
          defaultOpen
        >
          <p className="t-caption text-[var(--brand-text-muted)] mb-3">
            MCP can propose examples, but cannot declare its own writing authentic. Confirm only
            samples that accurately represent the voice you want to authorize.
          </p>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="t-caption text-[var(--brand-text-muted)]">
              This approves exactly the {proposedSamples.length} full proposal{proposedSamples.length === 1 ? '' : 's'} shown below.
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={Check}
              onClick={() => attestAllMutation.mutate(proposedSamples.map(sample => sample.id))}
              disabled={attestMutation.isPending || attestAllMutation.isPending}
              loading={attestAllMutation.isPending}
            >
              Approve all {proposedSamples.length} proposal{proposedSamples.length === 1 ? '' : 's'}
            </Button>
          </div>
          <div className="divide-y divide-[var(--brand-border)] border-y border-[var(--brand-border)]">
            {proposedSamples.map(sample => (
              <div key={sample.id} className="py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge label="Chat proposal" tone="amber" />
                    {sample.contextTag && <Badge label={sample.contextTag} tone="blue" />}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={Check}
                    onClick={() => setAttestSampleId(sample.id)}
                    disabled={attestMutation.isPending || attestAllMutation.isPending}
                  >
                    Confirm as authentic
                  </Button>
                </div>
                <p className="t-body text-[var(--brand-text)] leading-relaxed">{sample.content}</p>
              </div>
            ))}
          </div>
        </Disclosure>
      )}

      <Disclosure
        summary="Select authentic voice anchors"
        badges={[{ label: `${selectedAnchors.length} selected`, tone: selectedAnchors.length ? 'teal' : 'amber' }]}
        defaultOpen
      >
        {eligibleAnchors.length === 0 ? (
          <InlineBanner
            tone="warning"
            title="At least one authentic sample is required"
            message="Add an operator-written or transcript sample, or confirm a chat proposal above."
          />
        ) : (
          <div className="space-y-3">
            {eligibleAnchors.map(anchor => {
              const key = selectorKey(anchor.selector);
              const checked = !excludedAnchorKeys.has(key);
              return (
                <div key={key} className="border-b border-[var(--brand-border)] pb-3 last:border-0 last:pb-0">
                  <Checkbox
                    checked={checked}
                    onChange={(nextChecked) => {
                      setAuthorization(null);
                      setExcludedAnchorKeys(current => {
                        const next = new Set(current);
                        if (nextChecked) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    label={`${anchor.sourceLabel}: ${anchor.content}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Disclosure>

      <Disclosure summary="Review voice DNA, guardrails, and context rules">
        <div className="space-y-5">
          <div>
            <p className="t-ui font-semibold text-[var(--brand-text-bright)] mb-2">Voice DNA</p>
            {profile.voiceDNA ? (
              <ul className="space-y-1 t-caption text-[var(--brand-text)]">
                <li>Traits: {profile.voiceDNA.personalityTraits.join(', ') || 'None set'}</li>
                <li>Formal ↔ casual: {profile.voiceDNA.toneSpectrum.formal_casual}/10</li>
                <li>Serious ↔ playful: {profile.voiceDNA.toneSpectrum.serious_playful}/10</li>
                <li>Technical ↔ accessible: {profile.voiceDNA.toneSpectrum.technical_accessible}/10</li>
                <li>Sentence style: {profile.voiceDNA.sentenceStyle || 'Not set'}</li>
                <li>Vocabulary: {profile.voiceDNA.vocabularyLevel || 'Not set'}</li>
                <li>Humor: {profile.voiceDNA.humorStyle || 'Not set'}</li>
              </ul>
            ) : <p className="t-caption text-accent-warning">Voice DNA is not set.</p>}
          </div>
          <div>
            <p className="t-ui font-semibold text-[var(--brand-text-bright)] mb-2">Guardrails</p>
            {profile.guardrails ? (
              <ul className="space-y-1 t-caption text-[var(--brand-text)]">
                <li>Forbidden words: {profile.guardrails.forbiddenWords.join(', ') || 'None set'}</li>
                <li>Tone boundaries: {profile.guardrails.toneBoundaries.join('; ') || 'None set'}</li>
                <li>Anti-patterns: {profile.guardrails.antiPatterns.join('; ') || 'None set'}</li>
                <li>Required terms: {profile.guardrails.requiredTerminology.map(term => `${term.use} instead of ${term.insteadOf}`).join('; ') || 'None set'}</li>
              </ul>
            ) : <p className="t-caption text-accent-warning">Guardrails are not set.</p>}
          </div>
          <div>
            <p className="t-ui font-semibold text-[var(--brand-text-bright)] mb-2">Context rules</p>
            <ul className="space-y-1 t-caption text-[var(--brand-text)]">
              {(profile.contextModifiers ?? []).map(modifier => (
                <li key={`${modifier.context}:${modifier.description}`}>
                  <strong>{modifier.context || 'General'}:</strong> {modifier.description || 'No rule set'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Disclosure>

      <div className="border-t border-[var(--brand-border)] pt-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            icon={LockKeyhole}
            onClick={handleFinalize}
            disabled={!canFinalize || finalizeMutation.isPending || authorizationMutation.isPending}
            loading={finalizeMutation.isPending}
          >
            Approve and lock voice
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={KeyRound}
            onClick={handleCreateAuthorization}
            disabled={!canFinalize || finalizeMutation.isPending || authorizationMutation.isPending}
            loading={authorizationMutation.isPending}
          >
            Create one-time MCP code
          </Button>
        </div>
        <p className="t-caption text-[var(--brand-text-muted)]">
          Platform approval locks the voice immediately. The MCP code is an alternative: it expires
          in 15 minutes, works once, and is bound to this exact reviewed revision.
        </p>
      </div>

      {visibleAuthorization && (
        <InlineBanner tone="info" title="One-time MCP approval code">
          <div className="space-y-3">
            <p>
              Paste this code into MCP chat and ask it to finalize brand voice. It expires{' '}
              {formatDateTime(visibleAuthorization.expiresAt)} and cannot authorize a changed revision.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Mono className="break-all text-[var(--brand-text-bright)]">{visibleAuthorization.token}</Mono>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Copy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(visibleAuthorization.token);
                    toast('MCP approval code copied');
                  } catch {
                    toast('Could not copy the code automatically', 'error');
                  }
                }}
              >
                Copy code
              </Button>
            </div>
          </div>
        </InlineBanner>
      )}

      <ConfirmDialog
        open={Boolean(attestSampleId)}
        title="Confirm authentic brand voice"
        message="Confirm that this chat-proposed sample accurately represents the voice you want to authorize. It will become eligible as a finalization anchor."
        confirmLabel="Confirm sample"
        onConfirm={() => {
          if (attestSampleId) attestMutation.mutate(attestSampleId);
        }}
        onCancel={() => setAttestSampleId(null)}
      />
    </div>
  );
}
