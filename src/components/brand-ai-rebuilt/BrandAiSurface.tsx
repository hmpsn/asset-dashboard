// @ds-rebuilt
import { lazy, Suspense, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaces } from '../../api';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { queryKeys } from '../../lib/queryKeys';
import { awaitSuccessfulRefetches } from '../../lib/reactQueryRefresh';
import { formatDate } from '../../utils/formatDates';
import { markdownToPlainTextPreview } from '../../utils/markdownPreview';
import type { AudiencePersona, TargetGeo } from '../../../shared/types/workspace';
import type { ReleasedBrandDeliverableType } from '../../../shared/types/brand-engine';
import { useToast } from '../Toast';
import { ErrorBoundary } from '../ErrorBoundary';
import { BrandHub } from '../BrandHub';
import { BrandscriptTab } from '../brand/BrandscriptTab';
import { DiscoveryTab } from '../brand/DiscoveryTab';
import { IdentityTab } from '../brand/IdentityTab';
import { BusinessFootprintTab } from '../settings/BusinessFootprintTab';
import { EeatAssetsTab } from '../settings/EeatAssetsTab';
import { IntelligenceProfileTab } from '../settings/IntelligenceProfileTab';
import { RebuiltTopbarActions } from '../layout/RebuiltAppChrome';
import {
  Badge,
  type BadgeTone,
  Button,
  ClickableRow,
  ErrorState,
  Icon,
  type IconName,
  InlineBanner,
  Modal,
  Meter,
  PageHeader,
  scoreColor,
  SectionCard,
  Skeleton,
} from '../ui';
import { mutationErrorMessage } from './brandAiMutationFeedback';
import {
  type BrandAiTab,
  useBrandAiSurfaceState,
} from './useBrandAiSurfaceState';

const VoiceTab = lazy(async () => {
  const module = await import('../brand/VoiceTab');
  return { default: module.VoiceTab };
});

interface BrandAiSurfaceProps {
  workspaceId: string;
}

interface WorkspaceData {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  webflowSiteId?: string;
  liveDomain?: string;
  brandLogoUrl?: string;
  siteHasSearch?: boolean;
  knowledgeBase?: string;
  brandVoice?: string;
  personas?: AudiencePersona[];
  targetGeo?: TargetGeo | null;
  businessProfile?: {
    email?: string;
    phone?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
    socialProfiles?: string[];
    openingHours?: string;
    foundedDate?: string;
    numberOfEmployees?: string;
  } | null;
  keywordStrategy?: {
    businessContext?: string;
  } | null;
  intelligenceProfile?: {
    industry?: string;
    goals?: string[];
    targetAudience?: string;
  } | null;
}

type WorkflowTab = Exclude<BrandAiTab, 'overview'>;
type LegacyBusinessFootprintSection = 'business-profile' | 'locations' | null;
type ContextStatus = 'set' | 'part' | 'empty';
type ContextGroupId = 'voice' | 'knowledge' | 'audience' | 'facts';

interface ContextItem {
  id: string;
  name: string;
  source: string;
  snippet: string;
  status: ContextStatus;
  tab: BrandAiTab;
  focus?: string;
  actionLabel: string;
}

interface IdentityGenerator {
  deliverableType: ReleasedBrandDeliverableType;
  name: string;
  tier: 'ess' | 'pro' | 'prem';
}

interface BrandContextGroup {
  id: ContextGroupId;
  label: string;
  question: string;
  feeds: string;
  configured: number;
  total: number;
  accent: string;
  icon: IconName;
  items?: ContextItem[];
  personas?: AudiencePersona[];
}

const IDENTITY_GENERATORS_BY_GROUP = {
  voice: [
    { deliverableType: 'tagline', name: 'Tagline', tier: 'ess' },
    { deliverableType: 'voice_guidelines', name: 'Voice Guidelines', tier: 'ess' },
    { deliverableType: 'archetypes', name: 'Brand Archetypes', tier: 'pro' },
    { deliverableType: 'personality_traits', name: 'Personality Traits', tier: 'pro' },
    { deliverableType: 'messaging_pillars', name: 'Messaging Pillars', tier: 'pro' },
    { deliverableType: 'differentiators', name: 'Differentiators', tier: 'pro' },
    { deliverableType: 'tone_examples', name: 'Tone Examples', tier: 'pro' },
  ],
  knowledge: [
    { deliverableType: 'elevator_pitch', name: 'Elevator Pitch', tier: 'pro' },
    { deliverableType: 'brand_story', name: 'Brand Story', tier: 'prem' },
  ],
  audience: [
    { deliverableType: 'positioning_matrix', name: 'Positioning Matrix', tier: 'prem' },
    { deliverableType: 'personas', name: 'Customer Personas', tier: 'prem' },
    { deliverableType: 'customer_journey', name: 'Customer Journey', tier: 'prem' },
    { deliverableType: 'objection_handling', name: 'Objection Handling', tier: 'prem' },
    { deliverableType: 'emotional_triggers', name: 'Emotional Triggers', tier: 'prem' },
  ],
  facts: [
    { deliverableType: 'mission', name: 'Mission Statement', tier: 'ess' },
    { deliverableType: 'vision', name: 'Vision Statement', tier: 'ess' },
    { deliverableType: 'values', name: 'Core Values', tier: 'ess' },
  ],
} as const satisfies Record<ContextGroupId, readonly IdentityGenerator[]>;

