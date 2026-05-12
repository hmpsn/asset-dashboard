import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, ShieldCheck, Star } from 'lucide-react';
import type { ValidationFinding } from '../../../shared/types/schema-validation';
import type { SchemaGenerationDiagnostics } from '../../../shared/types/schema-generation';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { RichResultEligibility } from './schemaSuggesterTypes';
import { Icon, cn } from '../ui';

export type SchemaPageCardRecommendation = Pick<Recommendation, 'id' | 'type' | 'title' | 'insight' | 'priority' | 'trafficAtRisk' | 'estimatedGain'>;

export function groupValidationFindings(findings: ValidationFinding[] = []) {
  const map = new Map<string, ValidationFinding[]>();
  for (const finding of findings) {
    const key = finding.field ?? '__noField';
    const grouped = map.get(key) ?? [];
    grouped.push(finding);
    map.set(key, grouped);
  }
  return Array.from(map.entries()).sort(([, a], [, b]) => {
    const aHasError = a.some(finding => finding.severity === 'error');
    const bHasError = b.some(finding => finding.severity === 'error');
    if (aHasError !== bHasError) return aHasError ? -1 : 1;
    return 0;
  });
}

export function ExistingSchemasSection({ schemas }: { schemas: string[] }) {
  if (schemas.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--brand-border)]/50">
      <div className="t-caption font-medium text-[var(--brand-text-muted)] mb-2">Already on page</div>
      <div className="flex flex-wrap gap-1.5">
        {schemas.map((schema, index) => (
          <span key={index} className="px-2 py-1 rounded-[var(--radius-md)] t-caption font-mono bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
            {schema}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ValidationFindingsSectionProps {
  findings?: ValidationFinding[];
  validationErrors?: string[];
}

export function ValidationFindingsSection({ findings, validationErrors }: ValidationFindingsSectionProps) {
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const findingsByField = useMemo(() => groupValidationFindings(findings), [findings]);
  const hasErrors = (validationErrors?.length || 0) > 0;

  if (findingsByField.length === 0 && !hasErrors) {
    return null;
  }

  if (findingsByField.length === 0 && hasErrors) {
    return (
      <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
        <div className="t-caption font-medium text-amber-400/80 mb-1">Validation warnings</div>
        {validationErrors!.map((error, index) => (
          <div key={index} className="t-caption-sm text-amber-300/80">• {error}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
      <div className="t-caption font-medium text-amber-400/80 mb-1">Validation findings</div>
      <div className="mt-2 space-y-1">
        {findingsByField.map(([field, fieldFindings]) => {
          const severity = fieldFindings.some(finding => finding.severity === 'error') ? 'error' : 'warning';
          const expanded = expandedField === field;
          const colorClass = severity === 'error' ? 'text-red-400' : 'text-amber-400';
          const badge = severity === 'error' ? 'Error' : 'Recommended';

          if (field !== '__noField' && fieldFindings.length === 1) {
            return (
              <div key={field} className={`${colorClass} t-caption-sm flex items-start gap-2`}>
                <span aria-hidden="true" className="font-semibold uppercase tracking-wide shrink-0" style={{ fontSize: '10px' }}>{badge}</span>
                <span>{fieldFindings[0].message}</span>
              </div>
            );
          }

          if (field === '__noField') {
            return fieldFindings.map((finding, index) => {
              const fieldSeverity = finding.severity === 'error' ? 'error' : 'warning';
              const fieldColor = fieldSeverity === 'error' ? 'text-red-400' : 'text-amber-400';
              const fieldBadge = fieldSeverity === 'error' ? 'Error' : 'Recommended';
              return (
                <div key={`__noField-${index}`} className={`${fieldColor} t-caption-sm flex items-start gap-2`}>
                  <span aria-hidden="true" className="font-semibold uppercase tracking-wide shrink-0" style={{ fontSize: '10px' }}>{fieldBadge}</span>
                  <span>{finding.message}</span>
                </div>
              );
            });
          }

          return (
            <div key={field}>
              <button
                type="button"
                onClick={() => setExpandedField(expanded ? null : field)}
                aria-expanded={expanded}
                className={`flex items-center gap-2 w-full text-left ${colorClass} t-caption-sm hover:opacity-80`}
              >
                <span aria-hidden="true" className="font-semibold uppercase tracking-wide shrink-0" style={{ fontSize: '10px' }}>{badge}</span>
                <span className="truncate">{field} ({fieldFindings.length})</span>
                <span aria-hidden="true" className="text-[var(--brand-text-muted)] shrink-0">{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded && (
                <div className="ml-4 mt-1 space-y-0.5">
                  {fieldFindings.map((finding, index) => (
                    <div key={index} className={`${colorClass} t-caption-sm`}>
                      {finding.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RecommendationBanners({ recommendations }: { recommendations: SchemaPageCardRecommendation[] }) {
  if (recommendations.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-2 border-b border-amber-500/20 bg-amber-500/5 space-y-1.5">
      {recommendations.map(recommendation => (
        <div key={recommendation.id} className="flex items-start gap-2">
          <Icon as={AlertTriangle} size="sm" className="text-amber-400/80 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="t-caption-sm font-medium text-amber-300">{recommendation.title}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)]">{recommendation.insight}</div>
            {recommendation.trafficAtRisk > 0 && (
              <div className="t-caption-sm text-amber-400/70 mt-0.5">
                {recommendation.trafficAtRisk.toLocaleString()} clicks at risk · {recommendation.estimatedGain}
              </div>
            )}
          </div>
          <span className={cn(
            'flex-shrink-0 t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] font-medium',
            recommendation.priority === 'fix_now' ? 'bg-red-500/15 text-red-400/80' :
            recommendation.priority === 'fix_soon' ? 'bg-amber-500/15 text-amber-400/80' :
            'bg-[var(--surface-3)]/15 text-[var(--brand-text-muted)]'
          )}>
            {recommendation.priority.replace('_', ' ')}
          </span>
        </div>
      ))}
    </div>
  );
}

interface GraphTypesSectionProps {
  graphTypes: string[];
  reason: string;
}

export function GraphTypesSection({ graphTypes, reason }: GraphTypesSectionProps) {
  return (
    <div className="px-4 py-2 border-b border-[var(--brand-border)]/50">
      <div className="t-caption font-medium text-[var(--brand-text-muted)] mb-1.5">@graph types</div>
      <div className="flex flex-wrap gap-1.5">
        {graphTypes.map((type, index) => (
          <span key={index} className="px-2 py-1 rounded-[var(--radius-md)] t-caption font-mono bg-teal-500/10 text-teal-300 border border-teal-500/20">
            {type}
          </span>
        ))}
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5">{reason}</p>
    </div>
  );
}

export function GenerationDiagnosticsSection({ diagnostics }: { diagnostics?: SchemaGenerationDiagnostics }) {
  if (!diagnostics) {
    return null;
  }

  return (
    <div className="px-4 py-2 border-b border-[var(--brand-border)]/50">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon as={ShieldCheck} size="sm" className="text-teal-400/80" />
        <div className="t-caption font-medium text-[var(--brand-text-muted)]">Generation diagnostics</div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        <span className="px-2 py-1 rounded-[var(--radius-md)] t-caption-sm bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
          {diagnostics.roleSource === 'auto-detect'
            ? 'Auto-detected'
            : diagnostics.roleSource === 'site-plan'
              ? 'Site plan'
              : diagnostics.roleSource === 'collection-map'
                ? 'Collection map'
                : diagnostics.roleSource === 'collection-inferred'
                  ? 'Collection inferred'
                  : diagnostics.roleSource === 'saved-page-type'
                    ? 'Saved page type'
                    : 'UI override'}
          {diagnostics.effectiveRole ? `: ${diagnostics.effectiveRole}` : ''}
        </span>
        <span className={cn(
          'px-2 py-1 rounded-[var(--radius-md)] t-caption-sm border',
          diagnostics.validationStatus === 'errors'
            ? 'bg-red-500/8 text-red-400/80 border-red-500/20'
            : diagnostics.validationStatus === 'warnings'
              ? 'bg-amber-500/8 text-amber-400/80 border-amber-500/20'
              : 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20',
        )}>
          {diagnostics.validationStatus}
        </span>
      </div>
      {diagnostics.collection && (
        <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">
          Collection: <span className="text-[var(--brand-text)]">{diagnostics.collection.collectionName}</span>
          {diagnostics.collection.itemPath ? ` · ${diagnostics.collection.itemPath}` : ''}
        </div>
      )}
      {diagnostics.cmsDeliveryStatus && diagnostics.cmsDeliveryStatus.mode === 'cms-field' && (
        <div className="mb-1 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-2 py-1.5">
          <div className="t-caption-sm font-medium text-[var(--brand-text)]">CMS delivery</div>
          <div className={cn(
            't-caption-sm',
            diagnostics.cmsDeliveryStatus.status === 'blocked' || diagnostics.cmsDeliveryStatus.status === 'failed'
              ? 'text-amber-400/80'
              : 'text-emerald-400/80',
          )}>
            {diagnostics.cmsDeliveryStatus.message}
          </div>
        </div>
      )}
      {diagnostics.fieldEvidence && diagnostics.fieldEvidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {diagnostics.fieldEvidence.slice(0, 6).map((evidence, index) => (
            <span
              key={`${evidence.field}-${index}`}
              className={cn(
                'px-2 py-1 rounded-[var(--radius-md)] t-caption-sm border',
                evidence.status === 'resolved' || evidence.status === 'fallback-used'
                  ? 'bg-blue-500/8 text-blue-300 border-blue-500/20'
                  : 'bg-amber-500/8 text-amber-300 border-amber-500/20',
              )}
              title={evidence.message}
            >
              {evidence.field}: {evidence.status ?? evidence.source}
            </span>
          ))}
        </div>
      )}
      {diagnostics.skippedSchemaTypes.length > 0 && (
        <div className="space-y-1">
          {diagnostics.skippedSchemaTypes.map((skip, index) => (
            <div key={`${skip.type}-${index}`} className="t-caption-sm text-[var(--brand-text-muted)]">
              <span className="text-amber-400/80">{skip.type}</span>: {skip.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RichResultsEligibilitySection({ eligibility }: { eligibility?: RichResultEligibility[] }) {
  if (!eligibility || eligibility.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-2 border-b border-[var(--brand-border)]/50">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon as={Star} size="sm" className="text-amber-400/80" />
        <div className="t-caption font-medium text-[var(--brand-text-muted)]">Rich Results</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {eligibility.map((result, index) => (
          result.eligible ? (
            <span key={index} className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20" title={`Eligible for: ${result.feature}`}>
              <Icon as={CheckCircle} size="sm" className="flex-shrink-0" />
              {result.type}: {result.feature}
            </span>
          ) : (
            <span key={index} className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm bg-amber-500/8 text-amber-400/80 border border-amber-500/20" title={`Missing for ${result.feature}: ${result.missingFields?.join(', ')}`}>
              <Icon as={AlertCircle} size="sm" className="flex-shrink-0" />
              {result.type}: missing {result.missingFields?.join(', ')}
            </span>
          )
        ))}
      </div>
    </div>
  );
}
