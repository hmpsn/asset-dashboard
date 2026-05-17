import { useState, useCallback, useRef, useMemo } from 'react';
import {
  ArrowLeft, Plus, X, GripVertical, ChevronDown, ChevronUp,
  Eye, Save, FileText, Variable, Link2, Search, Type,
} from 'lucide-react';
import { SectionCard, Badge, Button, IconButton, ClickableRow, FormInput, FormSelect, FormTextarea } from '../ui';
import type { ContentTemplate, TemplateVariable, TemplateSection } from './types';
import { MOCK_TEMPLATE } from './mockData';

interface TemplateEditorProps {
  workspaceId: string;
  templateId?: string;
  onSave: (template: ContentTemplate) => void;
  onCancel: () => void;
}

const PAGE_TYPES: ContentTemplate['pageType'][] = [
  'blog', 'landing', 'service', 'location', 'product',
  'pillar', 'resource', 'provider-profile', 'procedure-guide', 'pricing-page',
];

const SAMPLE_VALUES: Record<string, string> = {
  city: 'Austin',
  service: 'Roofing',
  pillar: 'SEO',
  subtopic: 'Link Building',
  topic: 'Content Marketing',
  industry: 'Healthcare',
  solution: 'Patient Portal',
  brand: 'AcmeCo',
  product_a: 'Ahrefs',
  product_b: 'SEMrush',
};

function getSampleValue(varName: string, index: number): string {
  if (SAMPLE_VALUES[varName]) return SAMPLE_VALUES[varName];
  const fallbacks = ['Austin', 'Roofing', 'Dallas', 'Plumbing', 'Houston', 'HVAC'];
  return fallbacks[index % fallbacks.length] || varName;
}

function replaceVariables(pattern: string, variables: TemplateVariable[]): string {
  let result = pattern;
  for (let i = 0; i < variables.length; i++) {
    const v = variables[i];
    result = result.replaceAll(`{${v.name}}`, getSampleValue(v.name, i));
  }
  return result;
}

