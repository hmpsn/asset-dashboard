/**
 * SectionEditor — Individual content section with expand/collapse, editing, regenerate.
 * Extracted from PostEditor.tsx body sections rendering.
 */
import {
  Loader2, RefreshCw, Check, ChevronDown, ChevronUp, Pencil, Clock, AlertTriangle,
} from 'lucide-react';
import { SectionCard } from '../ui';

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
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border ${color}`}>{actual}/{target}w</span>;
}

export interface SectionEditorProps {
  section: PostSection;
  expanded: boolean;
  editing: boolean;
  editBuffer: string;
  regenerating: boolean;
  isGenerating: boolean;
  onToggleExpand: (index: number) => void;
  onStartEdit: (index: number, content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRegenerate: (index: number) => void;
  onChangeBuffer: (value: string) => void;
}

export function SectionEditor({
  section, expanded, editing, editBuffer, regenerating, isGenerating,
  onToggleExpand, onStartEdit, onSaveEdit, onCancelEdit, onRegenerate, onChangeBuffer,
}: SectionEditorProps) {
  return (
    <SectionCard noPadding className={`overflow-hidden ${section.status === 'error' ? '!border-red-500/30' : section.status === 'generating' ? '!border-amber-500/20' : ''}`}>
      <button onClick={() => onToggleExpand(section.index)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-800/30 transition-colors">
        <div className="flex items-center gap-2">
          {section.status === 'generating' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/80" /> :
           section.status === 'error' ? <AlertTriangle className="w-3.5 h-3.5 text-red-400/80" /> :
           section.status === 'done' ? <Check className="w-3.5 h-3.5 text-emerald-400/80" /> :
           <Clock className="w-3.5 h-3.5 text-zinc-500" />}
          <span className="text-xs font-medium text-zinc-200">{section.heading}</span>
          {section.status === 'done' && <WordBadge actual={section.wordCount} target={section.targetWordCount} />}
        </div>
        <div className="flex items-center gap-2">
          {section.keywords && section.keywords.length > 0 && expanded && (
            <div className="hidden sm:flex items-center gap-1">
              {section.keywords.slice(0, 3).map((kw, i) => (
                <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/60">{kw}</span>
              ))}
            </div>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-zinc-800/50 px-4 py-3">
          {section.status === 'pending' && isGenerating ? (
            <div className="text-xs text-zinc-500 italic">Waiting to be generated...</div>
          ) : section.status === 'generating' ? (
            <div className="flex items-center gap-2 text-xs text-amber-400/80"><Loader2 className="w-3 h-3 animate-spin" /> Writing this section...</div>
          ) : section.status === 'error' ? (
            <div className="space-y-2">
              <div className="text-xs text-red-400/80">{section.error || 'Generation failed'}</div>
              <button onClick={() => onRegenerate(section.index)} disabled={regenerating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50">
                {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry
              </button>
            </div>
          ) : editing ? (
            <div className="space-y-2">
              <textarea value={editBuffer} onChange={e => onChangeBuffer(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono focus:border-teal-500/50 focus:outline-none resize-y min-h-[150px]" rows={12} />
              <div className="flex items-center gap-2">
                <button onClick={onSaveEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Check className="w-3 h-3" /> Save</button>
                <button onClick={onCancelEdit} className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                <span className="text-[11px] text-zinc-500 ml-auto">{editBuffer.split(/\s+/).filter(w => w).length} words</span>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xs text-zinc-300 leading-relaxed [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h2]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-zinc-200 [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:pl-4 [&_ul]:mb-2 [&_ol]:pl-4 [&_ol]:mb-2 [&_li]:mb-1 [&_strong]:text-zinc-100 [&_a]:text-teal-400" dangerouslySetInnerHTML={{ __html: section.content }} />
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-800/50">
                <button onClick={() => onStartEdit(section.index, section.content)} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3 h-3" /> Edit</button>
                <button onClick={() => onRegenerate(section.index)} disabled={regenerating} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-300 transition-colors disabled:opacity-50">
                  {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
