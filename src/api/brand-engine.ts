// src/api/brand-engine.ts
import { get, getText, post, put, patch, del, postForm } from './client';
import type {
  Brandscript, BrandscriptTemplate,
  DiscoverySource, DiscoveryExtraction,
  VoiceProfile, VoiceSample, CalibrationSession,
  BrandDeliverable,
} from '../../shared/types/brand-engine';
import type {
  SiteBlueprint,
  BlueprintEntry,
  BlueprintVersion,
  BlueprintGenerationInput,
} from '../../shared/types/page-strategy';

// ═══ BRANDSCRIPT ═══

export const brandscripts = {
  list: (wsId: string) => get<Brandscript[]>(`/api/brandscripts/${wsId}`),
  get: (wsId: string, id: string) => get<Brandscript>(`/api/brandscripts/${wsId}/${id}`),
  create: (wsId: string, body: { name: string; frameworkType?: string; sections?: { title: string; purpose?: string; content?: string }[] }) =>
    post<Brandscript>(`/api/brandscripts/${wsId}`, body),
  updateSections: (wsId: string, id: string, sections: { id?: string; title: string; purpose?: string; content?: string }[]) =>
    put<Brandscript>(`/api/brandscripts/${wsId}/${id}/sections`, { sections }),
  remove: (wsId: string, id: string) => del(`/api/brandscripts/${wsId}/${id}`),
  import: (wsId: string, body: { name?: string; rawText: string }) =>
    post<Brandscript>(`/api/brandscripts/${wsId}/import`, body),
  complete: (wsId: string, id: string) =>
    post<Brandscript>(`/api/brandscripts/${wsId}/${id}/complete`, {}),
  templates: () => get<BrandscriptTemplate[]>('/api/brandscript-templates'),
};

// ═══ DISCOVERY INGESTION ═══

export const discovery = {
  listSources: (wsId: string) => get<DiscoverySource[]>(`/api/discovery/${wsId}/sources`),
  uploadFiles: (wsId: string, files: File[], sourceType: string) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('sourceType', sourceType);
    return postForm<{ sources: DiscoverySource[] }>(`/api/discovery/${wsId}/sources`, fd);
  },
  uploadText: (wsId: string, body: { filename?: string; sourceType?: string; rawContent: string }) =>
    post<DiscoverySource>(`/api/discovery/${wsId}/sources/text`, body),
  deleteSource: (wsId: string, id: string) => del(`/api/discovery/${wsId}/sources/${id}`),
  process: (wsId: string, sourceId: string) =>
    post<{ extractions: DiscoveryExtraction[] }>(`/api/discovery/${wsId}/sources/${sourceId}/process`, {}),
  listExtractions: (wsId: string) => get<DiscoveryExtraction[]>(`/api/discovery/${wsId}/extractions`),
  listExtractionsBySource: (wsId: string, sourceId: string) =>
    get<DiscoveryExtraction[]>(`/api/discovery/${wsId}/sources/${sourceId}/extractions`),
  updateExtraction: (wsId: string, id: string, body: { status?: string; routedTo?: string; content?: string }) =>
    patch<{ updated: boolean }>(`/api/discovery/${wsId}/extractions/${id}`, body),
};

// ═══ VOICE CALIBRATION ═══

export const voice = {
  getProfile: (wsId: string) => get<VoiceProfile & { samples: VoiceSample[] }>(`/api/voice/${wsId}`),
  updateProfile: (wsId: string, body: Partial<Pick<VoiceProfile, 'voiceDNA' | 'guardrails' | 'contextModifiers'>>) => patch<VoiceProfile>(`/api/voice/${wsId}`, body),
  addSample: (wsId: string, body: { content: string; contextTag?: string; source?: string }) =>
    post<VoiceSample>(`/api/voice/${wsId}/samples`, body),
  deleteSample: (wsId: string, sampleId: string) => del(`/api/voice/${wsId}/samples/${sampleId}`),
  calibrate: (wsId: string, body: { promptType: string; steeringNotes?: string }) =>
    post<CalibrationSession>(`/api/voice/${wsId}/calibrate`, body),
  refine: (wsId: string, sessionId: string, body: { variationIndex: number; direction: string }) =>
    post<CalibrationSession>(`/api/voice/${wsId}/calibrate/${sessionId}/refine`, body),
};

