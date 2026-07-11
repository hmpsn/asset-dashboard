// @ds-rebuilt
import { extractRewriteOnly } from '../../lib/rewriteResponse';
import { QUICK_PROMPTS } from '../page-rewrite-chat/pageRewriteChatModel';
import { RenderMarkdown } from '../client/RenderMarkdown';
import { Button, FormTextarea, Icon, InlineBanner, Tooltip } from '../ui';
import { decodePageText } from './pageRewriterFormatters';
import type { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

type PageRewriterState = ReturnType<typeof usePageRewriterSurfaceState>;

interface PageRewriterChatPaneProps {
  state: PageRewriterState;
}

const PLAYBOOK_LABELS = [
  'Answer-first intro',
  'Add an FAQ',
  'Search-ready headings',
  'Add evidence',
  'Match brand voice',
  'Weave in keywords',
] as const;

function MessageAvatar({ role }: { role: 'assistant' | 'user' }) {
  if (role === 'assistant') {
    return (
      <span
        role="img"
        aria-label="Rewrite AI"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--purple)]"
        style={{ background: 'color-mix(in srgb, var(--purple) 14%, transparent)' }}
      >
        <Icon name="sparkle" size="sm" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label="You"
      className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] t-micro font-bold text-[var(--brand-text-muted)]"
    >
      You
    </span>
  );
}