const VAR_COLORS = [
  { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30' },
  { bg: 'bg-teal-500/20', text: 'text-teal-300', border: 'border-teal-500/30' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30' },
];

function VariablePill({ variable, index, onRemove }: { variable: TemplateVariable; index: number; onRemove: () => void }) {
  const color = VAR_COLORS[index % VAR_COLORS.length];
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] border ${color.bg} ${color.border}`}>
      <span className={`text-xs font-mono font-semibold ${color.text}`}>{`{${variable.name}}`}</span>
      <span className="t-caption text-[var(--brand-text)]">Label: {variable.label}</span>
      {variable.description && <span className="t-caption text-[var(--brand-text-muted)]">&mdash; {variable.description}</span>}
      <IconButton
        onClick={onRemove}
        icon={X}
        label={`Remove variable ${variable.name}`}
        variant="ghost"
        size="sm"
        className="ml-auto p-0.5 rounded hover:bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
      />
    </div>
  );
}

function SectionItem({
  section,
  variables,
  isExpanded,
  onToggle,
  onUpdate,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  section: TemplateSection;
  variables: TemplateVariable[];
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<TemplateSection>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] overflow-hidden transition-colors hover:border-[var(--brand-border-hover)]"
    >
      <ClickableRow
        onClick={onToggle}
        active={isExpanded}
        className="flex items-center gap-2 px-3 py-2.5 text-left bg-transparent"
      >
        <GripVertical className="w-3.5 h-3.5 text-[var(--brand-text-muted)] cursor-grab flex-shrink-0" />
        <span className="text-xs font-semibold text-[var(--brand-text-bright)] flex-1 truncate capitalize">
          {section.name.replace(/_/g, ' ')}
        </span>
        <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0">{section.wordCountTarget} words</span>
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" />}
      </ClickableRow>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--brand-border)]">
          <div className="pt-2">
            <label className="t-caption text-[var(--brand-text-muted)] font-medium">Heading Template</label>
            <FormInput
              type="text"
              value={section.headingTemplate}
              onChange={value => onUpdate({ headingTemplate: value })}
              placeholder="e.g. {service} in {city}"
              className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
            />
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
              Preview: {replaceVariables(section.headingTemplate, variables)}
            </p>
          </div>
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] font-medium">Guidance</label>
            <FormTextarea
              value={section.guidance}
              onChange={value => onUpdate({ guidance: value })}
              placeholder="AI guidance for this section..."
              rows={2}
              className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] resize-none focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="t-caption text-[var(--brand-text-muted)] font-medium">Word Count Target</label>
              <FormInput
                type="number"
                value={section.wordCountTarget}
                onChange={value => onUpdate({ wordCountTarget: parseInt(value) || 0 })}
                min={0}
                className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] focus:border-teal-500/40 focus:outline-none transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="t-caption text-[var(--brand-text-muted)] font-medium">CMS Field Slug</label>
              <FormInput
                type="text"
                value={section.cmsFieldSlug ?? ''}
                onChange={value => onUpdate({ cmsFieldSlug: value || undefined })}
                placeholder="hero_content"
                className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button onClick={onRemove} variant="ghost" size="sm" className="t-caption-sm text-red-400 hover:text-red-300 transition-colors">
              Remove section
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TemplateEditor({ workspaceId, templateId, onSave, onCancel }: TemplateEditorProps) {
  const [loading, setLoading] = useState(false);

  const initialTemplate = useMemo(() => {
    if (!templateId) {
      return {
        id: '',
        workspaceId,
        name: '',
        description: '',
        pageType: 'service' as ContentTemplate['pageType'],
        variables: [] as TemplateVariable[],
        sections: [] as TemplateSection[],
        urlPattern: '',
        keywordPattern: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    // Mock fetch: return MOCK_TEMPLATE for dev
    return { ...MOCK_TEMPLATE };
  }, [templateId, workspaceId]);

  const [name, setName] = useState(initialTemplate.name);
  const [description, setDescription] = useState(initialTemplate.description ?? '');
  const [pageType, setPageType] = useState(initialTemplate.pageType);
  const [variables, setVariables] = useState<TemplateVariable[]>(initialTemplate.variables);
  const [sections, setSections] = useState<TemplateSection[]>(initialTemplate.sections);
  const [urlPattern, setUrlPattern] = useState(initialTemplate.urlPattern);
  const [keywordPattern, setKeywordPattern] = useState(initialTemplate.keywordPattern);
  const [toneAndStyle, setToneAndStyle] = useState(initialTemplate.toneAndStyle ?? '');

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [newVarName, setNewVarName] = useState('');
  const [newVarLabel, setNewVarLabel] = useState('');
  const [newVarDesc, setNewVarDesc] = useState('');
  const [showAddVar, setShowAddVar] = useState(false);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const totalWords = sections.reduce((sum, s) => sum + s.wordCountTarget, 0);

  const handleAddVariable = useCallback(() => {
    const trimmedName = newVarName.trim().toLowerCase().replace(/\s+/g, '_');
    const trimmedLabel = newVarLabel.trim();
    if (!trimmedName || !trimmedLabel) return;
    if (variables.some(v => v.name === trimmedName)) return;
    setVariables(prev => [...prev, { name: trimmedName, label: trimmedLabel, description: newVarDesc.trim() || undefined }]);
    setNewVarName('');
    setNewVarLabel('');
    setNewVarDesc('');
    setShowAddVar(false);
  }, [newVarName, newVarLabel, newVarDesc, variables]);

  const handleRemoveVariable = useCallback((name: string) => {
    setVariables(prev => prev.filter(v => v.name !== name));
  }, []);

  const handleAddSection = useCallback(() => {
    const id = `s_${Date.now()}`;
    const order = sections.length;
    setSections(prev => [...prev, {
      id,
      name: `section_${order + 1}`,
      headingTemplate: '',
      guidance: '',
      wordCountTarget: 150,
      order,
    }]);
    setExpandedSection(id);
  }, [sections.length]);

  const handleUpdateSection = useCallback((id: string, updates: Partial<TemplateSection>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const handleRemoveSection = useCallback((id: string) => {
    setSections(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i })));
    if (expandedSection === id) setExpandedSection(null);
  }, [expandedSection]);

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverItem.current = index;
  }, []);

  const handleDrop = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const from = dragItem.current;
    const to = dragOverItem.current;
    if (from === to) return;
    setSections(prev => {
      const updated = [...prev];
      const [removed] = updated.splice(from, 1);
      updated.splice(to, 0, removed);
      return updated.map((s, i) => ({ ...s, order: i }));
    });
    dragItem.current = null;
    dragOverItem.current = null;
  }, []);

  const handleSave = useCallback(() => {
    if (!name.trim()) return;
    setLoading(true);
    const template: ContentTemplate = {
      id: templateId ?? `tpl_${Date.now()}`,
      workspaceId,
      name: name.trim(),
      description: description.trim() || undefined,
      pageType,
      variables,
      sections,
      urlPattern,
      keywordPattern,
      toneAndStyle: toneAndStyle.trim() || undefined,
      createdAt: initialTemplate.createdAt,
      updatedAt: new Date().toISOString(),
    };
    // Mock save — in production this would POST/PUT to the API
    setTimeout(() => {
      setLoading(false);
      onSave(template);
    }, 300);
  }, [name, description, pageType, variables, sections, urlPattern, keywordPattern, toneAndStyle, templateId, workspaceId, initialTemplate.createdAt, onSave]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button onClick={onCancel} variant="ghost" size="sm" className="text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Templates
        </Button>
      </div>

      {/* Name / Description / Page Type */}
      <SectionCard title={templateId ? 'Edit Template' : 'New Template'} titleIcon={<FileText className="w-4 h-4 text-teal-400" />}>
        <div className="space-y-3">
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] font-medium">Template Name</label>
            <FormInput
              type="text"
              value={name}
              onChange={setName}
              placeholder="e.g. Service \u00d7 Location Page"
              className="w-full mt-1 px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] font-medium">Description</label>
            <FormInput
              type="text"
              value={description}
              onChange={setDescription}
              placeholder="What is this template for?"
              className="w-full mt-1 px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] font-medium">Page Type</label>
            <FormSelect
              value={pageType}
              onChange={value => setPageType(value as ContentTemplate['pageType'])}
              options={PAGE_TYPES.map(pt => ({
                value: pt,
                label: pt.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              }))}
              className="w-full mt-1 px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
        </div>
      </SectionCard>

      {/* Two-column: Variables + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Variables panel */}
        <SectionCard title="Variables" titleIcon={<Variable className="w-4 h-4 text-blue-400" />}>
          <div className="space-y-2">
            {variables.map((v, i) => (
              <VariablePill key={v.name} variable={v} index={i} onRemove={() => handleRemoveVariable(v.name)} />
            ))}

            {showAddVar ? (
              <div className="bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <FormInput
                      type="text"
                      value={newVarName}
                      onChange={setNewVarName}
                      placeholder="Variable name (e.g. city)"
                      className="w-full px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <FormInput
                      type="text"
                      value={newVarLabel}
                      onChange={setNewVarLabel}
                      placeholder="Display label (e.g. City)"
                      className="w-full px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
                <FormInput
                  type="text"
                  value={newVarDesc}
                  onChange={setNewVarDesc}
                  placeholder="Description (optional)"
                  className="w-full px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
                />
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={handleAddVariable}>
                    Add
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowAddVar(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setShowAddVar(true)}
                variant="ghost"
                size="sm"
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Variable
              </Button>
            )}

            <div className="pt-3 space-y-2 border-t border-[var(--brand-border)]">
              <div>
                <label className="t-caption text-[var(--brand-text-muted)] font-medium flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> URL Pattern
                </label>
                <FormInput
                  type="text"
                  value={urlPattern}
                  onChange={setUrlPattern}
                  placeholder="/services/{city}/{service}"
                  className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] font-mono placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
                />
                {urlPattern && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 font-mono">{replaceVariables(urlPattern, variables)}</p>
                )}
              </div>
              <div>
                <label className="t-caption text-[var(--brand-text-muted)] font-medium flex items-center gap-1">
                  <Search className="w-3 h-3" /> Keyword Pattern
                </label>
                <FormInput
                  type="text"
                  value={keywordPattern}
                  onChange={setKeywordPattern}
                  placeholder="{service} in {city}"
                  className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] font-mono placeholder-[var(--brand-text-muted)] focus:border-teal-500/40 focus:outline-none transition-colors"
                />
                {keywordPattern && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 font-mono">{replaceVariables(keywordPattern, variables)}</p>
                )}
              </div>
              <div>
                <label className="t-caption text-[var(--brand-text-muted)] font-medium flex items-center gap-1">
                  <Type className="w-3 h-3" /> Tone & Style
                </label>
                <FormTextarea
                  value={toneAndStyle}
                  onChange={setToneAndStyle}
                  placeholder="Optional brand voice override..."
                  rows={2}
                  className="w-full mt-1 px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] resize-none focus:border-teal-500/40 focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Live Preview */}
        <SectionCard title="Preview" titleIcon={<Eye className="w-4 h-4 text-teal-400" />}>
          <div className="space-y-3">
            {keywordPattern && (
              <div>
                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">
                  {replaceVariables(keywordPattern, variables)}
                </p>
                <p className="t-caption text-[var(--brand-text-muted)] font-mono mt-0.5">
                  {urlPattern ? replaceVariables(urlPattern, variables) : 'No URL pattern set'}
                </p>
              </div>
            )}

            {sections.length > 0 ? (
              <div className="space-y-2">
                {sections.map(s => (
                  <div key={s.id} className="flex items-start gap-2 py-1.5 border-b border-[var(--brand-border)] last:border-0">
                    <span className="t-caption text-[var(--brand-text-muted)] mt-0.5">&sect;</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--brand-text)]">
                        {replaceVariables(s.headingTemplate, variables) || s.name.replace(/_/g, ' ')}
                      </p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)]">{s.wordCountTarget} words</p>
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-[var(--brand-border)]">
                  <p className="text-xs text-[var(--brand-text)]">
                    Total: ~{totalWords.toLocaleString()} words ({sections.length} section{sections.length !== 1 ? 's' : ''})
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--brand-text-muted)] py-4 text-center">Add sections below to see a preview</p>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Sections */}
      <SectionCard
        title="Sections"
        titleExtra={<Badge label={`${sections.length}`} tone="zinc" />}
        titleIcon={<FileText className="w-4 h-4 text-amber-400" />}
        action={
          <span className="t-caption text-[var(--brand-text-muted)]">Drag to reorder</span>
        }
      >
        <div className="space-y-2">
          {sections.map((s, i) => (
            <SectionItem
              key={s.id}
              section={s}
              variables={variables}
              isExpanded={expandedSection === s.id}
              onToggle={() => setExpandedSection(expandedSection === s.id ? null : s.id)}
              onUpdate={updates => handleUpdateSection(s.id, updates)}
              onRemove={() => handleRemoveSection(s.id)}
              onDragStart={() => handleDragStart(i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={handleDrop}
            />
          ))}
          <Button
            onClick={handleAddSection}
            variant="ghost"
            size="sm"
            className="w-full py-2.5 rounded-[var(--radius-lg)] border border-dashed border-[var(--brand-border-hover)] text-xs text-[var(--brand-text)] hover:text-teal-400 hover:border-teal-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Section
          </Button>
        </div>
      </SectionCard>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          icon={Save}
          onClick={handleSave}
          disabled={!name.trim() || loading}
          loading={loading}
        >
          {loading ? 'Saving...' : 'Save Template'}
        </Button>
      </div>
    </div>
  );
}
