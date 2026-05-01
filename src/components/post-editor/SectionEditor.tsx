/**
 * SectionEditor — Individual content section with expand/collapse, editing, regenerate.
 * Extracted from PostEditor.tsx body sections rendering.
 */
import {
  Loader2, RefreshCw, Check, ChevronDown, ChevronUp, Pencil, Clock, AlertTriangle,
} from 'lucide-react';
import { SectionCard, Icon } from '../ui';
import { RichTextEditor } from './RichTextEditor';

interface PostSection {
  index: number;
  heading: string;
  content: string;
  wordCount: number;
  targetWordCount: number;
  keywords: string[];
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

function WordBadge({ actual, target }: { actual: number; target: number }) {
  const pct = target > 0 ? actual / target : 1;
  const color = pct >= 0.85 && pct <= 1.15 ? 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/20' :
    pct >= 0.6 ? 'text-amber-400/80 bg-amber-500/8 border-amber-500/20' :
    'text-red-400/80 bg-red-500/8 border-red-500/20';
  return <span className={`t-caption-sm px-1.5 py-0.5 rounded border ${color}`}>{actual}/{target}w</span>;
}

export interface SectionEditorProps {
  section: PostSection;
  expanded: boolean;
  editing: boolean;
  regenerating: boolean;
  isGenerating: boolean;
  saveStatus: 'idle' | 'saving' | 'saved';
  onToggleExpand: (index: number) => void;
  onStartEdit: (index: number) => void;
  onChange: (html: string) => void;
  onDone: () => Promise<void>;
  onRegenerate: (index: number) => void;
}

export function SectionEditor({
  section, expanded, editing, regenerating, isGenerating, saveStatus,
  onToggleExpand, onStartEdit, onChange, onDone, onRegenerate,
}: SectionEditorProps) {
  return (
    <SectionCard noPadding className={`overflow-hidden ${section.status === 'error' ? '!border-red-500/30' : section.status === 'generating' ? '!border-amber-500/20' : ''}`}>
      <button onClick={() => onToggleExpand(section.index)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--surface-3)]/30 transition-colors">
        <div className="flex items-center gap-2">
          {section.status === 'generating' ? <Icon as={Loader2} size="md" className="animate-spin text-amber-400/80" /> :
           section.status === 'error' ? <Icon as={AlertTriangle} size="md" className="text-red-400/80" /> :
           section.status === 'done' ? <Icon as={Check} size="md" className="text-emerald-400/80" /> :
           <Icon as={Clock} size="md" className="text-[var(--brand-text-muted)]" />}
          <span className="text-xs font-medium text-[var(--brand-text-bright)]">{section.heading}</span>
          {section.status === 'done' && <WordBadge actual={section.wordCount} target={section.targetWordCount} />}
        </div>
        <div className="flex items-center gap-2">
          {section.keywords && section.keywords.length > 0 && expanded && (
            <div className="hidden sm:flex items-center gap-1">
              {section.keywords.slice(0, 3).map((kw, i) => (
                <span key={i} className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/60">{kw}</span>
              ))}
            </div>
          )}
          {expanded ? <Icon as={ChevronUp} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" />}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[var(--brand-border)]/50 px-4 py-3">
          {section.status === 'pending' && isGenerating ? (
            <div className="text-xs text-[var(--brand-text-muted)] italic">Waiting to be generated...</div>
          ) : section.status === 'generating' ? (
            <div className="flex items-center gap-2 text-xs text-amber-400/80"><Icon as={Loader2} size="sm" className="animate-spin" /> Writing this section...</div>
          ) : section.status === 'error' ? (
            <div className="space-y-2">
              <div className="text-xs text-red-400/80">{section.error || 'Generation failed'}</div>
              <button onClick={() => onRegenerate(section.index)} disabled={regenerating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50">
                <Icon as={regenerating ? Loader2 : RefreshCw} size="sm" className={regenerating ? 'animate-spin' : ''} /> Retry
              </button>
            </div>
          ) : editing ? (
            <div className="space-y-2">
              <RichTextEditor
                initialValue={section.content}
                onChange={onChange}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onDone}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"
                >
                  <Check className="w-3 h-3" /> Done
                </button>
                {saveStatus === 'saving' && (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="t-caption-sm text-emerald-400/70">Saved</span>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xs text-[var(--brand-text)] leading-relaxed [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_h2]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-[var(--brand-text-bright)] [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:pl-4 [&_ul]:mb-2 [&_ol]:pl-4 [&_ol]:mb-2 [&_li]:mb-1 [&_strong]:text-[var(--brand-text-bright)] [&_a]:text-teal-400" dangerouslySetInnerHTML={{ __html: section.content }} />
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--brand-border)]/50">
                <button onClick={() => onStartEdit(section.index)} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"><Icon as={Pencil} size="sm" /> Edit</button>
                <button onClick={() => onRegenerate(section.index)} disabled={regenerating} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-300 transition-colors disabled:opacity-50">
                  <Icon as={regenerating ? Loader2 : RefreshCw} size="sm" className={regenerating ? 'animate-spin' : ''} /> Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
