/**
 * SchemaEditor — Inline JSON editing with parse validation.
 * Extracted from SchemaSuggester.tsx schema editing logic.
 */
import { AlertCircle, CheckCircle } from 'lucide-react';

export interface SchemaEditorProps {
  pageId: string;
  schemaJson: string;
  parseError: string | undefined;
  hasEdits: boolean;
  onChange: (pageId: string, value: string) => void;
}

export function SchemaEditor({ pageId, schemaJson, parseError, hasEdits, onChange }: SchemaEditorProps) {
  return (
    <div className="relative">
      <textarea
        value={schemaJson}
        onChange={e => onChange(pageId, e.target.value)}
        className={`w-full text-xs font-mono bg-zinc-950 rounded-lg p-3 text-zinc-300 border ${parseError ? 'border-red-500/50' : 'border-teal-500/30'} max-h-96 min-h-[200px] overflow-y-auto resize-y focus:outline-none focus:border-teal-500/60`}
        spellCheck={false}
      />
      {parseError && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-red-400">
          <AlertCircle className="w-3 h-3" />
          {parseError}
        </div>
      )}
      {hasEdits && !parseError && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-teal-400">
          <CheckCircle className="w-3 h-3" />
          Valid JSON — edits will be used for copy &amp; publish
        </div>
      )}
    </div>
  );
}
