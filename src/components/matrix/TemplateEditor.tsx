import { useState, useCallback, useRef, useMemo } from 'react';
import {
  ArrowLeft, Plus, X, GripVertical, ChevronDown, ChevronUp,
  Eye, Save, FileText, Variable, Link2, Search, Type,
} from 'lucide-react';
import { SectionCard, Badge } from '../ui';
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
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${color.bg} ${color.border}`}>
      <span className={`text-xs font-mono font-semibold ${color.text}`}>{`{${variable.name}}`}</span>
      <span className="text-[11px] text-zinc-400">Label: {variable.label}</span>
      {variable.description && <span className="text-[11px] text-zinc-500">&mdash; {variable.description}</span>}
      <button onClick={onRemove} className="ml-auto p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors">
        <X className="w-3 h-3" />
      </button>
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
      className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden transition-colors hover:border-zinc-700"
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <GripVertical className="w-3.5 h-3.5 text-zinc-600 cursor-grab flex-shrink-0" />
        <span className="text-xs font-semibold text-zinc-200 flex-1 truncate capitalize">
          {section.name.replace(/_/g, ' ')}
        </span>
        <span className="text-[11px] text-zinc-500 flex-shrink-0">{section.wordCountTarget} words</span>
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-800">
          <div className="pt-2">
            <label className="text-[11px] text-zinc-500 font-medium">Heading Template</label>
            <input
              type="text"
              value={section.headingTemplate}
              onChange={e => onUpdate({ headingTemplate: e.target.value })}
              placeholder="e.g. {service} in {city}"
              className="w-full mt-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
            />
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Preview: {replaceVariables(section.headingTemplate, variables)}
            </p>
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 font-medium">Guidance</label>
            <textarea
              value={section.guidance}
              onChange={e => onUpdate({ guidance: e.target.value })}
              placeholder="AI guidance for this section..."
              rows={2}
              className="w-full mt-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-zinc-500 font-medium">Word Count Target</label>
              <input
                type="number"
                value={section.wordCountTarget}
                onChange={e => onUpdate({ wordCountTarget: parseInt(e.target.value) || 0 })}
                min={0}
                className="w-full mt-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 focus:border-teal-500/40 focus:outline-none transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] text-zinc-500 font-medium">CMS Field Slug</label>
              <input
                type="text"
                value={section.cmsFieldSlug ?? ''}
                onChange={e => onUpdate({ cmsFieldSlug: e.target.value || undefined })}
                placeholder="hero_content"
                className="w-full mt-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button onClick={onRemove} className="text-[11px] text-red-400 hover:text-red-300 transition-colors">
              Remove section
            </button>
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
        <button onClick={onCancel} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Templates
        </button>
      </div>

      {/* Name / Description / Page Type */}
      <SectionCard title={templateId ? 'Edit Template' : 'New Template'} titleIcon={<FileText className="w-4 h-4 text-teal-400" />}>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-zinc-500 font-medium">Template Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Service \u00d7 Location Page"
              className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 font-medium">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What is this template for?"
              className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 font-medium">Page Type</label>
            <select
              value={pageType}
              onChange={e => setPageType(e.target.value as ContentTemplate['pageType'])}
              className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 focus:border-teal-500/40 focus:outline-none transition-colors"
            >
              {PAGE_TYPES.map(pt => (
                <option key={pt} value={pt}>{pt.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
              ))}
            </select>
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
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={newVarName}
                      onChange={e => setNewVarName(e.target.value)}
                      placeholder="Variable name (e.g. city)"
                      className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={newVarLabel}
                      onChange={e => setNewVarLabel(e.target.value)}
                      placeholder="Display label (e.g. City)"
                      className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  value={newVarDesc}
                  onChange={e => setNewVarDesc(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
                />
                <div className="flex items-center gap-2">
                  <button onClick={handleAddVariable} className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-[11px] text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-colors">
                    Add
                  </button>
                  <button onClick={() => setShowAddVar(false)} className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddVar(true)}
                className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Variable
              </button>
            )}

            <div className="pt-3 space-y-2 border-t border-zinc-800">
              <div>
                <label className="text-[11px] text-zinc-500 font-medium flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> URL Pattern
                </label>
                <input
                  type="text"
                  value={urlPattern}
                  onChange={e => setUrlPattern(e.target.value)}
                  placeholder="/services/{city}/{service}"
                  className="w-full mt-1 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 font-mono placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
                />
                {urlPattern && (
                  <p className="text-[10px] text-zinc-600 mt-0.5 font-mono">{replaceVariables(urlPattern, variables)}</p>
                )}
              </div>
              <div>
                <label className="text-[11px] text-zinc-500 font-medium flex items-center gap-1">
                  <Search className="w-3 h-3" /> Keyword Pattern
                </label>
                <input
                  type="text"
                  value={keywordPattern}
                  onChange={e => setKeywordPattern(e.target.value)}
                  placeholder="{service} in {city}"
                  className="w-full mt-1 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 font-mono placeholder-zinc-600 focus:border-teal-500/40 focus:outline-none transition-colors"
                />
                {keywordPattern && (
                  <p className="text-[10px] text-zinc-600 mt-0.5 font-mono">{replaceVariables(keywordPattern, variables)}</p>
                )}
              </div>
              <div>
                <label className="text-[11px] text-zinc-500 font-medium flex items-center gap-1">
                  <Type className="w-3 h-3" /> Tone & Style
                </label>
                <textarea
                  value={toneAndStyle}
                  onChange={e => setToneAndStyle(e.target.value)}
                  placeholder="Optional brand voice override..."
                  rows={2}
                  className="w-full mt-1 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none focus:border-teal-500/40 focus:outline-none transition-colors"
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
                <p className="text-lg font-semibold text-zinc-100">
                  {replaceVariables(keywordPattern, variables)}
                </p>
                <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                  {urlPattern ? replaceVariables(urlPattern, variables) : 'No URL pattern set'}
                </p>
              </div>
            )}

            {sections.length > 0 ? (
              <div className="space-y-2">
                {sections.map(s => (
                  <div key={s.id} className="flex items-start gap-2 py-1.5 border-b border-zinc-800/50 last:border-0">
                    <span className="text-[11px] text-zinc-600 mt-0.5">&sect;</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-300">
                        {replaceVariables(s.headingTemplate, variables) || s.name.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[10px] text-zinc-500">{s.wordCountTarget} words</p>
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-xs text-zinc-400">
                    Total: ~{totalWords.toLocaleString()} words ({sections.length} section{sections.length !== 1 ? 's' : ''})
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 py-4 text-center">Add sections below to see a preview</p>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Sections */}
      <SectionCard
        title="Sections"
        titleExtra={<Badge label={`${sections.length}`} color="zinc" />}
        titleIcon={<FileText className="w-4 h-4 text-amber-400" />}
        action={
          <span className="text-[11px] text-zinc-500">Drag to reorder</span>
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
          <button
            onClick={handleAddSection}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-400 hover:text-teal-400 hover:border-teal-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Section
          </button>
        </div>
      </SectionCard>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || loading}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-xs text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-colors disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {loading ? 'Saving...' : 'Save Template'}
        </button>
      </div>
    </div>
  );
}
