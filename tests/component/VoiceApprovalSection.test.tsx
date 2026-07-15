import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceProfile } from '../../shared/types/brand-engine';
import type { GetBrandVoicePageResult } from '../../shared/types/voice-finalization';
import { VoiceApprovalSection } from '../../src/components/brand/voice-tab/VoiceApprovalSection';
import { ToastProvider } from '../../src/components/Toast';

const voiceMocks = vi.hoisted(() => ({
  attestSample: vi.fn(),
  finalize: vi.fn(),
  createFinalizationAuthorization: vi.fn(),
}));

vi.mock('../../src/api/brand-engine', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/api/brand-engine')>();
  return {
    ...actual,
    voice: {
      ...actual.voice,
      attestSample: voiceMocks.attestSample,
      finalize: voiceMocks.finalize,
      createFinalizationAuthorization: voiceMocks.createFinalizationAuthorization,
    },
  };
});

const profile: VoiceProfile & { samples: NonNullable<VoiceProfile['samples']> } = {
  id: 'vp_review',
  workspaceId: 'ws_review',
  revision: 7,
  status: 'calibrating',
  voiceDNA: {
    personalityTraits: ['Warm', 'Clear'],
    toneSpectrum: { formal_casual: 6, serious_playful: 3, technical_accessible: 8 },
    sentenceStyle: 'Short, reassuring sentences.',
    vocabularyLevel: 'Accessible expert language.',
  },
  guardrails: {
    forbiddenWords: ['guaranteed'],
    requiredTerminology: [{ use: 'patients', insteadOf: 'customers' }],
    toneBoundaries: ['Never pressure the reader.'],
    antiPatterns: ['No empty superlatives.'],
  },
  contextModifiers: [{ context: 'CTA', description: 'Inviting and direct.' }],
  samples: [
    {
      id: 'vs_proposed',
      voiceProfileId: 'vp_review',
      content: 'Care that makes the next step feel easy.',
      contextTag: 'headline',
      source: 'mcp_proposed',
      sortOrder: 0,
      createdAt: '2026-07-15T12:00:00.000Z',
    },
    {
      id: 'vs_authentic',
      voiceProfileId: 'vp_review',
      content: 'We explain every option before you decide.',
      contextTag: 'body',
      source: 'manual',
      sortOrder: 1,
      createdAt: '2026-07-15T12:01:00.000Z',
    },
  ],
  createdAt: '2026-07-15T11:00:00.000Z',
  updatedAt: '2026-07-15T12:01:00.000Z',
};

const readiness: GetBrandVoicePageResult = {
  profile: {
    id: profile.id,
    revision: profile.revision,
    status: profile.status,
    voiceDNA: profile.voiceDNA,
    guardrails: profile.guardrails,
    contextModifiers: profile.contextModifiers ?? [],
    updatedAt: profile.updatedAt,
  },
  readiness: {
    state: 'missing',
    blockingReasons: ['Brand voice has not been finalized.'],
  },
  eligibleAnchors: {
    items: [{
      selector: { kind: 'voice_sample', voiceSampleId: 'vs_authentic' },
      content: 'We explain every option before you decide.',
      context: 'body',
      sourceLabel: 'Operator-entered voice sample',
      capturedAt: '2026-07-15T12:01:00.000Z',
    }],
    nextCursor: null,
    hasMore: false,
  },
  latestSnapshot: null,
};

function renderApproval(overrides: Partial<Parameters<typeof VoiceApprovalSection>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onChanged = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <VoiceApprovalSection
          workspaceId="ws_review"
          profile={profile}
          readiness={readiness}
          isReadinessLoading={false}
          readinessError={null}
          onChanged={onChanged}
          onRetryReadiness={vi.fn()}
          {...overrides}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onChanged };
}

describe('VoiceApprovalSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceMocks.attestSample.mockResolvedValue({
      ...profile.samples[0],
      source: 'operator_attested',
    });
    voiceMocks.finalize.mockResolvedValue({ created: true });
    voiceMocks.createFinalizationAuthorization.mockResolvedValue({
      authorization: {
        authorizationId: 'vfa_1',
        expectedProfileRevision: 7,
        expiresAt: '2026-07-15T12:15:00.000Z',
      },
      authorizationToken: 'voice-once-secret-code',
    });
  });

  it('makes the human workflow and both completion paths explicit', () => {
    renderApproval();

    expect(screen.getByText('Approval checklist')).toBeInTheDocument();
    expect(screen.getByText(/Confirm chat proposals, review the exact voice rules/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and lock voice' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create one-time MCP code' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirm as authentic' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Review voice DNA, guardrails, and context rules'));
    expect(screen.getByText('Formal ↔ casual: 6/10')).toBeInTheDocument();
    expect(screen.getByText('Serious ↔ playful: 3/10')).toBeInTheDocument();
    expect(screen.getByText('Technical ↔ accessible: 8/10')).toBeInTheDocument();
  });

  it('requires an explicit confirmation before promoting a chat proposal', async () => {
    const { onChanged } = renderApproval();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm as authentic' }));
    expect(voiceMocks.attestSample).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sample' }));

    await waitFor(() => {
      expect(voiceMocks.attestSample).toHaveBeenCalledWith('ws_review', 'vs_proposed', 7);
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('binds platform approval to the exact reviewed revision and selected anchor', async () => {
    renderApproval();

    fireEvent.click(screen.getByRole('button', { name: 'Approve and lock voice' }));

    await waitFor(() => expect(voiceMocks.finalize).toHaveBeenCalledTimes(1));
    expect(voiceMocks.finalize).toHaveBeenCalledWith('ws_review', expect.objectContaining({
      expectedProfileRevision: 7,
      voiceDNA: profile.voiceDNA,
      guardrails: profile.guardrails,
      contextModifiers: profile.contextModifiers,
      anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: 'vs_authentic' }],
      calibrationSelections: [],
      idempotencyKey: expect.stringContaining('voice-platform-vp_review-7-'),
    }));
  });

  it('reveals the short-lived code only after the operator creates it', async () => {
    renderApproval();
    expect(screen.queryByText('voice-once-secret-code')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create one-time MCP code' }));

    expect(await screen.findByText('voice-once-secret-code')).toBeInTheDocument();
    expect(screen.getByText(/works once, and is bound to this exact reviewed revision/i)).toBeInTheDocument();
    expect(voiceMocks.createFinalizationAuthorization).toHaveBeenCalledWith(
      'ws_review',
      expect.objectContaining({
        expectedProfileRevision: 7,
        idempotencyKey: expect.stringContaining('voice-mcp-vp_review-7-'),
      }),
    );

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Operator-entered voice sample: We explain every option before you decide.',
    }));
    expect(screen.queryByText('voice-once-secret-code')).not.toBeInTheDocument();
  });
});