function SendButton({
  disabledReason,
  disabled,
  sending,
  onClick,
}: {
  disabledReason: string | null;
  disabled: boolean;
  sending: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button
      size="md"
      variant="primary"
      disabled={disabled}
      loading={sending}
      onClick={onClick}
      aria-label="Send rewrite prompt"
      className="h-10 w-10 shrink-0 p-0"
    >
      {!sending && <Icon name="send" size="sm" />}
    </Button>
  );

  if (!disabledReason) return button;
  return (
    <Tooltip content={disabledReason} placement="top">
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
}

export function PageRewriterChatPane({ state }: PageRewriterChatPaneProps) {
  const keyword = state.pageData?.primaryKeyword;
  const pageTitle = state.pageData?.title ? decodePageText(state.pageData.title) : '';
  const assistantDisabled = state.sending || !!state.aiDisabledReason;

  return (
    <section className="flex min-h-[560px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] shadow-[var(--shadow-md)] lg:h-full lg:min-h-0">
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--brand-border)] px-4 py-2.5">
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--purple)]"
          style={{ background: 'color-mix(in srgb, var(--purple) 12%, transparent)' }}
          aria-hidden="true"
        >
          <Icon name="sparkle" size="sm" />
        </span>
        <div className="min-w-0">
          <h2 className="t-ui font-bold text-[var(--brand-text-bright)]">Rewrite chat</h2>
          <p className="truncate t-caption text-[var(--brand-text-muted)]">Instruct the AI — it drafts, you apply</p>
        </div>
      </div>

      <div ref={state.chatTranscriptRef} data-testid="page-rewriter-transcript" className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        <div className="flex flex-col gap-3">
          {state.quotaBannerVisible && (
            <InlineBanner
              tone="warning"
              title="AI quota reached"
              onDismiss={state.dismissQuotaBanner}
            >
              <div className="flex flex-col gap-1">
                <span>The rewrite assistant is paused for this session.</span>
                {state.quotaPartialMessage && <span>{state.quotaPartialMessage}</span>}
              </div>
            </InlineBanner>
          )}

          {state.pageData && (
            <div className="flex items-start gap-2.5">
              <MessageAvatar role="assistant" />
              <div
                data-message-bubble
                className="max-w-[88%] rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2.5 t-ui leading-relaxed text-[var(--brand-text)]"
              >
                I’ve loaded <strong className="font-semibold text-[var(--brand-text-bright)]">{pageTitle}</strong>.
                {keyword && <> Its target is “<strong className="font-semibold text-[var(--brand-text-bright)]">{keyword}</strong>”.</>}
                {' '}Tell me how to rewrite it, or choose a playbook below. I’ll draft copy you can apply directly.
              </div>
            </div>
          )}

          {!state.pageData && state.messages.length === 0 && (
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center">
              <MessageAvatar role="assistant" />
              <div className="max-w-sm">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Load a page to begin</h3>
                <p className="mt-1 t-ui text-[var(--brand-text-muted)]">Choose a sitemap page or paste a URL, then guide the rewrite here.</p>
              </div>
            </div>
          )}

          {state.messages.map((message, index) => {
            const isUser = message.role === 'user';
            return (
              <div key={`${message.timestamp}-${index}`} className="flex items-start gap-2.5">
                <MessageAvatar role={message.role} />
                <div
                  data-message-bubble
                  className="max-w-[88%] rounded-[var(--radius-lg)] border px-3 py-2.5 t-ui"
                  style={{
                    borderColor: 'var(--brand-border)',
                    background: isUser ? 'var(--surface-3)' : 'var(--surface-1)',
                  }}
                >
                  {message.role === 'assistant' && message.sectionTarget ? (
                    <>
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        className="-m-1 rounded-[var(--radius-md)] border border-transparent p-1 t-ui leading-relaxed text-[var(--brand-text-bright)] focus:outline-none focus-visible:border-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--brand-mint-glow)]"
                        onInput={(event) => state.setMsgEdits((prev) => ({ ...prev, [index]: event.currentTarget.innerText }))}
                        ref={(el) => {
                          if (el && !el.dataset.initialized) {
                            el.dataset.initialized = 'true';
                            el.innerText = extractRewriteOnly(message.content);
                          }
                        }}
                      />
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--brand-border)] pt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => state.applyToSection(state.msgEdits[index] ?? extractRewriteOnly(message.content), message.sectionTarget!)}
                        >
                          <Icon name="check" size="sm" />
                          Apply to {message.sectionTarget}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => state.copyToClipboard(state.msgEdits[index] ?? extractRewriteOnly(message.content), index)}
                        >
                          <Icon name={state.copiedIdx === index ? 'check' : 'copy'} size="sm" />
                          {state.copiedIdx === index ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                    </>
                  ) : message.role === 'assistant' ? (
                    <>
                      <div className="t-ui leading-relaxed text-[var(--brand-text-bright)]">
                        <RenderMarkdown text={message.content} />
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5 border-t border-[var(--brand-border)] pt-2">
                        <Button size="sm" variant="ghost" onClick={() => state.copyToClipboard(message.content, index)}>
                          <Icon name={state.copiedIdx === index ? 'check' : 'copy'} size="sm" />
                          {state.copiedIdx === index ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap t-ui leading-relaxed text-[var(--brand-text-bright)]">{message.content}</p>
                  )}
                </div>
              </div>
            );
          })}

          {state.sending && (
            <div className="flex items-start gap-2.5">
              <MessageAvatar role="assistant" />
              <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2.5">
                <Icon name="refresh" size="sm" className="animate-spin text-[var(--teal)]" />
                <span className="t-ui text-[var(--brand-text)]">Analyzing page context...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div data-testid="page-rewriter-playbook" className="flex flex-none flex-wrap gap-1.5 border-t border-[var(--brand-border)] px-3 py-2" aria-label="Rewrite playbook prompts">
        {QUICK_PROMPTS.map((prompt, index) => {
          const button = (
            <Button
              key={prompt}
              size="sm"
              variant="secondary"
              title={prompt}
              disabled={assistantDisabled}
              onClick={() => void state.sendMessage(prompt)}
              className="whitespace-nowrap"
            >
              {PLAYBOOK_LABELS[index] ?? prompt}
            </Button>
          );
          if (!state.aiDisabledReason) return button;
          return (
            <Tooltip key={prompt} content={state.aiDisabledReason} placement="top">
              <span aria-disabled="true">{button}</span>
            </Tooltip>
          );
        })}
      </div>

      <div data-testid="page-rewriter-composer" className="flex-none border-t border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2.5">
        <div className="flex items-end gap-2">
          <FormTextarea
            ref={state.inputRef}
            value={state.input}
            onChange={state.setInput}
            onKeyDown={state.handleInputKeyDown}
            rows={1}
            disabled={!!state.aiDisabledReason}
            placeholder={state.pageData ? 'Ask for a rewrite…' : 'Load a page first…'}
            className="min-h-10 flex-1"
          />
          <SendButton
            disabledReason={state.aiDisabledReason}
            disabled={assistantDisabled || !state.input.trim()}
            sending={state.sending}
            onClick={() => void state.sendMessage()}
          />
        </div>
      </div>
    </section>
  );
}
