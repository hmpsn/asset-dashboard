import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from './Toast';
import {
  Save, Sparkles, BookOpen, Users, MessageSquare,
  Plus, Pencil, Trash2, Check, Upload, Mic, Award, Map, BrainCircuit, Building2,
} from 'lucide-react';
import { PageHeader, SectionCard, TabBar, ErrorState, NextStepsCard, ProgressIndicator, Icon, Button, IconButton, ConfirmDialog, FormInput, FormSelect, FormTextarea } from './ui';
import { ErrorBoundary } from './ErrorBoundary';
import { workspaces } from '../api';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { queryKeys } from '../lib/queryKeys';
import { inlineMarkdownToHtml } from '../lib/inline-markdown';
import { resolveTabSearchParam } from '../lib/tab-search-param';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import type { AudiencePersona } from '../../shared/types/workspace';
import { BrandscriptTab } from './brand/BrandscriptTab';
import { DiscoveryTab } from './brand/DiscoveryTab';
import { VoiceTab } from './brand/VoiceTab';
import { IdentityTab } from './brand/IdentityTab';
import { PageStrategyTab } from './brand/PageStrategyTab';
import { BlueprintDetail } from './brand/BlueprintDetail';
import { BlueprintVersionHistory } from './brand/BlueprintVersionHistory';
import { BrandOverviewTab } from './brand/BrandOverviewTab';
import { RichTextEditor } from './post-editor/RichTextEditor';
import { EeatAssetsTab } from './settings/EeatAssetsTab';
import { BusinessFootprintTab } from './settings/BusinessFootprintTab';
import { IntelligenceProfileTab } from './settings/IntelligenceProfileTab';

interface WorkspaceData {
  id: string;
  name: string;
  webflowSiteId?: string;
  liveDomain?: string;
  brandLogoUrl?: string;
  siteHasSearch?: boolean;
  knowledgeBase?: string;
  brandVoice?: string;
  personas?: AudiencePersona[];
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

interface Props {
  workspaceId: string;
  webflowSiteId?: string;
}

type BrandHubLegacyTab = 'business-profile' | 'locations';
type BrandHubTab = 'overview' | 'brandscript' | 'discovery' | 'voice' | 'identity' | 'business-footprint' | 'eeat-assets' | 'intelligence-profile';
const VALID_BRAND_TABS: readonly BrandHubTab[] = ['overview', 'brandscript', 'discovery', 'voice', 'identity', 'business-footprint', 'eeat-assets', 'intelligence-profile'];
const BRAND_TAB_ALIASES: Record<BrandHubLegacyTab, BrandHubTab> = {
  'business-profile': 'business-footprint',
  locations: 'business-footprint',
};

function contextJobStorageKey(workspaceId: string, type: string): string {
  return `brand-hub:${workspaceId}:${type}:jobId`;
}

function readStoredContextJobId(workspaceId: string, type: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(contextJobStorageKey(workspaceId, type));
}

function storeContextJobId(workspaceId: string, type: string, jobId: string | null): void {
  if (typeof window === 'undefined') return;
  const key = contextJobStorageKey(workspaceId, type);
  if (jobId) window.sessionStorage.setItem(key, jobId);
  else window.sessionStorage.removeItem(key);
}

const LEGACY_PREVIEW_SPLIT_RE = /(?:^|\n)\s*Preview\s*\n/i;
const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;

function stripLegacyPreviewBlock(value: string): string {
  const raw = value || '';
  const match = LEGACY_PREVIEW_SPLIT_RE.exec(raw);
  if (!match || match.index <= 0) return raw.trim();
  return raw.slice(0, match.index).trim();
}

function textToEditorHtml(value: string): string {
  const normalized = (value || '').trim();
  if (!normalized) return '<p></p>';
  if (HTML_TAG_RE.test(normalized)) return normalized;

  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map(item => `<li>${item}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      flushList();
      blocks.push(`<h3>${inlineMarkdownToHtml(h3[1])}</h3>`);
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flushList();
      blocks.push(`<h2>${inlineMarkdownToHtml(h2[1])}</h2>`);
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      flushList();
      blocks.push(`<h2>${inlineMarkdownToHtml(h1[1])}</h2>`);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      listItems.push(inlineMarkdownToHtml(bullet[1]));
      continue;
    }
    flushList();
    blocks.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }
  flushList();

  return blocks.length ? blocks.join('') : '<p></p>';
}

function editorHtmlToText(value: string): string {
  if (typeof document === 'undefined') return (value || '').trim();
  const container = document.createElement('div');
  container.innerHTML = value || '';

  const renderInline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(renderInline).join('');
    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'em' || tag === 'i') return `*${inner}*`;
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const label = inner.trim() || href;
      return href ? `[${label}](${href})` : label;
    }
    if (tag === 'br') return '\n';
    return inner;
  };

  const blocks: string[] = [];
  const pushBlock = (line: string) => {
    const normalized = line.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    if (normalized) blocks.push(normalized);
  };

  const renderBlock = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').trim();
      if (text) pushBlock(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'h2') {
      pushBlock(`## ${renderInline(el).trim()}`);
      return;
    }
    if (tag === 'h3') {
      pushBlock(`### ${renderInline(el).trim()}`);
      return;
    }
    if (tag === 'ul') {
      const items = Array.from(el.querySelectorAll(':scope > li'));
      for (const item of items) pushBlock(`- ${renderInline(item).trim()}`);
      return;
    }
    if (tag === 'ol') {
      const items = Array.from(el.querySelectorAll(':scope > li'));
      items.forEach((item, index) => pushBlock(`${index + 1}. ${renderInline(item).trim()}`));
      return;
    }
    if (tag === 'p') {
      pushBlock(renderInline(el));
      return;
    }

    const directChildren = Array.from(el.childNodes);
    if (directChildren.length === 0) {
      pushBlock(renderInline(el));
      return;
    }
    directChildren.forEach(renderBlock);
  };

