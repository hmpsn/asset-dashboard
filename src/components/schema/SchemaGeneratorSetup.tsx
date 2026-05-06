import { useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Database, HelpCircle, Loader2, Sparkles, X } from 'lucide-react';
import type { BusinessProfileContact } from '../../../shared/types/workspace';
import type { SchemaFieldTarget } from '../../../shared/types/site-inventory';
import { SCHEMA_ROLE_INDEX, SCHEMA_ROLE_LABELS } from '../../../shared/types/schema-plan';
import { adminPath } from '../../routes';
import { Icon } from '../ui';
import type { SchemaMappingCollection, SchemaPageOption } from './schemaSuggesterTypes';

export const SCHEMA_PAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  ...Object.entries(SCHEMA_ROLE_LABELS).map(([value, label]) => ({ value, label })),
];

interface SchemaBusinessProfileCalloutProps {
  businessProfile?: BusinessProfileContact | null;
  dismissed: boolean;
  workspaceId?: string;
  onDismiss: () => void;
}

export function SchemaBusinessProfileCallout({
  businessProfile,
  dismissed,
  workspaceId,
  onDismiss,
}: SchemaBusinessProfileCalloutProps) {
  const showCallout = !dismissed && !!workspaceId && !(businessProfile?.address?.street || businessProfile?.address?.city);

  if (!showCallout) {
    return null;
  }

  return (
    <div role="alert" className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
      <AlertTriangle size={16} className="text-accent-warning flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="t-body text-accent-warning font-medium mb-1">Your business profile is incomplete</p>
        <p className="t-caption text-[var(--brand-text-muted)]">
          Add your address to unlock LocalBusiness schema on your homepage, /contact, and /about — the highest-value schema type for local businesses.
        </p>
        {workspaceId && (
          <Link
            to={adminPath(workspaceId, 'workspace-settings') + '?tab=business-profile'}
            className="t-caption text-accent-brand hover:text-accent-brand mt-2 inline-block"
          >
            Complete business profile →
          </Link>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface SchemaGeneratorHeroProps {
  loadingCmsPages: boolean;
  onRunScan: () => void;
  onFetchCmsTemplatePages: () => void;
}

export function SchemaGeneratorHero({
  loadingCmsPages,
  onRunScan,
  onFetchCmsTemplatePages,
}: SchemaGeneratorHeroProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-4">
      <div className="w-14 h-14 rounded-[var(--radius-xl)] bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
        <Icon as={Sparkles} size="2xl" className="text-accent-brand" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="t-body font-medium text-[var(--brand-text-bright)]">Schema Generator</p>
        <p className="t-caption text-[var(--brand-text-muted)] max-w-sm">Generate optimized JSON-LD structured data. Optionally set page types below for more accurate schemas, then generate.</p>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={onRunScan}
          className="flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-md)] t-body font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
        >
          <Icon as={Sparkles} size="md" /> Generate All Pages
        </button>
        <button
          onClick={onFetchCmsTemplatePages}
          disabled={loadingCmsPages}
          className="flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-md)] t-body font-medium bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-accent-warning border border-amber-500/30 transition-colors disabled:opacity-50"
        >
          {loadingCmsPages ? <Icon as={Loader2} size="md" className="animate-spin" /> : <Icon as={Database} size="md" />} CMS Templates
        </button>
      </div>
    </div>
  );
}

interface SchemaInitialPageTypePickerProps {
  availablePages: SchemaPageOption[];
  filteredPages: SchemaPageOption[];
  pageSearch: string;
  pageTypes: Record<string, string>;
  loadingPages: boolean;
  generatingSingle: string | null;
  onPageSearchChange: (value: string) => void;
  onPageTypesChange: Dispatch<SetStateAction<Record<string, string>>>;
  onGenerateSinglePage: (pageId: string) => void;
}

export function SchemaInitialPageTypePicker({
  availablePages,
  filteredPages,
  pageSearch,
  pageTypes,
  loadingPages,
  generatingSingle,
  onPageSearchChange,
  onPageTypesChange,
  onGenerateSinglePage,
}: SchemaInitialPageTypePickerProps) {
  const [showTypeGuide, setShowTypeGuide] = useState(false);

  if (loadingPages) {
    return (
      <div className="flex items-center justify-center py-6 gap-2 text-[var(--brand-text-muted)] t-caption">
        <Icon as={Loader2} size="md" className="animate-spin" /> Loading pages...
      </div>
    );
  }

  if (availablePages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="t-caption text-[var(--brand-text-muted)]">{availablePages.length} pages — set page types for better AI prompts</span>
          <button
            onClick={() => setShowTypeGuide(value => !value)}
            className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            title="Page Type Guide"
          >
            <Icon as={HelpCircle} size="sm" />
            Guide
          </button>
        </div>
        <input
          type="text"
          value={pageSearch}
          onChange={event => onPageSearchChange(event.target.value)}
          placeholder="Filter pages..."
          className="px-3 py-1 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text)] w-48 focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      </div>
      {showTypeGuide && <SchemaPageTypeGuide />}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden max-h-[400px] overflow-y-auto" style={{ borderRadius: 'var(--radius-signature)' }}>
        {filteredPages.map(page => (
          <div key={page.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--brand-border)]/50 last:border-b-0 hover:bg-[var(--surface-3)]/30 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="t-caption text-[var(--brand-text)] truncate">{page.title}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">/{page.slug}</div>
            </div>
            <select
              value={pageTypes[page.id] || 'auto'}
              onChange={event => {
                const pageType = event.target.value;
                onPageTypesChange(prev => ({ ...prev, [page.id]: pageType }));
              }}
              className="px-2 py-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              {SCHEMA_PAGE_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              onClick={() => onGenerateSinglePage(page.id)}
              disabled={generatingSingle === page.id}
              className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-md)] t-caption-sm text-accent-brand bg-teal-600/10 border border-teal-500/20 hover:bg-teal-600/20 transition-colors disabled:opacity-50"
            >
              {generatingSingle === page.id ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Sparkles} size="sm" />}
              Generate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SchemaPageTypeGuide() {
  return (
    <div className="bg-[var(--surface-1)]/50 rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden max-h-[280px] overflow-y-auto">
      {SCHEMA_PAGE_TYPE_OPTIONS.filter(option => option.value !== 'auto').map(option => {
        const info = SCHEMA_ROLE_INDEX[option.value as keyof typeof SCHEMA_ROLE_INDEX];
        if (!info) return null;
        return (
          <div key={option.value} className="px-3 py-2 border-b border-[var(--brand-border)]/50 last:border-b-0">
            <span className="t-caption-sm font-medium text-[var(--brand-text)]">{option.label}</span>
            <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">{info.description}</p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {info.examples.map((example: string) => (
                <code key={example} className="t-mono text-xs text-[var(--brand-text-muted)] bg-[var(--surface-3)]/60 px-1 py-0.5 rounded-[var(--radius-sm)]">{example}</code>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface SchemaCmsFieldMappingPanelProps {
  collections: SchemaMappingCollection[];
  cmsMappingError: string | null;
  savingCmsMapping: string | null;
  fieldMappingTargets: Array<{
    target: SchemaFieldTarget;
    label: string;
    roles: Array<'location' | 'service'>;
  }>;
  onSaveCmsFieldMapping: (collection: SchemaMappingCollection, target: SchemaFieldTarget, value: string) => void;
  maxCollections: number;
}

export function SchemaCmsFieldMappingPanel({
  collections,
  cmsMappingError,
  savingCmsMapping,
  fieldMappingTargets,
  onSaveCmsFieldMapping,
  maxCollections,
}: SchemaCmsFieldMappingPanelProps) {
  if (collections.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 space-y-3">
      <div>
        <p className="t-body text-[var(--brand-text)] font-medium">Collection field mapping</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Detected CMS fields can be corrected here so Locations and Services resolve human-readable schema data.
        </p>
        {cmsMappingError && (
          <p className="t-caption-sm text-amber-300 mt-1">{cmsMappingError}</p>
        )}
      </div>
      {collections.slice(0, maxCollections).map(collection => (
        <div key={collection.collectionId} className="border-t border-[var(--brand-border)]/60 pt-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="t-caption text-[var(--brand-text)]">{collection.collectionName}</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">{collection.schemaRole}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fieldMappingTargets.filter(target => target.roles.includes(collection.schemaRole)).map(({ target, label }) => {
              const selected = collection.mapping?.fieldMappings?.[target]
                ?? collection.fields.find(field => field.target === target)?.slug
                ?? '';
              return (
                <label key={target} className="block">
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{label}</span>
                  <select
                    value={selected}
                    disabled={savingCmsMapping === `${collection.collectionId}:${target}`}
                    onChange={event => onSaveCmsFieldMapping(collection, target, event.target.value)}
                    className="mt-1 w-full px-2 py-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    <option value="">Not mapped</option>
                    {collection.fields.map(field => (
                      <option key={field.slug} value={field.slug}>
                        {field.displayName || field.slug} ({field.type})
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