const IDENTITY_GENERATOR_TYPES = new Set<ReleasedBrandDeliverableType>(
  Object.values(IDENTITY_GENERATORS_BY_GROUP).flat().map((generator) => generator.deliverableType),
);
const BRANDSCRIPT_OVERVIEW_FOCUS = 'existing-brandscript';

const GROUP_BORDER_CLASS: Record<ContextGroupId, string> = {
  voice: 'border-l-[3px] border-l-[var(--teal)]',
  knowledge: 'border-l-[3px] border-l-[var(--blue)]',
  audience: 'border-l-[3px] border-l-[var(--purple)]',
  facts: 'border-l-[3px] border-l-[var(--amber)]',
};

interface BrandContextSummary {
  configured: number;
  total: number;
  groups: BrandContextGroup[];
}

const TAB_ACCENTS: Record<BrandAiTab, string> = {
  overview: 'var(--blue)',
  context: 'var(--teal)',
  brandscript: 'var(--teal)',
  discovery: 'var(--blue)',
  voice: 'var(--teal)',
  identity: 'var(--emerald)',
  'business-footprint': 'var(--blue)',
  'eeat-assets': 'var(--amber)',
  'intelligence-profile': 'var(--teal)',
};

const TAB_ICON: Record<BrandAiTab, 'sparkle' | 'message' | 'doc' | 'download' | 'key' | 'trophy' | 'home' | 'clipboard' | 'chart'> = {
  overview: 'sparkle',
  context: 'message',
  brandscript: 'doc',
  discovery: 'download',
  voice: 'key',
  identity: 'trophy',
  'business-footprint': 'home',
  'eeat-assets': 'clipboard',
  'intelligence-profile': 'chart',
};

