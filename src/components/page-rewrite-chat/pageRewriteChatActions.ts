import { HEADING_CLASSES, toSectionSlug } from './pageRewriteChatModel';

const NODE_TEXT = 3;
const HEADING_TAG_PATTERN = /^H[1-6]$/i;

export function execFormatCommand(command: string, docBody: HTMLDivElement | null): void {
  docBody?.focus();
  // execCommand-ok: no replacement for contenteditable bold/italic in 2026
  document.execCommand(command, false);
}

export function clearFormattingSelection(): void {
  // execCommand-ok: no replacement for contenteditable removeFormat in 2026
  document.execCommand('removeFormat');
  // execCommand-ok: no replacement for contenteditable formatBlock in 2026
  document.execCommand('formatBlock', false, 'p');
}

export function wrapSelectionHeading(tag: 'h2' | 'h3', docBody: HTMLDivElement | null): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  docBody?.focus();
  const range = selection.getRangeAt(0);
  const block = (range.startContainer.nodeType === NODE_TEXT
    ? range.startContainer.parentElement
    : range.startContainer as Element);

  const existingHeading = block?.closest('h1,h2,h3,h4,h5,h6');
  if (existingHeading) {
    const newHeading = document.createElement(tag);
    newHeading.innerHTML = existingHeading.innerHTML;
    const sectionAttr = existingHeading.getAttribute('data-section');
    if (sectionAttr) newHeading.setAttribute('data-section', sectionAttr);
    newHeading.className = HEADING_CLASSES[tag] ?? '';
    existingHeading.replaceWith(newHeading);
    return;
  }

  // execCommand-ok: no replacement for contenteditable formatBlock in 2026
  document.execCommand('formatBlock', false, tag);
  const updatedSelection = window.getSelection();
  if (!updatedSelection || updatedSelection.rangeCount === 0) return;

  const anchor = updatedSelection.anchorNode;
  const newHeading = (anchor?.nodeType === NODE_TEXT
    ? anchor.parentElement
    : anchor as Element | null)?.closest('h1,h2,h3,h4,h5,h6');
  if (!newHeading) return;

  newHeading.className = HEADING_CLASSES[tag] ?? '';
  const slug = toSectionSlug(newHeading.textContent || '');
  if (slug) newHeading.setAttribute('data-section', slug);
}

export function applyRewriteToSection(
  docBody: HTMLDivElement | null,
  content: string,
  sectionTarget: string,
): { foundSection: boolean } {
  if (!docBody) return { foundSection: false };

  const targetSlug = toSectionSlug(sectionTarget);
  const heading = targetSlug ? docBody.querySelector(`[data-section="${targetSlug}"]`) : null;

  if (heading) {
    let sibling = heading.nextElementSibling;
    while (sibling && !HEADING_TAG_PATTERN.test(sibling.tagName)) {
      const next = sibling.nextElementSibling;
      sibling.remove();
      sibling = next;
    }
  }

  const paragraph = docBody.ownerDocument.createElement('p');
  paragraph.textContent = content;
  paragraph.className = 'text-[13px] text-slate-500 leading-[1.7] mb-3'; // arbitrary-text-ok
  paragraph.style.cssText = 'background-color:rgba(13,148,136,0.2);border-left:2px solid #0d9488;padding-left:10px;transition:background-color 2s ease,border-left 2s ease,padding-left 2s ease';

  if (heading ?? docBody.lastElementChild) {
    (heading ?? docBody.lastElementChild!).insertAdjacentElement('afterend', paragraph);
  } else {
    docBody.appendChild(paragraph);
  }

  setTimeout(() => {
    paragraph.style.backgroundColor = '';
    paragraph.style.borderLeft = '';
    paragraph.style.paddingLeft = '';
  }, 2000);

  return { foundSection: !!heading };
}
