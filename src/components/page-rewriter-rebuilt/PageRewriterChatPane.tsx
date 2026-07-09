// @ds-rebuilt
import { extractRewriteOnly } from '../../lib/rewriteResponse';
import { QUICK_PROMPTS } from '../page-rewrite-chat/pageRewriteChatModel';
import { RenderMarkdown } from '../client/helpers';
import { Badge, Button, FilterChip, FormTextarea, Icon, InlineBanner, Tooltip } from '../ui';
import type { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

type PageRewriterState = ReturnType<typeof usePageRewriterSurfaceState>;

interface PageRewriterChatPaneProps {
  state: PageRewriterState;
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
      className="shrink-0"
    >
      {!sending && <Icon name="send" size="sm" />}
      Send
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
  const assistantDisabled = state.sending || !!state.aiDisabledReason;

  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
      <div className="border-b border-[var(--brand-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="sparkle" size="md" className="text-[var(--teal)]" />
          <h2 className="t-ui font-semibold text-[var(--brand-text-bright)]">Rewrite assistant</h2>
          {keyword && <Badge label={`Target: ${keyword}`} tone="blue" variant="soft" shape="pill" />}
        </div>
        <p className="mt-1 t-body text-[var(--brand-text-muted)]">
          Rewrite sections, reshape headings, and draft answer-first copy for the loaded page.
        </p>
      </div>

      <div className="border-b border-[var(--brand-border)] px-4 py-3">
        <div className="grid gap-2 sm:flex sm:flex-wrap" aria-label="Rewrite playbook prompts">
          {QUICK_PROMPTS.map((prompt) => {
            const chip = (
              <FilterChip
                key={prompt}
                label={prompt}
                active={false}
                onClick={assistantDisabled ? undefined : () => void state.sendMessage(prompt)}
                className="w-full justify-start whitespace-normal text-left leading-snug sm:w-auto [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:text-left"
              />
            );
            if (!state.aiDisabledReason) return chip;
            return (
              <Tooltip key={prompt} content={state.aiDisabledReason} placement="bottom">
                <span aria-disabled="true">{chip}</span>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {state.quotaBannerVisible && (
        <div className="px-4 pt-3">
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
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {state.messages.length === 0 ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-3)]">
              <Icon name="sparkle" size="lg" className="text-[var(--teal)]" />
            </div>
            <div className="max-w-md">
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Start with a page-specific rewrite</h3>
              <p className="mt-1 t-body text-[var(--brand-text-muted)]">
                {state.pageData
                  ? keyword
                    ? `This page is loaded with ${keyword} as the primary keyword.`
                    : 'This page is loaded. Ask for a section rewrite or a stronger answer-first intro.'
                  : 'Load a page, then ask for a rewrite, heading pass, FAQ block, or AEO improvement.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {state.messages.map((message, index) => {
              const isUser = message.role === 'user';
              return (
                <div key={`${message.timestamp}-${index}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[88%] rounded-[var(--radius-lg)] border px-4 py-3"
                    style={{
                      borderColor: isUser ? 'color-mix(in srgb, var(--teal) 32%, transparent)' : 'var(--brand-border)',
                      background: isUser ? 'color-mix(in srgb, var(--teal) 12%, transparent)' : 'var(--surface-3)',
                    }}
                  >
                    {message.role === 'assistant' && message.sectionTarget ? (
                      <>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          className="rounded-[var(--radius-md)] border border-transparent p-1 -m-1 t-body leading-relaxed text-[var(--brand-text-bright)] focus:outline-none focus-visible:border-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--brand-mint-glow)]"
                          onInput={(event) => state.setMsgEdits((prev) => ({ ...prev, [index]: event.currentTarget.innerText }))}
                          ref={(el) => {
                            if (el && !el.dataset.initialized) {
                              el.dataset.initialized = 'true';
                              el.innerText = extractRewriteOnly(message.content);
                            }
                          }}
                        />
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--brand-border)] pt-2">
                          <Button
                            size="sm"
                            variant="secondary"
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
                        <div className="t-body leading-relaxed text-[var(--brand-text-bright)]">
                          <RenderMarkdown text={message.content} />
                        </div>
                        <div className="mt-3 flex items-center gap-2 border-t border-[var(--brand-border)] pt-2">
                          <Button size="sm" variant="ghost" onClick={() => state.copyToClipboard(message.content, index)}>
                            <Icon name={state.copiedIdx === index ? 'check' : 'copy'} size="sm" />
                            {state.copiedIdx === index ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap t-body leading-relaxed text-[var(--brand-text-bright)]">{message.content}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {state.sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] px-4 py-3">
                  <Icon name="refresh" size="sm" className="animate-spin text-[var(--teal)]" />
                  <span className="t-ui text-[var(--brand-text)]">Analyzing page context...</span>
                </div>
              </div>
            )}
            <div ref={state.chatEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-3">
        <div className="flex items-end gap-2">
          <FormTextarea
            ref={state.inputRef}
            value={state.input}
            onChange={state.setInput}
            onKeyDown={state.handleInputKeyDown}
            rows={2}
            disabled={!!state.aiDisabledReason}
            placeholder={state.pageData ? 'Ask for a rewrite, heading pass, FAQ block...' : 'Load a page first, or ask a general rewrite question...'}
            className="min-h-[68px] flex-1"
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