// ═══ BRAND IDENTITY ═══

export const identity = {
  list: (wsId: string) => get<BrandDeliverable[]>(`/api/brand-identity/${wsId}`),
  generate: (wsId: string, body: { deliverableType: string }) =>
    post<BrandDeliverable>(`/api/brand-identity/${wsId}/generate`, body),
  refine: (wsId: string, id: string, body: { direction: string }) =>
    post<BrandDeliverable>(`/api/brand-identity/${wsId}/${id}/refine`, body),
  updateStatus: (wsId: string, id: string, status: 'approved' | 'draft') =>
    patch<BrandDeliverable>(`/api/brand-identity/${wsId}/${id}`, { status }),
  /**
   * Export approved deliverables. Server responds with raw `text/markdown`, not
   * JSON — we wrap the string in `{ markdown }` here so callers keep a stable
   * shape regardless of the server's response encoding.
   */
  export: async (wsId: string, tier?: string): Promise<{ markdown: string }> => {
    const markdown = await getText(`/api/brand-identity/${wsId}/export${tier ? `?tier=${tier}` : ''}`);
    return { markdown };
  },
};

// ═══ PAGE STRATEGY ═══

export const blueprints = {
  list: (wsId: string) =>
    get<SiteBlueprint[]>(`/api/page-strategy/${wsId}`),

  getById: (wsId: string, blueprintId: string) =>
    get<SiteBlueprint>(`/api/page-strategy/${wsId}/${blueprintId}`),

  create: (wsId: string, body: { name: string; brandscriptId?: string; industryType?: string; notes?: string }) =>
    post<SiteBlueprint>(`/api/page-strategy/${wsId}`, body),

  update: (wsId: string, blueprintId: string, body: Partial<Pick<SiteBlueprint, 'name' | 'status' | 'brandscriptId' | 'industryType' | 'notes'>>) =>
    put<SiteBlueprint>(`/api/page-strategy/${wsId}/${blueprintId}`, body),

  remove: (wsId: string, blueprintId: string) =>
    del(`/api/page-strategy/${wsId}/${blueprintId}`),

  generate: (wsId: string, body: BlueprintGenerationInput) =>
    post<SiteBlueprint>(`/api/page-strategy/${wsId}/generate`, body),
};

type BlueprintEntryCreateBody = {
  name: string;
  pageType: string;
  scope?: BlueprintEntry['scope'];
  isCollection?: boolean;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  keywordSource?: BlueprintEntry['keywordSource'];
  sectionPlan?: BlueprintEntry['sectionPlan'];
  templateId?: string;
  matrixId?: string;
  notes?: string;
};

type BlueprintEntryUpdateBody = Partial<Pick<BlueprintEntry,
  'name' | 'pageType' | 'scope' | 'isCollection' | 'primaryKeyword' |
  'secondaryKeywords' | 'keywordSource' | 'sectionPlan' | 'templateId' |
  'matrixId' | 'briefId' | 'notes'
>>;

export const blueprintEntries = {
  add: (wsId: string, blueprintId: string, body: BlueprintEntryCreateBody) =>
    post<BlueprintEntry>(`/api/page-strategy/${wsId}/${blueprintId}/entries`, body),

  update: (wsId: string, blueprintId: string, entryId: string, body: BlueprintEntryUpdateBody) =>
    put<BlueprintEntry>(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`, body),

  remove: (wsId: string, blueprintId: string, entryId: string) =>
    del(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`),

  reorder: (wsId: string, blueprintId: string, orderedIds: string[]) =>
    put<{ reordered: boolean }>(`/api/page-strategy/${wsId}/${blueprintId}/entries/reorder`, { orderedIds }),
};

export const blueprintVersions = {
  list: (wsId: string, blueprintId: string) =>
    get<BlueprintVersion[]>(`/api/page-strategy/${wsId}/${blueprintId}/versions`),

  create: (wsId: string, blueprintId: string, changeNotes?: string) =>
    post<BlueprintVersion>(`/api/page-strategy/${wsId}/${blueprintId}/versions`, { changeNotes }),

  getById: (wsId: string, blueprintId: string, versionId: string) =>
    get<BlueprintVersion>(`/api/page-strategy/${wsId}/${blueprintId}/versions/${versionId}`),
};
