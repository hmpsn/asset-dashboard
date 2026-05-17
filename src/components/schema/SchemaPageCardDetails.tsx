import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, ShieldCheck, Star } from 'lucide-react';
import type { ValidationFinding } from '../../../shared/types/schema-validation';
import type { SchemaGenerationDiagnostics } from '../../../shared/types/schema-generation';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { RichResultEligibility } from './schemaSuggesterTypes';
import { Badge, Icon, cn, Button } from '../ui';

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
          <Badge key={index} label={schema} tone="emerald" variant="outline" shape="sm" size="md" className="font-mono" />
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
                <span aria-hidden="true" className="t-micro font-semibold shrink-0">{badge}</span>
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
                  <span aria-hidden="true" className="t-micro font-semibold shrink-0">{fieldBadge}</span>
                  <span>{finding.message}</span>
                </div>
              );
            });
          }

          return (
            <div key={field}>
              <Button
                type="button"
                onClick={() => setExpandedField(expanded ? null : field)}
                aria-expanded={expanded}
                variant="ghost"
                size="sm"
                className={`w-full h-auto px-0 py-0 justify-start gap-2 text-left ${colorClass} t-caption-sm hover:opacity-80 hover:bg-transparent`}
              >
                <span aria-hidden="true" className="t-micro font-semibold shrink-0">{badge}</span>
                <span className="truncate">{field} ({fieldFindings.length})</span>
                <span aria-hidden="true" className="text-[var(--brand-text-muted)] shrink-0">{expanded ? '▾' : '▸'}</span>
              </Button>
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
          <Badge
            label={recommendation.priority.replace('_', ' ')}
            tone={recommendation.priority === 'fix_now' ? 'red' : recommendation.priority === 'fix_soon' ? 'amber' : 'zinc'}
            variant="soft"
            shape="sm"
            size="sm"
            className="flex-shrink-0"
          />
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
          <Badge key={index} label={type} tone="teal" variant="outline" shape="sm" size="md" className="font-mono" />
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
        <Badge
          label={`${diagnostics.roleSource === 'auto-detect'
            ? 'Auto-detected'
            : diagnostics.roleSource === 'site-plan'
              ? 'Site plan'
              : diagnostics.roleSource === 'collection-map'
                ? 'Collection map'
                : diagnostics.roleSource === 'collection-inferred'
                  ? 'Collection inferred'
                  : diagnostics.roleSource === 'saved-page-type'
                    ? 'Saved page type'
                    : 'UI override'}${diagnostics.effectiveRole ? `: ${diagnostics.effectiveRole}` : ''}`}
          tone="zinc"
          variant="outline"
          shape="sm"
          size="md"
        />
        <Badge
          label={diagnostics.validationStatus}
          tone={diagnostics.validationStatus === 'errors' ? 'red' : diagnostics.validationStatus === 'warnings' ? 'amber' : 'emerald'}
          variant="outline"
          shape="sm"
          size="md"
        />
      </div>
      {diagnostics.collection && (
        <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">
          Collection: <span className="text-[var(--brand-text)]">{diagnostics.collection.collectionName}</span>
          {diagnostics.collection.itemPath ? ` · ${diagnostics.collection.itemPath}` : ''}
        </div>
      )}
      {diagnostics.canonicalEntityReferences && diagnostics.canonicalEntityReferences.length > 0 && (
        <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1 break-words">
          Canonical refs: <span className="text-[var(--brand-text)]">{diagnostics.canonicalEntityReferences.join(', ')}</span>
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
            <Badge
              key={`${evidence.field}-${index}`}
              label={`${evidence.field}: ${evidence.status ?? evidence.source}`}
              tone={evidence.status === 'resolved' || evidence.status === 'fallback-used' ? 'blue' : 'amber'}
              variant="outline"
              shape="sm"
              size="md"
              ariaLabel={evidence.message}
            />
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
            <Badge key={index} label={`${result.type}: ${result.feature}`} tone="emerald" variant="outline" shape="sm" size="md" icon={CheckCircle} ariaLabel={`Eligible for: ${result.feature}`} />
          ) : (
            <Badge key={index} label={`${result.type}: missing ${result.missingFields?.join(', ')}`} tone="amber" variant="outline" shape="sm" size="md" icon={AlertCircle} ariaLabel={`Missing for ${result.feature}: ${result.missingFields?.join(', ')}`} />
          )
        ))}
      </div>
    </div>
  );
}