const WORKFLOW_MODAL_COPY: Record<WorkflowTab, { title: string; subtitle: string }> = {
  context: {
    title: 'Context editors',
    subtitle: 'Maintain voice, knowledge, personas, and page-level guidance.',
  },
  brandscript: {
    title: 'Brandscript',
    subtitle: 'StoryBrand framework and section editing stay available here.',
  },
  discovery: {
    title: 'Discovery intake',
    subtitle: 'Upload or paste source material, then review extracted facts.',
  },
  voice: {
    title: 'Voice calibration',
    subtitle: 'Shape voice DNA, samples, guardrails, and calibration sessions.',
  },
  identity: {
    title: 'Brand identity',
    subtitle: 'Generate, refine, approve, edit, and export brand deliverables.',
  },
  'business-footprint': {
    title: 'Business facts',
    subtitle: 'Manage schema authority, locations, and local-market inputs.',
  },
  'eeat-assets': {
    title: 'Trust evidence',
    subtitle: 'Maintain proof points, credentials, awards, and expert signals.',
  },
  'intelligence-profile': {
    title: 'Strategy intelligence',
    subtitle: 'Set the industry, goals, audience, and strategic context.',
  },
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function isIdentityGeneratorFocus(value: string | null | undefined): value is ReleasedBrandDeliverableType {
  return typeof value === 'string' && IDENTITY_GENERATOR_TYPES.has(value as ReleasedBrandDeliverableType);
}

function countComplete(values: boolean[]): number {
  return values.filter(Boolean).length;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function statusFromCount(configured: number, total: number): ContextStatus {
  if (configured >= total) return 'set';
  if (configured > 0) return 'part';
  return 'empty';
}

function percentage(configured: number, total: number): number {
  return total > 0 ? Math.round((configured / total) * 100) : 0;
}

function buildBrandContextSummary(ws: WorkspaceData | undefined): BrandContextSummary {
  const businessProfile = ws?.businessProfile;
  const intelligenceProfile = ws?.intelligenceProfile;
  const voiceConfigured = countComplete([hasText(ws?.brandVoice)]);
  const knowledgeProfileConfigured = countComplete([
    hasText(intelligenceProfile?.industry),
    (intelligenceProfile?.goals?.length ?? 0) > 0,
    hasText(intelligenceProfile?.targetAudience),
  ]);
  const knowledgeConfigured = countComplete([
    hasText(ws?.knowledgeBase),
    hasText(ws?.keywordStrategy?.businessContext),
    knowledgeProfileConfigured >= 2,
  ]);
  const audienceConfigured = countComplete([(ws?.personas?.length ?? 0) > 0]);
  const businessProfileConfigured = countComplete([
    hasText(businessProfile?.email),
    hasText(businessProfile?.phone),
    hasText(businessProfile?.address?.city) || hasText(businessProfile?.address?.street),
    hasText(ws?.liveDomain),
  ]);
  const trustConfigured = countComplete([
    (businessProfile?.socialProfiles?.length ?? 0) > 0,
    hasText(businessProfile?.foundedDate) || hasText(businessProfile?.numberOfEmployees) || hasText(businessProfile?.openingHours),
    hasText(ws?.keywordStrategy?.businessContext),
  ]);
  const factsConfigured = countComplete([
    businessProfileConfigured >= 3,
    hasText(ws?.targetGeo?.label) || hasText(ws?.targetGeo?.countryCode),
    trustConfigured > 0,
    hasText(ws?.brandLogoUrl),
  ]);

  const groups: BrandContextGroup[] = [
    {
      id: 'voice',
      label: 'Voice & Messaging',
      question: 'how we sound',
      feeds: 'Feeds every rewrite, brief, and generated post.',
      configured: voiceConfigured,
      total: 3,
      accent: 'var(--teal)',
      icon: 'message',
      items: [
        {
          id: 'brand-voice',
          name: 'Brand voice & style',
          source: 'brand voice',
          snippet: hasText(ws?.brandVoice)
            ? markdownToPlainTextPreview(ws?.brandVoice)
            : 'No reviewed voice guidance yet. Generate from the site or add the house style before asking AI to write.',
          status: hasText(ws?.brandVoice) ? 'set' : 'empty',
          tab: 'context',
          actionLabel: hasText(ws?.brandVoice) ? 'Edit' : 'Generate',
        },
        {
          id: 'voice-calibration',
          name: 'Voice calibration',
          source: 'voice',
          snippet: hasText(ws?.brandVoice)
            ? 'Voice guidance exists. Review samples, guardrails, and calibration authority before high-stakes writing.'
            : 'No calibration samples yet. AI copy will lean on default brand context until this is reviewed.',
          status: hasText(ws?.brandVoice) ? 'part' : 'empty',
          tab: 'voice',
          actionLabel: hasText(ws?.brandVoice) ? 'Review' : 'Build',
        },
        {
          id: 'brandscript',
          name: 'Brandscript',
          source: 'brandscript',
          snippet: 'StoryBrand framework, section editing, imports, and AI-assisted fill live here.',
          status: hasText(ws?.brandVoice) ? 'part' : 'empty',
          tab: 'brandscript',
          focus: BRANDSCRIPT_OVERVIEW_FOCUS,
          actionLabel: 'Open',
        },
      ],
    },
    {
      id: 'knowledge',
      label: 'Knowledge',
      question: 'what we know',
      feeds: 'Feeds briefs, posts, and both Insights chatbots.',
      configured: knowledgeConfigured,
      total: 3,
      accent: 'var(--blue)',
      icon: 'clipboard',
      items: [
        {
          id: 'knowledge-base',
          name: 'Knowledge base',
          source: 'knowledge base',
          snippet: hasText(ws?.knowledgeBase)
            ? markdownToPlainTextPreview(ws?.knowledgeBase)
            : 'No source knowledge is saved yet. Add services, process, proof, FAQs, and offer details.',
          status: hasText(ws?.knowledgeBase) ? 'set' : 'empty',
          tab: 'context',
          actionLabel: hasText(ws?.knowledgeBase) ? 'Edit' : 'Generate',
        },
        {
          id: 'discovery',
          name: 'Discovery',
          source: 'discovery',
          snippet: hasText(ws?.keywordStrategy?.businessContext)
            ? 'Business context exists. Use discovery to review source material and refresh extracted facts.'
            : 'No extracted source narrative yet. Ingest site copy, documents, or notes to create the first draft.',
          status: hasText(ws?.keywordStrategy?.businessContext) ? 'set' : 'empty',
          tab: 'discovery',
          actionLabel: hasText(ws?.keywordStrategy?.businessContext) ? 'Open' : 'Start',
        },
        {
          id: 'industry-goals',
          name: 'Industry & goals',
          source: 'intelligence profile',
          snippet: intelligenceProfile?.industry
            ? `${intelligenceProfile.industry}${intelligenceProfile.goals?.length ? ` · ${formatCount(intelligenceProfile.goals.length, 'goal')}` : ''}${hasText(intelligenceProfile.targetAudience) ? ' · audience set' : ' · audience missing'}`
            : 'Set industry, goals, and audience so strategy work starts with the right frame.',
          status: statusFromCount(knowledgeProfileConfigured, 3),
          tab: 'intelligence-profile',
          actionLabel: knowledgeProfileConfigured > 0 ? 'Review' : 'Set up',
        },
      ],
    },
    {
      id: 'audience',
      label: 'Audience',
      question: 'who we serve',
      feeds: 'Feeds content briefs and AI writing prompts.',
      configured: audienceConfigured,
      total: 1,
      accent: 'var(--purple)',
      icon: 'user',
      personas: ws?.personas ?? [],
    },
    {
      id: 'facts',
      label: 'Business Facts & Trust',
      question: 'the verifiable record',
      feeds: 'Powers schema, Local Presence, and E-E-A-T.',
      configured: factsConfigured,
      total: 4,
      accent: 'var(--amber)',
      icon: 'pin',
      items: [
        {
          id: 'business-footprint',
          name: 'Business footprint',
          source: 'business profile',
          snippet: `${businessProfileConfigured}/4 core facts set${ws?.liveDomain ? ` · ${ws.liveDomain}` : ''}`,
          status: statusFromCount(businessProfileConfigured, 4),
          tab: 'business-footprint',
          actionLabel: businessProfileConfigured >= 3 ? 'Manage' : 'Complete',
        },
        {
          id: 'locations',
          name: 'Locations & service areas',
          source: 'locations',
          snippet: hasText(ws?.targetGeo?.label) || hasText(ws?.targetGeo?.countryCode)
            ? 'Primary market is set. Review locations and service-area coverage before local generation.'
            : 'No primary market or service area is confirmed yet.',
          status: hasText(ws?.targetGeo?.label) || hasText(ws?.targetGeo?.countryCode) ? 'part' : 'empty',
          tab: 'business-footprint',
          actionLabel: 'Review',
        },
        {
          id: 'eeat-assets',
          name: 'E-E-A-T assets',
          source: 'trust evidence',
          snippet: trustConfigured > 0
            ? `${trustConfigured}/3 trust inputs detected. Keep credentials, proof, awards, and testimonials current.`
            : 'No credentials, awards, expert proof, or trust assets are documented yet.',
          status: statusFromCount(trustConfigured, 3),
          tab: 'eeat-assets',
          actionLabel: trustConfigured > 0 ? 'Open' : 'Add proof',
        },
        {
          id: 'identity-awards',
          name: 'Identity & awards',
          source: 'identity',
          snippet: hasText(ws?.brandLogoUrl)
            ? 'Brand identity assets are partly represented. Review deliverables, awards, and approved statements.'
            : 'Logo and identity proof are not complete. Generate or approve identity deliverables before export.',
          status: hasText(ws?.brandLogoUrl) ? 'part' : 'empty',
          tab: 'identity',
          actionLabel: hasText(ws?.brandLogoUrl) ? 'Review' : 'Generate',
        },
      ],
    },
  ];
  const configured = groups.reduce((sum, group) => sum + group.configured, 0);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  return { configured, total, groups };
}

function TabIcon({ tab }: { tab: BrandAiTab }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)]"
      style={{ color: TAB_ACCENTS[tab] }}
      aria-hidden="true"
    >
      <Icon name={TAB_ICON[tab]} size="sm" />
    </span>
  );
}

function BrandAiLoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading Brand AI surface">
      <Skeleton className="h-[44px] w-full" />
      <Skeleton className="h-[320px] w-full" />
      <Skeleton className="h-[260px] w-full" />
    </div>
  );
}

function statusLabel(status: ContextStatus): string {
  if (status === 'set') return 'Ready';
  if (status === 'part') return 'Partial';
  return 'Needs setup';
}

function statusTone(status: ContextStatus): BadgeTone {
  if (status === 'set') return 'emerald';
  if (status === 'part') return 'amber';
  return 'red';
}

function ContextStatusIcon({ status }: { status: ContextStatus }) {
  const icon = status === 'set' ? 'check' : status === 'part' ? 'minus' : 'plus';
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)]"
      style={{ color: status === 'set' ? 'var(--emerald)' : status === 'part' ? 'var(--amber)' : 'var(--brand-text-dim)' }}
      aria-hidden="true"
    >
      <Icon name={icon} size="xs" />
    </span>
  );
}

function contextGroupStatus(percent: number): ContextStatus {
  if (percent >= 80) return 'set';
  if (percent >= 40) return 'part';
  return 'empty';
}

function contextGroupMeterColor(percent: number): string {
  const canonicalScoreBand = percent >= 80 ? 80 : percent >= 40 ? 60 : 0;
  return scoreColor(canonicalScoreBand);
}

function GroupIcon({ group }: { group: BrandContextGroup }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
      style={{
        color: group.accent,
        backgroundColor: `color-mix(in srgb, ${group.accent} 12%, transparent)`,
      }}
      aria-hidden="true"
    >
      <Icon name={group.icon} size="sm" />
    </span>
  );
}

