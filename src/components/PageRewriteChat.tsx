import { useToast } from './Toast';
import { PageRewriteHeaderBar } from './page-rewrite-chat/PageRewriteHeaderBar';
import { PageRewriteChatPane } from './page-rewrite-chat/PageRewriteChatPane';
import { PageRewriteDocumentPane } from './page-rewrite-chat/PageRewriteDocumentPane';
import { usePageRewriteChatShell } from './page-rewrite-chat/usePageRewriteChatShell';

interface Props {
  workspaceId: string;
  initialPageUrl?: string;
  focusMode?: boolean;
  onFocusModeToggle?: () => void;
  onBack: () => void;
}

export function PageRewriteChat({ workspaceId, initialPageUrl, focusMode, onFocusModeToggle, onBack }: Props) {
  const { toast } = useToast();
  const {
    pageUrl,
    pageData,
    loadingPage,
    pageError,
    messages,
    input,
    sending,
    copiedIdx,
    msgEdits,
    comboOpen,
    comboQuery,
    comboIdx,
    comboQueryIsUrl,
    filteredPages,
    sitemapPages,
    toolbarPos,
    exportOpen,
    chatEndRef,
    inputRef,
    comboRef,
    comboInputRef,
    docPanelRef,
    exportBtnRef,
    exportPopoverRef,
    sendMessage,
    setInput,
    setComboQuery,
    setComboIdx,
    setMsgEdits,
    openCombo,
    selectPage,
    handleComboKeyDown,
    applyToSection,
    copyToClipboard,
    handleInputKeyDown,
    docBodyRefCallback,
    handleExport,
    toggleExportOpen,
    handleFormatBold,
    handleFormatItalic,
    handleHeading2,
    handleHeading3,
    clearFormattingSelection,
    loadTypedUrl,
  } = usePageRewriteChatShell({ workspaceId, initialPageUrl, toast });

  return (
    <div className="flex flex-col h-full">
      <PageRewriteHeaderBar
        pageData={pageData}
        pageUrl={pageUrl}
        loadingPage={loadingPage}
        focusMode={focusMode}
        onFocusModeToggle={onFocusModeToggle}
        onBack={onBack}
        comboOpen={comboOpen}
        comboQuery={comboQuery}
        comboIdx={comboIdx}
        comboQueryIsUrl={comboQueryIsUrl}
        filteredPages={filteredPages}
        sitemapPages={sitemapPages}
        comboRef={comboRef}
        comboInputRef={comboInputRef}
        onOpenCombo={openCombo}
        onComboQueryChange={setComboQuery}
        onComboKeyDown={handleComboKeyDown}
        onSelectPage={selectPage}
        onLoadTypedUrl={loadTypedUrl}
        onSetComboIdx={setComboIdx}
      />

      {/* Main two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        <PageRewriteChatPane
          pageData={pageData}
          messages={messages}
          sending={sending}
          copiedIdx={copiedIdx}
          msgEdits={msgEdits}
          input={input}
          chatEndRef={chatEndRef}
          inputRef={inputRef}
          onSendMessage={sendMessage}
          onCopyToClipboard={copyToClipboard}
          onApplyToSection={applyToSection}
          onMessageEdit={(idx, text) => setMsgEdits(prev => ({ ...prev, [idx]: text }))}
          onInputChange={setInput}
          onInputKeyDown={handleInputKeyDown}
        />

        <PageRewriteDocumentPane
          pageData={pageData}
          pageUrl={pageUrl}
          loadingPage={loadingPage}
          pageError={pageError}
          docPanelRef={docPanelRef}
          docBodyRefCallback={docBodyRefCallback}
          toolbarPos={toolbarPos}
          exportOpen={exportOpen}
          onToggleExport={toggleExportOpen}
          onExport={handleExport}
          exportPopoverRef={exportPopoverRef}
          exportBtnRef={exportBtnRef}
          onBold={handleFormatBold}
          onItalic={handleFormatItalic}
          onHeading2={handleHeading2}
          onHeading3={handleHeading3}
          onClearFormatting={clearFormattingSelection}
        />
      </div>
    </div>
  );
}
