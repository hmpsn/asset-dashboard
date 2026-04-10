// src/api/brand-engine.ts
import { get, post, put, patch, del, postForm } from './client';
import type {
  Brandscript, BrandscriptTemplate,
  DiscoverySource, DiscoveryExtraction,
  VoiceProfile, VoiceSample, CalibrationSession,
  BrandDeliverable,
} from '../../shared/types/brand-engine';

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
  updateStatus: (wsId: string, id: string, status: string) =>
    patch<BrandDeliverable>(`/api/brand-identity/${wsId}/${id}`, { status }),
  export: (wsId: string, tier?: string) =>
    get<{ markdown: string }>(`/api/brand-identity/${wsId}/export${tier ? `?tier=${tier}` : ''}`),
};
