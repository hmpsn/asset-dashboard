/**
 * SchemaEditor — Inline JSON editing with parse validation.
 * Extracted from SchemaSuggester.tsx schema editing logic.
 */
import { AlertCircle, CheckCircle } from 'lucide-react';
import { FormTextarea, Icon } from '../ui';

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
      <FormTextarea
        value={schemaJson}
        onChange={value => onChange(pageId, value)}
        className={`w-full t-mono bg-[var(--surface-1)] rounded-[var(--radius-md)] p-3 text-[var(--brand-text)] border ${parseError ? 'border-red-500/50' : 'border-emerald-500/30'} max-h-96 min-h-[200px] overflow-y-auto resize-y focus:outline-none focus:border-teal-500/60`}
        spellCheck={false}
      />
      {parseError && (
        <div className="flex items-center gap-1.5 mt-1.5 t-caption-sm text-red-400/80">
          <Icon as={AlertCircle} size="sm" />
          {parseError}
        </div>
      )}
      {hasEdits && !parseError && (
        <div className="flex items-center gap-1.5 mt-1.5 t-caption-sm text-emerald-400">
          <Icon as={CheckCircle} size="sm" />
          Valid JSON — edits will be used for copy &amp; publish
        </div>
      )}
    </div>
  );
}
