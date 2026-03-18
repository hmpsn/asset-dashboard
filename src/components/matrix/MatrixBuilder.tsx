import { useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft, ArrowRight, Check, FileText, Layers, Tag,
  Eye, Sparkles, X,
} from 'lucide-react';
import { SectionCard, Badge, PageHeader } from '../ui';
import type { ContentTemplate, ContentMatrix, MatrixDimension, MatrixCell } from './types';

interface MatrixBuilderProps {
  workspaceId: string;
  templates: ContentTemplate[];
  onComplete: (matrix: ContentMatrix) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: 'Choose Template',
  2: 'Define Values',
  3: 'Review & Customize',
  4: 'Confirm',
};

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2">
      {([1, 2, 3, 4] as Step[]).map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          {i > 0 && <div className={`w-8 h-px ${step <= current ? 'bg-teal-500/50' : 'bg-zinc-700'}`} />}
          <div className="flex items-center gap-1.5">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
              step < current ? 'bg-teal-500 text-white' :
              step === current ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40' :
              'bg-zinc-800 text-zinc-500'
            }`}>
              {step < current ? <Check className="w-3 h-3" /> : step}
            </div>
            <span className={`text-[11px] font-medium hidden sm:inline ${step === current ? 'text-zinc-200' : 'text-zinc-500'}`}>
              {STEP_LABELS[step]}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateCard({ template, isSelected, onSelect }: { template: ContentTemplate; isSelected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        isSelected
          ? 'bg-teal-500/10 border-teal-500/30 ring-2 ring-teal-400'
          : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-zinc-200">{template.name}</span>
        <Badge label={template.pageType.replace(/-/g, ' ')} color="teal" />
      </div>
      {template.description && (
        <p className="text-xs text-zinc-400 mb-3">{template.description}</p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {template.variables.length} variable{template.variables.length !== 1 ? 's' : ''}</span>
        <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {template.sections.length} section{template.sections.length !== 1 ? 's' : ''}</span>
      </div>
    </button>
  );
}

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (vals: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      const newValues = input.split(',').map(v => v.trim()).filter(v => v && !values.includes(v));
      if (newValues.length > 0) onChange([...values, ...newValues]);
      setInput('');
    }
    if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.includes(',') || text.includes('\n')) {
      e.preventDefault();
      const newValues = text.split(/[,\n]/).map(v => v.trim()).filter(v => v && !values.includes(v));
      if (newValues.length > 0) onChange([...values, ...newValues]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-950 border border-zinc-800 rounded-lg min-h-[42px] focus-within:border-teal-500/40 transition-colors">
      {values.map(val => (
        <span key={val} className="flex items-center gap-1 px-2 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-xs text-teal-300">
          {val}
          <button onClick={() => onChange(values.filter(v => v !== val))} className="hover:text-red-400 transition-colors">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={values.length === 0 ? placeholder : 'Add more...'}
        className="flex-1 min-w-[100px] bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none"
      />
    </div>
  );
}

export function MatrixBuilder({ workspaceId, templates, onComplete, onCancel }: MatrixBuilderProps) {
  const [step, setStep] = useState<Step>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [dimensionValues, setDimensionValues] = useState<Record<string, string[]>>({});
  const [matrixName, setMatrixName] = useState('');
  const [cellKeywordOverrides, setCellKeywordOverrides] = useState<Record<string, string>>({});

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null;

  // Generate preview cells from cross-product
  const previewCells = useMemo<MatrixCell[]>(() => {
    if (!selectedTemplate) return [];
    const vars = selectedTemplate.variables;
    if (vars.length === 0) return [];

    const dimensions = vars.map(v => ({
      variableName: v.name,
      values: dimensionValues[v.name] ?? [],
    }));

    // Cross-product
    function crossProduct(dims: { variableName: string; values: string[] }[]): Record<string, string>[] {
      if (dims.length === 0) return [{}];
      const [first, ...rest] = dims;
      const restCombos = crossProduct(rest);
      const results: Record<string, string>[] = [];
      for (const val of first.values) {
        for (const combo of restCombos) {
          results.push({ [first.variableName]: val, ...combo });
        }
      }
      return results;
    }

    const combos = crossProduct(dimensions);
    return combos.map((vars, i) => {
      let keyword = selectedTemplate.keywordPattern;
      let url = selectedTemplate.urlPattern;
      for (const [key, val] of Object.entries(vars)) {
        keyword = keyword.replaceAll(`{${key}}`, val.toLowerCase());
        url = url.replaceAll(`{${key}}`, val.toLowerCase().replace(/\s+/g, '-'));
      }
      const cellId = `preview_${i}`;
      return {
        id: cellId,
        variableValues: vars,
        targetKeyword: cellKeywordOverrides[cellId] || keyword,
        plannedUrl: url,
        status: 'planned' as const,
      };
    });
  }, [selectedTemplate, dimensionValues, cellKeywordOverrides]);

  const totalPages = previewCells.length;
  const totalWords = selectedTemplate
    ? totalPages * selectedTemplate.sections.reduce((sum, s) => sum + s.wordCountTarget, 0)
    : 0;

  const dimensionSummary = selectedTemplate
    ? selectedTemplate.variables
        .map(v => `${(dimensionValues[v.name] ?? []).length} ${v.label.toLowerCase()}${(dimensionValues[v.name] ?? []).length !== 1 ? 's' : ''}`)
        .join(' \u00d7 ')
    : '';

  const canProceed = useCallback((): boolean => {
    switch (step) {
      case 1: return selectedTemplateId !== null;
      case 2: return selectedTemplate !== null && selectedTemplate.variables.every(v => (dimensionValues[v.name] ?? []).length > 0);
      case 3: return totalPages > 0;
      case 4: return matrixName.trim().length > 0;
      default: return false;
    }
  }, [step, selectedTemplateId, selectedTemplate, dimensionValues, totalPages, matrixName]);

  const handleComplete = () => {
    if (!selectedTemplate || !matrixName.trim()) return;

    const dimensions: MatrixDimension[] = selectedTemplate.variables.map(v => ({
      variableName: v.name,
      label: v.label,
      values: dimensionValues[v.name] ?? [],
    }));

    const cells: MatrixCell[] = previewCells.map(c => ({ ...c, id: `cell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }));

    const matrix: ContentMatrix = {
      id: `mtx_${Date.now()}`,
      workspaceId,
      name: matrixName.trim(),
      templateId: selectedTemplate.id,
      dimensions,
      urlPattern: selectedTemplate.urlPattern,
      keywordPattern: selectedTemplate.keywordPattern,
      cells,
      stats: {
        total: cells.length,
        planned: cells.length,
        briefGenerated: 0,
        drafted: 0,
        reviewed: 0,
        published: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onComplete(matrix);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <PageHeader
          title="Create Content Matrix"
          subtitle="Build a matrix of planned pages from a template"
          icon={<Layers className="w-5 h-5 text-teal-400" />}
        />
        <button onClick={onCancel} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          Cancel
        </button>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Step content */}
      {step === 1 && (
        <SectionCard title="Choose Template" titleIcon={<FileText className="w-4 h-4 text-teal-400" />}>
          {templates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  isSelected={selectedTemplateId === t.id}
                  onSelect={() => setSelectedTemplateId(t.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <FileText className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No templates available. Create a template first.</p>
            </div>
          )}
        </SectionCard>
      )}

      {step === 2 && selectedTemplate && (
        <SectionCard title="Define Values" titleIcon={<Tag className="w-4 h-4 text-blue-400" />}>
          <div className="space-y-4">
            {selectedTemplate.variables.map(v => (
              <div key={v.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-300">{v.label}</label>
                  {v.description && <span className="text-[10px] text-zinc-500">{v.description}</span>}
                </div>
                <TagInput
                  values={dimensionValues[v.name] ?? []}
                  onChange={vals => setDimensionValues(prev => ({ ...prev, [v.name]: vals }))}
                  placeholder={`Type ${v.label.toLowerCase()} values, separated by commas`}
                />
                <p className="text-[10px] text-zinc-500 mt-1">
                  {(dimensionValues[v.name] ?? []).length} value{(dimensionValues[v.name] ?? []).length !== 1 ? 's' : ''} entered
                </p>
              </div>
            ))}

            {totalPages > 0 && (
              <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-3">
                <p className="text-xs text-teal-300">
                  <Sparkles className="w-3 h-3 inline mr-1" />
                  This will generate <strong>{dimensionSummary} = {totalPages} pages</strong>
                </p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {step === 3 && (
        <SectionCard title="Review & Customize" titleIcon={<Eye className="w-4 h-4 text-amber-400" />}>
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">{totalPages} pages will be generated. Edit individual keywords if needed.</p>
            <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
              {previewCells.map(cell => {
                const varLabel = Object.values(cell.variableValues).join(' \u00d7 ');
                return (
                  <div key={cell.id} className="flex items-center gap-3 px-3 py-2 bg-zinc-950 rounded-lg border border-zinc-800">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-300 truncate">{varLabel}</p>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">{cell.plannedUrl}</p>
                    </div>
                    <input
                      type="text"
                      value={cellKeywordOverrides[cell.id] ?? cell.targetKeyword}
                      onChange={e => setCellKeywordOverrides(prev => ({ ...prev, [cell.id]: e.target.value }))}
                      className="w-48 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[11px] text-zinc-300 font-mono focus:border-teal-500/40 focus:outline-none transition-colors"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </SectionCard>
      )}

      {step === 4 && (
        <SectionCard title="Confirm" titleIcon={<Check className="w-4 h-4 text-green-400" />}>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] text-zinc-500 font-medium">Matrix Name</label>
              <input
                type="text"
                value={matrixName}
                onChange={e => setMatrixName(e.target.value)}
                placeholder="e.g. Houston Area Service Pages"
                className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
              />
            </div>

            <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{totalPages}</p>
                  <p className="text-[11px] text-zinc-500">Pages</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{totalWords.toLocaleString()}</p>
                  <p className="text-[11px] text-zinc-500">Est. Words</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{totalPages}</p>
                  <p className="text-[11px] text-zinc-500">Keywords</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{selectedTemplate?.sections.length ?? 0}</p>
                  <p className="text-[11px] text-zinc-500">Sections/Page</p>
                </div>
              </div>
              {selectedTemplate && (
                <p className="text-xs text-zinc-400 text-center">
                  Using template: <strong className="text-zinc-300">{selectedTemplate.name}</strong> &middot; {dimensionSummary}
                </p>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => step > 1 ? setStep((step - 1) as Step) : onCancel()}
          className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {step > 1 ? 'Back' : 'Cancel'}
        </button>

        {step < 4 ? (
          <button
            onClick={() => setStep((step + 1) as Step)}
            disabled={!canProceed()}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-xs text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-colors disabled:opacity-50"
          >
            Next <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={handleComplete}
            disabled={!canProceed()}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-xs text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" /> Create Matrix
          </button>
        )}
      </div>
    </div>
  );
}