function BrandContextCockpit({
  summary,
  activeTab,
  onOpenTab,
}: {
  summary: BrandContextSummary;
  activeTab: BrandAiTab;
  onOpenTab: (tab: BrandAiTab, focus?: string | null) => void;
}) {
  return (
    <SectionCard
      variant="subtle"
      noPadding
    >
      <div data-testid="brand-context-cockpit-content" className="flex flex-col gap-5 px-4 py-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div data-testid="brand-ai-configured-count" className="flex items-baseline gap-1">
              <span className="t-h1 tabular-nums text-[var(--brand-text-bright)]">{summary.configured}</span>
              <span className="t-body font-semibold tabular-nums text-[var(--brand-text-muted)]">/{summary.total}</span>
            </div>
            <span className="t-caption-sm font-medium text-[var(--brand-text-muted)]">inputs configured</span>
          </div>
          <div className="flex min-w-0 sm:ml-auto sm:items-end">
            <span className="flex min-w-0 items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
              <Icon name="info" size="sm" className="shrink-0 text-[var(--purple)]" aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-semibold text-[var(--brand-text-bright)]">Overview</span> · what the AI knows about this client
              </span>
            </span>
          </div>
        </div>
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {summary.groups.map((group) => {
            const groupPercent = percentage(group.configured, group.total);
            const groupStatus = contextGroupStatus(groupPercent);
            const primaryTab = group.id === 'knowledge'
              ? 'discovery'
              : group.id === 'audience'
                ? 'context'
                : group.id === 'facts'
                  ? 'business-footprint'
                  : 'voice';
            return (
              <ClickableRow
                key={group.id}
                active={activeTab === primaryTab}
                onClick={() => onOpenTab(primaryTab)}
                className="h-full rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-3 hover:border-[var(--brand-border-hover)]"
              >
                <span className="flex h-full flex-col gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name={group.icon} size="xs" style={{ color: group.accent }} aria-hidden="true" />
                    <span className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{group.label}</span>
                  </span>
                  <span className="mt-auto flex flex-col gap-1.5">
                    <Meter value={groupPercent} max={100} color={contextGroupMeterColor(groupPercent)} height={5} ariaLabel={`${group.label} completeness`} />
                    <span className="flex items-center justify-between gap-2">
                      <span className="t-ui font-semibold tabular-nums text-[var(--brand-text-bright)]">{groupPercent}%</span>
                      <Badge label={statusLabel(groupStatus)} tone={statusTone(groupStatus)} variant="soft" size="sm" />
                    </span>
                  </span>
                </span>
              </ClickableRow>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}

function BrandContextItemRow({
  item,
  active,
  onOpenTab,
}: {
  item: ContextItem;
  active: boolean;
  onOpenTab: (tab: BrandAiTab, focus?: string | null) => void;
}) {
  return (
    <ClickableRow
      active={active}
      onClick={() => onOpenTab(item.tab, item.focus)}
      className="border-b border-[var(--brand-border)] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-1)]"
    >
      <span className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex min-w-0 flex-1 items-start gap-3">
          <ContextStatusIcon status={item.status} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{item.name}</span>
              <Badge label={item.source} tone="zinc" variant="soft" size="sm" />
            </span>
            <span className="mt-1 line-clamp-2 t-caption-sm leading-snug text-[var(--brand-text-muted)]">{item.snippet}</span>
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)] px-2.5 py-1 t-label font-semibold normal-case tracking-normal text-[var(--brand-text-bright)] sm:ml-auto">
          {item.status === 'empty' && <Icon name="sparkle" size="xs" aria-hidden="true" />}
          {item.actionLabel}
          <Icon name="arrowRight" size="xs" aria-hidden="true" />
        </span>
      </span>
    </ClickableRow>
  );
}

function AudienceGroupBody({
  group,
  activeTab,
  onOpenTab,
}: {
  group: BrandContextGroup;
  activeTab: BrandAiTab;
  onOpenTab: (tab: BrandAiTab, focus?: string | null) => void;
}) {
  const personas = group.personas ?? [];
  if (personas.length === 0) {
    return (
      <div className="p-4">
        <ClickableRow
          active={activeTab === 'context'}
          onClick={() => onOpenTab('context')}
          className="rounded-[var(--radius-lg)] border border-dashed border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-5 text-center hover:border-[var(--brand-border-hover)]"
        >
          <span className="flex flex-col items-center gap-2">
            <Icon name="user" size="md" className="text-[var(--brand-text-dim)]" aria-hidden="true" />
            <span className="t-ui font-semibold text-[var(--brand-text-bright)]">No personas defined</span>
            <span className="max-w-md t-caption-sm leading-relaxed text-[var(--brand-text-muted)]">
              AI writes to a generic audience until personas are reviewed.
            </span>
            <span className="mt-1 inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--surface-3)] px-3 py-1 t-ui font-semibold text-[var(--teal)]">
              <Icon name="sparkle" size="xs" aria-hidden="true" />
              Generate personas from site
            </span>
          </span>
        </ClickableRow>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-4 md:grid-cols-2">
      {personas.map((persona) => (
        <ClickableRow
          key={persona.id}
          active={activeTab === 'context'}
          onClick={() => onOpenTab('context')}
          className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-3 hover:border-[var(--brand-border-hover)]"
        >
          <span className="flex items-start gap-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] t-caption font-bold text-[var(--teal)]">
              {persona.name?.charAt(0) || 'P'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{persona.name}</span>
                {persona.buyingStage && <Badge label={persona.buyingStage} tone="blue" variant="soft" size="sm" />}
              </span>
              <span className="mt-1 line-clamp-2 t-caption-sm leading-snug text-[var(--brand-text-muted)]">{persona.description || 'Persona details ready for AI writing prompts.'}</span>
            </span>
          </span>
        </ClickableRow>
      ))}
      <ClickableRow
        active={false}
        onClick={() => onOpenTab('context')}
        className="rounded-[var(--radius-lg)] border border-dashed border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-3 hover:border-[var(--brand-border-hover)]"
      >
        <span className="flex h-full min-h-[72px] items-center justify-center gap-2 t-ui font-semibold text-[var(--brand-text-muted)]">
          <Icon name="plus" size="sm" aria-hidden="true" />
          Add persona
        </span>
      </ClickableRow>
    </div>
  );
}

function BrandIdentityGeneratorDisclosure({
  group,
  onOpenGenerator,
}: {
  group: BrandContextGroup;
  onOpenGenerator: (deliverableType: ReleasedBrandDeliverableType) => void;
}) {
  const generators = IDENTITY_GENERATORS_BY_GROUP[group.id];
  return (
    <details className="border-t border-[var(--brand-border)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 t-ui font-semibold text-[var(--brand-text-muted)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--brand-text-bright)]">
        <span className="inline-flex" style={{ color: group.accent }} aria-hidden="true">
          <Icon name="sparkle" size="sm" />
        </span>
        <span>Brand identity generators</span>
        <Badge label={`${generators.length} generators`} tone="zinc" variant="soft" size="sm" />
        <span className="ml-auto inline-flex text-[var(--brand-text-muted)]" aria-hidden="true">
          <Icon name="chevronDown" size="sm" />
        </span>
      </summary>
      <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
        {generators.map((generator) => (
          <ClickableRow
            key={generator.deliverableType}
            data-brand-generator={generator.deliverableType}
            onClick={() => onOpenGenerator(generator.deliverableType)}
            className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2 hover:border-[var(--brand-border-hover)]"
          >
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-[var(--brand-text-dim)]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate t-ui font-semibold text-[var(--brand-text-bright)]">
                {generator.name}
              </span>
              <span className="t-micro uppercase text-[var(--brand-text-muted)]">{generator.tier}</span>
              <Icon name="sparkle" size="xs" style={{ color: group.accent }} aria-hidden="true" />
            </span>
          </ClickableRow>
        ))}
      </div>
    </details>
  );
}

function BrandContextGroupSection({
  group,
  activeTab,
  onOpenTab,
  onOpenGenerator,
}: {
  group: BrandContextGroup;
  activeTab: BrandAiTab;
  onOpenTab: (tab: BrandAiTab, focus?: string | null) => void;
  onOpenGenerator: (deliverableType: ReleasedBrandDeliverableType) => void;
}) {
  const groupPercent = percentage(group.configured, group.total);
  return (
    <SectionCard
      id={`brand-context-${group.id}`}
      title={group.label}
      titleExtra={<span className="t-micro font-medium normal-case tracking-normal text-[var(--brand-text-dim)]">{group.question}</span>}
      subtitle={<span className="t-label normal-case tracking-normal text-[var(--brand-text-muted)]">{group.feeds}</span>}
      titleIcon={<GroupIcon group={group} />}
      action={(
        <div className="hidden min-w-[88px] flex-col gap-1 sm:flex">
          {/* stat-primitive-ok: compact prototype group-completeness readout paired with its Meter, not a labeled metric-card grid */}
          <span className="text-right t-stat-sm font-extrabold tabular-nums text-[var(--brand-text-bright)]">
            {groupPercent}<span className="t-label text-[var(--brand-text-muted)]">%</span>
          </span>
          <Meter value={groupPercent} max={100} color={group.accent} height={5} ariaLabel={`${group.label} completeness`} />
        </div>
      )}
      variant="subtle"
      noPadding
      className={GROUP_BORDER_CLASS[group.id]}
    >
      {group.id === 'audience' ? (
        <AudienceGroupBody group={group} activeTab={activeTab} onOpenTab={onOpenTab} />
      ) : (
        <div>
          {group.items?.map((item) => (
            <BrandContextItemRow
              key={item.id}
              item={item}
              active={activeTab === item.tab}
              onOpenTab={onOpenTab}
            />
          ))}
        </div>
      )}
      <BrandIdentityGeneratorDisclosure group={group} onOpenGenerator={onOpenGenerator} />
    </SectionCard>
  );
}

function BrandContextRail({ workspaceName, onOpenTab }: { workspaceName: string; onOpenTab: (tab: BrandAiTab, focus?: string | null) => void }) {
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
      <SectionCard
        title="How this context is used"
        titleIcon={<Icon name="zap" size="sm" className="text-[var(--purple)]" />}
        variant="subtle"
        className="[&>div:first-child>div>span:last-child]:![font-family:var(--font-sans)] [&>div:first-child>div>span:last-child]:![font-size:var(--type-ui-size)] [&>div:first-child>div>span:last-child]:![line-height:var(--type-ui-line)] [&>div:first-child>div>span:last-child]:!font-bold"
      >
        <div className="flex flex-col">
          {[
            ['clipboard', 'Content briefs & posts', 'pull voice, knowledge, and the matching persona.'],
            ['pencil', 'SEO rewrites', 'stay on-brand by reading Voice & Messaging.'],
            ['message', 'Insights chatbots', 'answer from the Knowledge base.'],
            ['pin', 'Schema & Local Presence', 'are built from Business Facts & Trust.'],
          ].map(([icon, title, copy]) => (
            <div key={title} className="flex items-start gap-2.5 border-b border-[var(--brand-border)] py-2.5 first:pt-0 last:border-b-0 last:pb-0">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">
                <Icon name={icon as IconName} size="xs" aria-hidden="true" />
              </span>
              <p className="t-caption-sm leading-snug text-[var(--brand-text-muted)]">
                <span className="font-semibold text-[var(--brand-text-bright)]">{title}</span> {copy}
              </p>
            </div>
          ))}
        </div>
        <ClickableRow
          onClick={() => onOpenTab('discovery')}
          aria-label="Generate from website"
          className="-mx-4 -mb-4 mt-3 w-[calc(100%+2rem)] border-t border-[var(--brand-border)] px-4 py-3"
          style={{ backgroundColor: 'color-mix(in srgb, var(--purple) 5%, transparent)' }}
        >
          <span className="flex items-start gap-2.5">
            <Icon name="sparkle" size="xs" className="mt-0.5 shrink-0 text-[var(--purple)]" aria-hidden="true" />
            <span className="t-caption-sm leading-snug text-[var(--brand-text-muted)]">
              <span className="font-semibold text-[var(--brand-text-bright)]">Generate from website</span> opens Discovery for {workspaceName} — review sources before they become reusable context.
            </span>
          </span>
        </ClickableRow>
      </SectionCard>

      <SectionCard
        title="Also on this client"
        titleIcon={<Icon name="layers" size="sm" className="text-[var(--purple)]" />}
        variant="subtle"
        className="[&>div:first-child>div>span:last-child]:![font-family:var(--font-sans)] [&>div:first-child>div>span:last-child]:![font-size:var(--type-ui-size)] [&>div:first-child>div>span:last-child]:![line-height:var(--type-ui-line)] [&>div:first-child>div>span:last-child]:!font-bold"
      >
        <p className="t-caption-sm leading-snug text-[var(--brand-text-muted)]">
          AI visibility lives with Search & Site Health. Page strategy and content planning stay with the strategy and content pipeline surfaces.
        </p>
      </SectionCard>
    </aside>
  );
}

function BrandContextOverview({
  ws,
  activeTab,
  onOpenTab,
  onOpenGenerator,
}: {
  ws: WorkspaceData | undefined;
  activeTab: BrandAiTab;
  onOpenTab: (tab: BrandAiTab, focus?: string | null) => void;
  onOpenGenerator: (deliverableType: ReleasedBrandDeliverableType) => void;
}) {
  const summary = buildBrandContextSummary(ws);
  const workspaceName = ws?.name || 'this client';
  const firstName = workspaceName.split(' ')[0] || 'this client';

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="brand-context-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="brand-context-title" className="sr-only">Brand & AI</h1>
          <span className="inline-flex h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--purple)]" aria-hidden="true" />
          <span data-testid="brand-ai-opening-eyebrow" className="eyebrow font-semibold text-[var(--purple)]">
            Brand & AI · {workspaceName}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
            <Icon name="sparkle" size="xs" className="text-[var(--purple)]" aria-hidden="true" />
            Read by every AI action
          </span>
        </div>
        <p className="max-w-2xl t-caption-sm leading-relaxed text-[var(--brand-text-muted)]">
          The context the platform reads <span className="font-semibold text-[var(--brand-text-bright)]">before it writes</span>: how {firstName} sounds, what the business is, who it serves, and the verifiable facts behind it. Keep these four groups full and every AI output gets sharper and more on-brand.
        </p>
      </section>

      <BrandContextCockpit summary={summary} activeTab={activeTab} onOpenTab={onOpenTab} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          {summary.groups.map((group) => (
            <BrandContextGroupSection
              key={group.id}
              group={group}
              activeTab={activeTab}
              onOpenTab={onOpenTab}
              onOpenGenerator={onOpenGenerator}
            />
          ))}
        </div>
        <BrandContextRail workspaceName={workspaceName} onOpenTab={onOpenTab} />
      </div>
    </div>
  );
}

function BrandAiPanel({
  tab,
  focus,
  onClearFocus,
  workspaceId,
  ws,
  legacyBusinessFootprintSection,
  refetchWorkspace,
}: {
  tab: WorkflowTab;
  focus: string | null;
  onClearFocus: () => void;
  workspaceId: string;
  ws: WorkspaceData | undefined;
  legacyBusinessFootprintSection: LegacyBusinessFootprintSection;
  refetchWorkspace: () => void;
}) {
  const { toast } = useToast();

  if (tab === 'context') {
    return (
      <BrandHub workspaceId={workspaceId} webflowSiteId={ws?.webflowSiteId} chromeless activeTab="context" />
    );
  }

  if (tab === 'brandscript') {
    return (
      <BrandscriptTab
        workspaceId={workspaceId}
        focusFirstExisting={focus === BRANDSCRIPT_OVERVIEW_FOCUS}
        onClearFocus={onClearFocus}
      />
    );
  }
  if (tab === 'discovery') return <DiscoveryTab workspaceId={workspaceId} />;
  if (tab === 'voice') {
    return (
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <VoiceTab workspaceId={workspaceId} />
      </Suspense>
    );
  }
  if (tab === 'identity') {
    return (
      <IdentityTab
        workspaceId={workspaceId}
        focusType={isIdentityGeneratorFocus(focus) ? focus : null}
        onClearFocus={onClearFocus}
      />
    );
  }
  if (tab === 'business-footprint') {
    return (
      <BusinessFootprintTab
        workspaceId={workspaceId}
        workspaceName={ws?.name || 'Workspace'}
        liveDomain={ws?.liveDomain}
        businessProfile={ws?.businessProfile}
        targetGeo={ws?.targetGeo}
        businessContext={ws?.keywordStrategy?.businessContext}
        brandLogoUrl={ws?.brandLogoUrl}
        siteHasSearch={ws?.siteHasSearch}
        legacySection={legacyBusinessFootprintSection}
        toast={toast}
        onBusinessProfileSave={refetchWorkspace}
      />
    );
  }
  if (tab === 'eeat-assets') return <EeatAssetsTab workspaceId={workspaceId} toast={toast} />;
  if (tab === 'intelligence-profile') {
    return (
      <IntelligenceProfileTab
        workspaceId={workspaceId}
        intelligenceProfile={ws?.intelligenceProfile}
        toast={toast}
        onSave={refetchWorkspace}
      />
    );
  }

  return null;
}

function BrandAiWorkflowModal({
  tab,
  focus,
  open,
  onClose,
  onClearFocus,
  workspaceId,
  ws,
  legacyBusinessFootprintSection,
  refetchWorkspace,
}: {
  tab: BrandAiTab;
  focus: string | null;
  open: boolean;
  onClose: () => void;
  onClearFocus: () => void;
  workspaceId: string;
  ws: WorkspaceData | undefined;
  legacyBusinessFootprintSection: LegacyBusinessFootprintSection;
  refetchWorkspace: () => void;
}) {
  if (!open || tab === 'overview') return null;

  const copy = WORKFLOW_MODAL_COPY[tab];

  return (
    <Modal open={open} onClose={onClose} size="workflow">
      <Modal.Header title={copy.title} onClose={onClose} />
      <Modal.Body className="max-h-[calc(100vh-11rem)] overflow-y-auto">
        <div className="flex flex-col gap-4">
          <div data-testid="brand-ai-modal-context" className="flex items-start gap-3">
            <TabIcon tab={tab} />
            <p className="min-w-0 flex-1 t-body text-[var(--brand-text-muted)]">
              {copy.subtitle}
            </p>
          </div>
          <BrandAiPanel
            tab={tab}
            focus={focus}
            onClearFocus={onClearFocus}
            workspaceId={workspaceId}
            ws={ws}
            legacyBusinessFootprintSection={legacyBusinessFootprintSection}
            refetchWorkspace={refetchWorkspace}
          />
        </div>
      </Modal.Body>
    </Modal>
  );
}

export function BrandAiSurface({ workspaceId }: BrandAiSurfaceProps) {
  const state = useBrandAiSurfaceState();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const shellFlagEnabled = useFeatureFlag('ui-rebuild-shell');

  const workspaceQuery = useQuery({
    queryKey: queryKeys.admin.workspaceDetail(workspaceId),
    queryFn: () => workspaces.getById(workspaceId) as Promise<WorkspaceData>,
    enabled: !!workspaceId,
  });

  const ws = workspaceQuery.data;
  const lastUpdated = formatDate(ws?.updatedAt ?? ws?.createdAt);

  const refetchWorkspace = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(workspaceId) });
    void workspaceQuery.refetch();
  }, [queryClient, workspaceId, workspaceQuery]);

  const handleRefresh = useCallback(async () => {
    try {
      await awaitSuccessfulRefetches([workspaceQuery.refetch()]);
      toast('Brand AI data refreshed', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Brand AI refresh failed'), 'error');
    }
  }, [toast, workspaceQuery]);

  const topbarActions = (
    <div className="flex max-w-full items-center justify-end gap-2 overflow-x-auto">
      {lastUpdated && <span className="hidden t-caption-sm text-[var(--brand-text-muted)] sm:inline">Data as of {lastUpdated}</span>}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleRefresh()}
        disabled={workspaceQuery.isFetching}
        aria-label="Refresh context"
      >
        <Icon name="refresh" size="sm" />
        <span className="hidden sm:inline">Refresh context</span>
      </Button>
    </div>
  );

  if (workspaceQuery.isError && !ws) {
    return (
      <ErrorBoundary label="Brand AI rebuilt surface">
        <div className="flex min-h-full flex-col gap-5">
          <PageHeader title="Brand & AI" subtitle="Brand context, discovery, voice, identity, and trust inputs for AI generation." />
          <ErrorState
            type="data"
            title="Brand AI data did not load"
            message="Retry the workspace read before editing brand context."
            action={{ label: 'Retry', onClick: () => void workspaceQuery.refetch() }}
            className="min-h-[420px]"
          />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label="Brand AI rebuilt surface">
      <div
        className="mx-auto flex min-h-full w-full max-w-[var(--page-max)] flex-col gap-5 lg:px-2 2xl:px-5"
        data-rebuild-flag={shellFlagEnabled ? 'on' : 'default'}
        data-testid="brand-ai-rebuilt-surface"
      >
        <RebuiltTopbarActions
          fallback={<div data-testid="brand-ai-topbar-actions-fallback">{topbarActions}</div>}
        >
          {topbarActions}
        </RebuiltTopbarActions>

        {workspaceQuery.isLoading && !ws ? (
          <BrandAiLoadingState />
        ) : (
          <>
            {workspaceQuery.isError && ws && (
              <InlineBanner tone="warning" title="Brand AI data may be stale">
                The latest workspace read did not refresh, so the last loaded brand context is still shown.
              </InlineBanner>
            )}

            <BrandContextOverview
              ws={ws}
              activeTab={state.tab}
              onOpenTab={state.setTab}
              onOpenGenerator={(deliverableType) => state.setTab('identity', deliverableType)}
            />

            <BrandAiWorkflowModal
              tab={state.tab}
              focus={state.focus}
              open={state.tab !== 'overview'}
              onClose={() => state.setTab('overview')}
              onClearFocus={() => state.setFocus(null)}
              workspaceId={workspaceId}
              ws={ws}
              legacyBusinessFootprintSection={state.legacyBusinessFootprintSection}
              refetchWorkspace={refetchWorkspace}
            />
          </>
        )}

      </div>
    </ErrorBoundary>
  );
}

export default BrandAiSurface;