  Array.from(container.childNodes).forEach(renderBlock);
  return blocks.join('\n\n').trim();
}

function brandVoiceToEditorHtml(value: string): string {
  return textToEditorHtml(stripLegacyPreviewBlock(value));
}

function editorHtmlToBrandVoice(value: string): string {
  return stripLegacyPreviewBlock(editorHtmlToText(value));
}

export function BrandHub({ workspaceId, webflowSiteId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { jobs, startJob, findActiveJob } = useBackgroundTasks();
  const [searchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const legacyBusinessFootprintSection: BrandHubLegacyTab | null =
    rawTab === 'business-profile' || rawTab === 'locations' ? rawTab : null;

  // Active tab
  const [activeTab, setActiveTab] = useState<BrandHubTab>(() => resolveTabSearchParam<BrandHubTab>(rawTab, {
    validValues: VALID_BRAND_TABS,
    fallback: 'overview',
    legacyAliases: BRAND_TAB_ALIASES,
  }));

  // Workspace data (React Query)
  const { data: ws } = useQuery({
    queryKey: queryKeys.admin.workspaceDetail(workspaceId),
    queryFn: () => workspaces.getById(workspaceId) as Promise<WorkspaceData>,
    enabled: !!workspaceId,
  });

  const patchWorkspaceMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => workspaces.update(workspaceId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(workspaceId) });
    },
  });
  const patchWorkspace = (patch: Record<string, unknown>) => patchWorkspaceMutation.mutateAsync(patch);

  // Brand Voice state
  const [brandVoice, setBrandVoice] = useState('');
  const [brandVoiceEditorHtml, setBrandVoiceEditorHtml] = useState('<p></p>');
  const [savingBrandVoice, setSavingBrandVoice] = useState(false);
  const [startingBrandVoiceJob, setStartingBrandVoiceJob] = useState(false);
  const [lastBrandVoiceJobId, setLastBrandVoiceJobId] = useState<string | null>(() =>
    readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION)
  );

  // Sync brand voice textarea from loaded workspace once
  useEffect(() => {
    if (ws?.brandVoice !== undefined) {
      const normalizedVoice = stripLegacyPreviewBlock(ws.brandVoice || '');
      setBrandVoice(normalizedVoice);
      setBrandVoiceEditorHtml(brandVoiceToEditorHtml(normalizedVoice));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  // Sync knowledge base textarea from loaded workspace once
  useEffect(() => {
    if (ws?.knowledgeBase !== undefined) {
      const normalizedKb = (ws.knowledgeBase || '').trim();
      setKbDraft(normalizedKb);
      setKbEditorHtml(textToEditorHtml(normalizedKb));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  // Knowledge Base state
  const [kbDraft, setKbDraft] = useState('');
  const [kbEditorHtml, setKbEditorHtml] = useState('<p></p>');
  const [savingKnowledgeBase, setSavingKnowledgeBase] = useState(false);
  const [startingKbJob, setStartingKbJob] = useState(false);
  const [lastKbJobId, setLastKbJobId] = useState<string | null>(() =>
    readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION)
  );

  // Personas state
  const [showPersonas, setShowPersonas] = useState(false);
  const [localPersonas, setLocalPersonas] = useState<AudiencePersona[]>([]);
  const [savingPersonas, setSavingPersonas] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [personaDraft, setPersonaDraft] = useState({ name: '', description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' as string });
  const [startingPersonasJob, setStartingPersonasJob] = useState(false);
  const [lastPersonasJobId, setLastPersonasJobId] = useState<string | null>(() =>
    readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION)
  );
  const [confirmDeletePersona, setConfirmDeletePersona] = useState<AudiencePersona | null>(null);

  // Brand voice error + completion state
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [brandVoiceError, setBrandVoiceError] = useState<string | null>(null);

  // Page Strategy state
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);

  const activeBrandVoiceJob = findActiveJob({ type: BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, workspaceId });
  const activeKbJob = findActiveJob({ type: BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, workspaceId });
  const activePersonasJob = findActiveJob({ type: BACKGROUND_JOB_TYPES.PERSONA_GENERATION, workspaceId });
  const completedBrandVoiceJob = lastBrandVoiceJobId ? jobs.find(job => job.id === lastBrandVoiceJobId) : undefined;
  const completedKbJob = lastKbJobId ? jobs.find(job => job.id === lastKbJobId) : undefined;
  const completedPersonasJob = lastPersonasJobId ? jobs.find(job => job.id === lastPersonasJobId) : undefined;
  const generatingBrandVoice = startingBrandVoiceJob || Boolean(activeBrandVoiceJob);
  const generatingKB = startingKbJob || Boolean(activeKbJob);
  const generatingPersonas = startingPersonasJob || Boolean(activePersonasJob);

  // Keep BrandHub in sync with ?tab= deep links.
  useEffect(() => {
    setActiveTab(resolveTabSearchParam<BrandHubTab>(searchParams.get('tab'), {
      validValues: VALID_BRAND_TABS,
      fallback: 'overview',
      legacyAliases: BRAND_TAB_ALIASES,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // effect-layout-ok: route changes swap the workspace whose draft job IDs we should recover.
  useEffect(() => {
    setLastBrandVoiceJobId(readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION));
    setLastKbJobId(readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION));
    setLastPersonasJobId(readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION));
  }, [workspaceId]);

  // effect-layout-ok: active background jobs can predate this component mount.
  useEffect(() => {
    if (activeBrandVoiceJob && !lastBrandVoiceJobId) {
      setLastBrandVoiceJobId(activeBrandVoiceJob.id);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, activeBrandVoiceJob.id);
    }
  }, [activeBrandVoiceJob, lastBrandVoiceJobId, workspaceId]);

  // effect-layout-ok: active background jobs can predate this component mount.
  useEffect(() => {
    if (activeKbJob && !lastKbJobId) {
      setLastKbJobId(activeKbJob.id);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, activeKbJob.id);
    }
  }, [activeKbJob, lastKbJobId, workspaceId]);

  // effect-layout-ok: active background jobs can predate this component mount.
  useEffect(() => {
    if (activePersonasJob && !lastPersonasJobId) {
      setLastPersonasJobId(activePersonasJob.id);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION, activePersonasJob.id);
    }
  }, [activePersonasJob, lastPersonasJobId, workspaceId]);

  // effect-layout-ok: background job completion arrives asynchronously via WebSocket/job state.
  useEffect(() => {
    if (!completedBrandVoiceJob) return;
    if (completedBrandVoiceJob.status === 'done') {
      const result = completedBrandVoiceJob.result as { kind?: string; brandVoice?: string; pagesScraped?: number } | undefined;
      if (result?.kind === 'brandVoice' && typeof result.brandVoice === 'string') {
        const normalizedVoice = stripLegacyPreviewBlock(result.brandVoice);
        setBrandVoice(normalizedVoice);
        setBrandVoiceEditorHtml(brandVoiceToEditorHtml(normalizedVoice));
        toast(`Brand voice generated from ${result.pagesScraped ?? 0} pages — review and save`);
        setShowNextSteps(true);
      }
      setLastBrandVoiceJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, null);
    } else if (completedBrandVoiceJob.status === 'error') {
      const message = completedBrandVoiceJob.error || completedBrandVoiceJob.message || 'Brand voice generation failed';
      toast(message, 'error');
      setBrandVoiceError(message);
      setLastBrandVoiceJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, null);
    } else if (completedBrandVoiceJob.status === 'cancelled') {
      toast('Brand voice generation was cancelled', 'error');
      setLastBrandVoiceJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, null);
    }
  }, [completedBrandVoiceJob, toast, workspaceId]);

  // effect-layout-ok: background job completion arrives asynchronously via WebSocket/job state.
  useEffect(() => {
    if (!completedKbJob) return;
    if (completedKbJob.status === 'done') {
      const result = completedKbJob.result as { kind?: string; knowledgeBase?: string; pagesScraped?: number } | undefined;
      if (result?.kind === 'knowledgeBase' && typeof result.knowledgeBase === 'string') {
        const normalizedKb = result.knowledgeBase.trim();
        setKbDraft(normalizedKb);
        setKbEditorHtml(textToEditorHtml(normalizedKb));
        toast(`Knowledge base generated from ${result.pagesScraped ?? 0} pages — review and save`);
      }
      setLastKbJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, null);
    } else if (completedKbJob.status === 'error') {
      toast(completedKbJob.error || completedKbJob.message || 'Knowledge base generation failed', 'error');
      setLastKbJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, null);
    } else if (completedKbJob.status === 'cancelled') {
      toast('Knowledge base generation was cancelled', 'error');
      setLastKbJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, null);
    }
  }, [completedKbJob, toast, workspaceId]);

  // effect-layout-ok: background job completion arrives asynchronously via WebSocket/job state.
  useEffect(() => {
    if (!completedPersonasJob) return;
    if (completedPersonasJob.status === 'done') {
      const result = completedPersonasJob.result as { kind?: string; personas?: AudiencePersona[]; pagesScraped?: number } | undefined;
      if (result?.kind === 'personas' && Array.isArray(result.personas)) {
        setLocalPersonas(result.personas);
        toast(`${result.personas.length} personas generated from ${result.pagesScraped ?? 0} pages — review and save`);
      }
      setLastPersonasJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION, null);
    } else if (completedPersonasJob.status === 'error') {
      toast(completedPersonasJob.error || completedPersonasJob.message || 'Persona generation failed', 'error');
      setLastPersonasJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION, null);
    } else if (completedPersonasJob.status === 'cancelled') {
      toast('Persona generation was cancelled', 'error');
      setLastPersonasJobId(null);
      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION, null);
    }
  }, [completedPersonasJob, toast, workspaceId]);

  const saveBrandVoiceHandler = async () => {
    setSavingBrandVoice(true);
    try {
      await patchWorkspace({ brandVoice: brandVoice.trim() });
      toast('Brand voice saved');
    } catch { toast('Failed to save brand voice', 'error'); }
    finally { setSavingBrandVoice(false); }
  };

  const generateBrandVoiceHandler = async () => {
    if (generatingBrandVoice) return;
    setStartingBrandVoiceJob(true);
    setBrandVoiceError(null);
    setShowNextSteps(false);
    try {
      const jobId = await startJob(BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, { workspaceId });
      if (jobId) {
        setLastBrandVoiceJobId(jobId);
        storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, jobId);
        toast('Brand voice generation started');
      } else {
        setBrandVoiceError('Failed to start brand voice generation');
        toast('Failed to start brand voice generation', 'error');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start brand voice generation';
      toast(message, 'error');
      setBrandVoiceError(message);
    } finally {
      setStartingBrandVoiceJob(false);
    }
  };

  const saveKnowledgeBaseHandler = async () => {
    if (!ws) return;
    const value = kbDraft.trim();
    if (value === (ws.knowledgeBase || '')) return;
    setSavingKnowledgeBase(true);
    try {
      await patchWorkspace({ knowledgeBase: value });
      toast('Knowledge base saved');
    } catch {
      toast('Failed to save knowledge base', 'error');
    } finally {
      setSavingKnowledgeBase(false);
    }
  };

  return (
    <ErrorBoundary label="Brand Hub">
    <div className="space-y-8">
      <PageHeader
        title="Brand & AI Context"
        subtitle="Everything that feeds into AI content generation — voice, knowledge, and audience"
        icon={<Icon as={Sparkles} size="lg" className="text-accent-brand" />}
      />

      {/* Supports ?tab= deep links (e.g., Brand & AI sub-panels like business-profile/locations). */}
      <TabBar
        active={activeTab}
        onChange={(id) => setActiveTab(id as BrandHubTab)}
        tabs={[
          { id: 'overview', label: 'Overview', icon: Sparkles },
          { id: 'brandscript', label: 'Brandscript', icon: BookOpen },
          { id: 'discovery', label: 'Discovery', icon: Upload },
          { id: 'voice', label: 'Voice', icon: Mic },
          { id: 'identity', label: 'Identity', icon: Award },
          { id: 'business-footprint', label: 'Business Footprint', icon: Building2 },
          { id: 'eeat-assets', label: 'E-E-A-T Assets', icon: Map },
          { id: 'intelligence-profile', label: 'Intelligence Profile', icon: BrainCircuit },
        ]}
      />

      {activeTab === 'brandscript' && <BrandscriptTab workspaceId={workspaceId} />}
      {activeTab === 'discovery' && <DiscoveryTab workspaceId={workspaceId} />}
      {activeTab === 'voice' && <VoiceTab workspaceId={workspaceId} />}
      {activeTab === 'identity' && <IdentityTab workspaceId={workspaceId} />}
      {activeTab === 'business-footprint' && (
        <BusinessFootprintTab
          workspaceId={workspaceId}
          workspaceName={ws?.name || 'Workspace'}
          liveDomain={ws?.liveDomain}
          businessProfile={ws?.businessProfile}
          businessContext={ws?.keywordStrategy?.businessContext}
          brandLogoUrl={ws?.brandLogoUrl}
          siteHasSearch={ws?.siteHasSearch}
          legacySection={legacyBusinessFootprintSection}
          toast={toast}
          onBusinessProfileSave={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(workspaceId) });
          }}
        />
      )}
      {activeTab === 'eeat-assets' && <EeatAssetsTab workspaceId={workspaceId} toast={toast} />}
      {activeTab === 'intelligence-profile' && (
        <IntelligenceProfileTab
          workspaceId={workspaceId}
          intelligenceProfile={ws?.intelligenceProfile}
          toast={toast}
          onSave={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(workspaceId) });
          }}
        />
      )}
      {activeTab === 'overview' && <>
      <BrandOverviewTab
        workspaceId={workspaceId}
        brandVoice={ws?.brandVoice}
        knowledgeBase={ws?.knowledgeBase}
        personasCount={ws?.personas?.length ?? 0}
        businessContext={ws?.keywordStrategy?.businessContext}
        intelligenceProfile={ws?.intelligenceProfile}
        businessProfile={ws?.businessProfile}
      />

      <div id="brand-hub-current-context" className="space-y-8">
      {/* ═══ BRAND VOICE ═══ */}
      <SectionCard
        title="Brand Voice & Style"
        titleIcon={<Icon as={MessageSquare} size="md" className="text-accent-brand" />}
        titleExtra={brandVoice ? <span className="t-caption-sm text-accent-success font-medium">(configured)</span> : undefined}
      >
        <div className="space-y-3">
          <p className="t-caption text-[var(--brand-text-muted)]">
            Tone, personality, and writing guidelines — used in ALL AI-generated copy (SEO rewrites, content briefs, blog posts)
          </p>
          <div id="brand-voice-textarea">
            <RichTextEditor
              initialValue={brandVoiceEditorHtml}
              onChange={(html) => {
                setBrandVoiceEditorHtml(html);
                setBrandVoice(editorHtmlToBrandVoice(html));
              }}
              variant="admin"
              minHeight="300px"
              className="w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={savingBrandVoice ? undefined : Save}
              loading={savingBrandVoice}
              onClick={saveBrandVoiceHandler}
              disabled={savingBrandVoice}
            >
              Save Brand Voice
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={generatingBrandVoice ? undefined : Sparkles}
              loading={generatingBrandVoice}
              onClick={generateBrandVoiceHandler}
              disabled={generatingBrandVoice || !webflowSiteId}
              className="gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-500/10 text-accent-brand hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generatingBrandVoice ? 'Crawling site...' : 'Generate from Website'}
            </Button>
          </div>
          <ProgressIndicator
            status={generatingBrandVoice ? 'running' : 'idle'}
            step="Analyzing brand voice..."
          />
          {brandVoiceError && (
            <ErrorState
              type="general"
              title="Brand Voice Generation Failed"
              message={brandVoiceError}
              action={{ label: 'Try Again', onClick: generateBrandVoiceHandler }}
            />
          )}
          {showNextSteps && brandVoice && !generatingBrandVoice && (
            <NextStepsCard
              title="Brand voice generated"
              variant="success"
              onDismiss={() => setShowNextSteps(false)}
              staggerIndex={0}
              steps={[
                {
                  label: 'Review knowledge base',
                  onClick: () => { setShowNextSteps(false); setTimeout(() => document.getElementById('knowledge-base-textarea')?.scrollIntoView({ behavior: 'smooth' }), 150); },
                },
              ]}
            />
          )}
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            You can also drop <code className="text-accent-brand">.txt</code> or <code className="text-accent-brand">.md</code> files into the <code className="text-accent-brand">brand-docs/</code> folder in your workspace uploads.
          </p>
        </div>
      </SectionCard>

      {/* ═══ KNOWLEDGE BASE ═══ */}
      <SectionCard
        title="Knowledge Base"
        titleIcon={<Icon as={BookOpen} size="md" className="text-accent-brand" />}
        titleExtra={ws?.knowledgeBase ? <span className="t-caption-sm text-accent-success font-medium">(configured)</span> : undefined}
      >
        <div className="space-y-3">
          <p className="t-caption text-[var(--brand-text-muted)]">Business context for AI — services, capabilities, FAQs, industry info</p>
          <div id="knowledge-base-textarea">
            <RichTextEditor
              initialValue={kbEditorHtml}
              onChange={(html) => {
                setKbEditorHtml(html);
                setKbDraft(editorHtmlToText(html));
              }}
              variant="admin"
              minHeight="300px"
              className="w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={savingKnowledgeBase ? undefined : Save}
              loading={savingKnowledgeBase}
              onClick={saveKnowledgeBaseHandler}
              disabled={savingKnowledgeBase || kbDraft.trim() === (ws?.knowledgeBase || '')}
            >
              Save Knowledge Base
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={generatingKB ? undefined : Sparkles}
              loading={generatingKB}
              onClick={async () => {
                if (generatingKB) return;
                setStartingKbJob(true);
                try {
                  const jobId = await startJob(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, { workspaceId });
                  if (jobId) {
                    setLastKbJobId(jobId);
                    storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, jobId);
                    toast('Knowledge base generation started');
                  } else {
                    toast('Failed to start knowledge base generation', 'error');
                  }
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Failed to start knowledge base generation', 'error');
                } finally {
                  setStartingKbJob(false);
                }
              }}
              disabled={generatingKB || !webflowSiteId}
              className="gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-500/10 text-accent-brand hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generatingKB ? 'Crawling site...' : 'Generate from Website'}
            </Button>
            {kbDraft.trim() !== (ws?.knowledgeBase || '') && (
              <span className="t-caption-sm text-accent-warning">Unsaved changes</span>
            )}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            This context is shared with both the client Insights Engine and Admin Insights chatbots.
            You can also place <code className="text-[var(--brand-text)]">.txt</code> or <code className="text-[var(--brand-text)]">.md</code> files in the <code className="text-[var(--brand-text)]">knowledge-docs/</code> folder for longer documents.
          </p>
        </div>
      </SectionCard>

      {/* ═══ AUDIENCE PERSONAS ═══ */}
      <SectionCard
        title="Audience Personas"
        titleIcon={<Icon as={Users} size="md" className="text-accent-info" />}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={showPersonas ? undefined : Plus}
            onClick={() => {
              if (!showPersonas) setLocalPersonas(ws?.personas || []);
              setShowPersonas(!showPersonas);
              setEditingPersonaId(null);
            }}
            className="gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium"
            style={{ backgroundColor: 'var(--surface-3)', color: 'var(--brand-text)' }}
          >
            {showPersonas ? 'Close' : 'Manage'}
          </Button>
        }
        noPadding
      >
        {/* Summary when collapsed */}
        {!showPersonas && (
          <div className="px-4 py-3">
            <p className="t-caption text-[var(--brand-text-muted)] mb-2">Define target audience segments — used in content briefs and AI writing prompts</p>
            {(ws?.personas?.length || 0) > 0 ? (
              <div className="flex flex-wrap gap-2">
                {ws!.personas!.map(p => (
                  <span key={p.id} className="t-caption-sm px-2 py-1 rounded-[var(--radius-md)] badge-span-ok bg-blue-500/10 text-accent-info border border-blue-500/20">
                    {p.name}{p.buyingStage ? ` · ${p.buyingStage}` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">No personas defined — AI will use generic audience targeting</span>
            )}
          </div>
        )}

        {/* Expanded persona manager */}
        {showPersonas && (
          <div className="px-4 py-4 space-y-4">
            {/* Existing personas */}
            {localPersonas.map(p => (
              <div key={p.id} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="t-caption font-medium text-[var(--brand-text-bright)]">{p.name}</span>
                    {p.buyingStage && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-blue-500/10 text-accent-info border border-blue-500/20">{p.buyingStage}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      type="button"
                      label={`Edit persona ${p.name}`}
                      icon={Pencil}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (editingPersonaId === p.id) { setEditingPersonaId(null); return; }
                        setEditingPersonaId(p.id);
                        setPersonaDraft({
                          name: p.name, description: p.description,
                          painPoints: p.painPoints.join('\n'), goals: p.goals.join('\n'),
                          objections: p.objections.join('\n'),
                          preferredContentFormat: p.preferredContentFormat || '',
                          buyingStage: p.buyingStage || '',
                        });
                      }}
                      className="p-1 rounded text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                    />
                    <IconButton
                      type="button"
                      label={`Delete persona ${p.name}`}
                      icon={Trash2}
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeletePersona(p)}
                      className="p-1 rounded text-[var(--brand-text-muted)] hover:text-accent-danger"
                    />
                  </div>
                </div>
                {editingPersonaId !== p.id && (
                  <div className="px-3 pb-2.5 t-caption-sm text-[var(--brand-text-muted)]">{p.description}</div>
                )}
                {editingPersonaId === p.id && (
                  <div className="px-3 pb-3 space-y-2 border-t border-[var(--brand-border)] pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`persona-${p.id}-name`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Name</label>
                        <FormInput
                          id={`persona-${p.id}-name`}
                          value={personaDraft.name}
                          onChange={value => setPersonaDraft(d => ({ ...d, name: value }))}
                          className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
                        />
                      </div>
                      <div>
                        <label htmlFor={`persona-${p.id}-buying-stage`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Buying Stage</label>
                        <FormSelect
                          id={`persona-${p.id}-buying-stage`}
                          value={personaDraft.buyingStage}
                          onChange={value => setPersonaDraft(d => ({ ...d, buyingStage: value }))}
                          options={[
                            { value: '', label: 'None' },
                            { value: 'awareness', label: 'Awareness' },
                            { value: 'consideration', label: 'Consideration' },
                            { value: 'decision', label: 'Decision' },
                          ]}
                          className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 cursor-pointer"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`persona-${p.id}-description`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Description</label>
                      <FormInput
                        id={`persona-${p.id}-description`}
                        value={personaDraft.description}
                        onChange={value => setPersonaDraft(d => ({ ...d, description: value }))}
                        placeholder="Who is this person?"
                        className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label htmlFor={`persona-${p.id}-pain-points`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Pain Points (one per line)</label>
                        <FormTextarea
                          id={`persona-${p.id}-pain-points`}
                          value={personaDraft.painPoints}
                          onChange={value => setPersonaDraft(d => ({ ...d, painPoints: value }))}
                          rows={3}
                          className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500 resize-none"
                        />
                      </div>
                      <div>
                        <label htmlFor={`persona-${p.id}-goals`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Goals (one per line)</label>
                        <FormTextarea
                          id={`persona-${p.id}-goals`}
                          value={personaDraft.goals}
                          onChange={value => setPersonaDraft(d => ({ ...d, goals: value }))}
                          rows={3}
                          className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500 resize-none"
                        />
                      </div>
                      <div>
                        <label htmlFor={`persona-${p.id}-objections`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Objections (one per line)</label>
                        <FormTextarea
                          id={`persona-${p.id}-objections`}
                          value={personaDraft.objections}
                          onChange={value => setPersonaDraft(d => ({ ...d, objections: value }))}
                          rows={3}
                          className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500 resize-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`persona-${p.id}-content-format`} className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Preferred Content Format</label>
                      <FormInput
                        id={`persona-${p.id}-content-format`}
                        value={personaDraft.preferredContentFormat}
                        onChange={value => setPersonaDraft(d => ({ ...d, preferredContentFormat: value }))}
                        placeholder="e.g. how-to guides, case studies, comparison articles"
                        className="w-full px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Check}
                      onClick={() => {
                        setLocalPersonas(prev => prev.map(x => x.id === p.id ? {
                          ...x, name: personaDraft.name.trim(), description: personaDraft.description.trim(),
                          painPoints: personaDraft.painPoints.split('\n').map(s => s.trim()).filter(Boolean),
                          goals: personaDraft.goals.split('\n').map(s => s.trim()).filter(Boolean),
                          objections: personaDraft.objections.split('\n').map(s => s.trim()).filter(Boolean),
                          preferredContentFormat: personaDraft.preferredContentFormat.trim() || undefined,
                          buyingStage: (personaDraft.buyingStage || undefined) as AudiencePersona['buyingStage'],
                        } : x));
                        setEditingPersonaId(null);
                      }}
                      className="gap-1 px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white t-caption-sm font-medium"
                    >
                      Apply Changes
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {/* Add new persona */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => {
                const newP: AudiencePersona = {
                  id: `persona_${Date.now()}`, name: 'New Persona', description: '',
                  painPoints: [], goals: [], objections: [],
                };
                setLocalPersonas(prev => [...prev, newP]);
                setEditingPersonaId(newP.id);
                setPersonaDraft({ name: newP.name, description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' });
              }}
              className="w-full justify-center gap-1.5 px-3 py-2 rounded-[var(--radius-md)] border border-dashed border-[var(--brand-border)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:border-[var(--brand-border-hover)]"
            >
              Add Persona
            </Button>

            {/* Save button */}
            <div className="pt-2 border-t border-[var(--brand-border)] flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                icon={savingPersonas ? undefined : Save}
                loading={savingPersonas}
                disabled={savingPersonas}
                onClick={async () => {
                  setSavingPersonas(true);
                  try {
                    await patchWorkspace({ personas: localPersonas });
                    toast('Audience personas saved');
                  } catch { toast('Failed to save personas', 'error'); }
                  finally { setSavingPersonas(false); }
                }}
              >
                Save Personas
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={generatingPersonas ? undefined : Sparkles}
                loading={generatingPersonas}
                onClick={async () => {
                  if (generatingPersonas) return;
                  setStartingPersonasJob(true);
                  try {
                    const jobId = await startJob(BACKGROUND_JOB_TYPES.PERSONA_GENERATION, { workspaceId });
                    if (jobId) {
                      setLastPersonasJobId(jobId);
                      storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION, jobId);
                      toast('Persona generation started');
                    } else {
                      toast('Failed to start persona generation', 'error');
                    }
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Failed to start persona generation', 'error');
                  } finally {
                    setStartingPersonasJob(false);
                  }
                }}
                disabled={generatingPersonas || !webflowSiteId}
                className="gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-blue-500/10 text-accent-info hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generatingPersonas ? 'Crawling site...' : 'Generate from Website'}
              </Button>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{localPersonas.length} persona{localPersonas.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ═══ PAGE STRATEGY ═══ */}
      <SectionCard
        title="Page Strategy"
        titleIcon={<Icon as={Map} size="md" className="text-accent-brand" />}
      >
        {selectedBlueprintId ? (
          <div className="space-y-6">
            <BlueprintDetail
              workspaceId={workspaceId}
              blueprintId={selectedBlueprintId}
              onBack={() => setSelectedBlueprintId(null)}
            />
            <BlueprintVersionHistory
              workspaceId={workspaceId}
              blueprintId={selectedBlueprintId}
            />
          </div>
        ) : (
          <PageStrategyTab
            workspaceId={workspaceId}
            onSelectBlueprint={setSelectedBlueprintId}
          />
        )}
      </SectionCard>

      {/* Info footer */}
      <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-md)] border border-[var(--brand-border)] px-4 py-3">
        <div className="flex items-start gap-2">
          <Icon as={Sparkles} size="md" className="text-accent-brand mt-0.5 flex-shrink-0" />
          <div className="t-caption-sm text-[var(--brand-text-muted)]">
            <strong className="text-[var(--brand-text)]">How it works:</strong> These three sources — brand voice, knowledge base, and personas — are automatically
            injected into every AI-generated output: content briefs, blog posts, SEO rewrites, and chatbot conversations.
            The more context you provide, the more accurate and on-brand the AI outputs will be.
          </div>
        </div>
      </div>
      </div>
      </>}
    </div>

    <ConfirmDialog
      open={!!confirmDeletePersona}
      title="Delete Persona"
      message={confirmDeletePersona ? `Delete persona "${confirmDeletePersona.name}"? This change is applied locally and persisted when you click Save Personas.` : ''}
      variant="destructive"
      confirmLabel="Delete"
      onConfirm={() => {
        if (confirmDeletePersona) setLocalPersonas(prev => prev.filter(x => x.id !== confirmDeletePersona.id));
        setConfirmDeletePersona(null);
      }}
      onCancel={() => setConfirmDeletePersona(null)}
    />
    </ErrorBoundary>
  );
}
