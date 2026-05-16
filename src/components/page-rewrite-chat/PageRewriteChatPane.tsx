import { Check, Copy, Loader2, Send, Sparkles } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import { extractRewriteOnly } from '../../lib/rewriteResponse';
import { RenderMarkdown } from '../client/helpers';
import { Icon, Button, IconButton } from '../ui';
import { QUICK_PROMPTS, type ChatMessage, type PageData } from './pageRewriteChatModel';

interface PageRewriteChatPaneProps {
  pageData: PageData | null;
  messages: ChatMessage[];
  sending: boolean;
  copiedIdx: number | null;
  msgEdits: Record<number, string>;
  input: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSendMessage: (text?: string) => void;
  onCopyToClipboard: (text: string, idx: number) => void;
  onApplyToSection: (content: string, sectionTarget: string) => void;
  onMessageEdit: (idx: number, text: string) => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function PageRewriteChatPane({
  pageData,
  messages,
  sending,
  copiedIdx,
  msgEdits,
  input,
  chatEndRef,
  inputRef,
  onSendMessage,
  onCopyToClipboard,
  onApplyToSection,
  onMessageEdit,
  onInputChange,
  onInputKeyDown,
}: PageRewriteChatPaneProps) {
  return (
    <div className="flex flex-col w-1/2 border-r border-[var(--brand-border)]">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-teal-500/10 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-accent-brand" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--brand-text-bright)] mb-1">AI Page Rewriter</h2>
              <p className="text-xs text-[var(--brand-text-muted)] max-w-sm">
                {pageData
                  ? `"${pageData.title}" is loaded. Ask me to rewrite sections, optimize headings, add FAQ blocks, or improve AEO.`
                  : 'Load a page above, then ask me to rewrite sections, optimize for AEO, or suggest improvements.'}
              </p>
            </div>

            {pageData && (
              <div className="grid grid-cols-2 gap-2 max-w-md mt-2">
                {QUICK_PROMPTS.map((prompt, i) => (
                  <Button
                    key={i}
                    onClick={() => onSendMessage(prompt)}
                    variant="ghost"
                    size="sm"
                    className="text-left px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)]/50 hover:border-teal-500/30 hover:bg-[var(--surface-3)] t-caption-sm text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-[var(--radius-xl)] px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-teal-600/20 border border-teal-500/20 text-[var(--brand-text-bright)]'
                : 'bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 text-[var(--brand-text-bright)]'
            }`}>
              {msg.role === 'assistant' ? (
                msg.sectionTarget ? (
                  <>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className="text-xs leading-relaxed focus:outline-none border border-transparent focus:border-[var(--brand-border-hover)] rounded p-1 -m-1 transition-colors"
                      onInput={e => onMessageEdit(i, (e.currentTarget as HTMLDivElement).innerText)}
                      ref={(el) => {
                        if (el && !el.dataset.initialized) {
                          el.dataset.initialized = 'true';
                          el.innerText = extractRewriteOnly(msg.content);
                        }
                      }}
                    />
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--brand-border)]/30">
                      <Button
                        onClick={() => onApplyToSection(msgEdits[i] ?? extractRewriteOnly(msg.content), msg.sectionTarget!)}
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-1 px-2 py-0.5 rounded t-micro bg-teal-500/10 text-accent-brand border border-teal-500/30 hover:bg-teal-500/20 transition-colors" // arbitrary-text-ok
                      >
                        <Icon as={Check} size="sm" />
                        Apply to {msg.sectionTarget}
                      </Button>
                      <Button
                        onClick={() => onCopyToClipboard(msgEdits[i] ?? extractRewriteOnly(msg.content), i)}
                        variant="ghost"
                        size="sm"
                        className={"flex items-center gap-1 px-2 py-0.5 rounded t-micro text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]/50 transition-colors" // arbitrary-text-ok
                        }
                      >
                        {copiedIdx === i ? <Icon as={Check} size="sm" className="text-accent-brand" /> : <Icon as={Copy} size="sm" />}
                        {copiedIdx === i ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs leading-relaxed">
                      <RenderMarkdown text={msg.content} />
                    </div>
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--brand-border)]/30">
                      <Button
                        onClick={() => onCopyToClipboard(msg.content, i)}
                        variant="ghost"
                        size="sm"
                        className={"flex items-center gap-1 px-2 py-0.5 rounded t-micro text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]/50 transition-colors" // arbitrary-text-ok
                        }
                      >
                        {copiedIdx === i ? <Icon as={Check} size="sm" className="text-accent-brand" /> : <Icon as={Copy} size="sm" />}
                        {copiedIdx === i ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  </>
                )
              ) : (
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 rounded-[var(--radius-lg)] px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-brand" />
              <span className="text-xs text-[var(--brand-text)]">Analyzing and writing...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div className="flex-shrink-0 border-t border-[var(--brand-border)] px-4 py-3 bg-[var(--surface-2)]/50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={pageData ? 'Ask me to rewrite a section, optimize headings, add FAQs...' : 'Load a page first, or ask a general rewriting question...'}
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none min-h-[40px] max-h-[120px]"
            rows={2}
          />
          <IconButton
            icon={Send}
            size="md"
            variant="solid"
            label="Send message"
            onClick={() => onSendMessage()}
            disabled={sending || !input.trim()}
            className="flex-shrink-0 bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
}
