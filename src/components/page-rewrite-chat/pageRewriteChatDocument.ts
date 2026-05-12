import { Paragraph, TextRun, HeadingLevel } from 'docx';
import { toSectionSlug, type PageData } from './pageRewriteChatModel';

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

function decodeEntities(input: string): string {
  if (typeof document === 'undefined') return input;
  const el = document.createElement('span');
  el.innerHTML = input;
  return el.textContent || input;
}

function escapeHtml(input: string): string {
  return decodeEntities(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBodyParagraph(body: string, extraClass = '', marginLeftPx?: number): string {
  if (!body) return '';
  const classPart = extraClass ? ` ${extraClass}` : '';
  const stylePart = typeof marginLeftPx === 'number' ? ` style="margin-left:${marginLeftPx}px"` : '';
  return `<p class="text-[13px] text-slate-500 leading-[1.7] mb-3${classPart}"${stylePart}>${escapeHtml(body)}</p>`; // arbitrary-text-ok
}

export function buildDocHtml(data: PageData): string {
  const parts: string[] = [
    `<h1 data-section="${escapeHtml(toSectionSlug(data.title))}" class="text-[20px] font-bold text-slate-100 mb-3">${escapeHtml(data.title)}</h1>`, // arbitrary-text-ok
  ];

  if (data.preamble) parts.push(renderBodyParagraph(data.preamble));

  for (const section of data.sections) {
    const slug = toSectionSlug(section.heading);
    if (section.level === 1) {
      parts.push(`<h1 data-section="${escapeHtml(slug)}" class="text-[20px] font-bold text-slate-100 mb-2 mt-5">${escapeHtml(section.heading)}</h1>${renderBodyParagraph(section.body)}`); // arbitrary-text-ok
    } else if (section.level === 2) {
      parts.push(`<h2 data-section="${escapeHtml(slug)}" class="text-[15px] font-semibold text-slate-300 mb-2 mt-5">${escapeHtml(section.heading)}</h2>${renderBodyParagraph(section.body)}`); // arbitrary-text-ok
    } else if (section.level === 3) {
      parts.push(`<h3 data-section="${escapeHtml(slug)}" class="text-[12px] font-medium text-slate-400 mb-1.5 mt-4 ml-3 pl-2 border-l-2 border-slate-700">${escapeHtml(section.heading)}</h3>${renderBodyParagraph(section.body, 'ml-3')}`); // arbitrary-text-ok
    } else {
      const extraIndent = (section.level - 3) * 12;
      const marginLeftPx = 12 + extraIndent;
      parts.push(`<h4 data-section="${escapeHtml(slug)}" class="text-[12px] font-medium text-slate-400 mb-1.5 mt-3 pl-2 border-l-2 border-slate-700" style="margin-left:${marginLeftPx}px">${escapeHtml(section.heading)}</h4>${renderBodyParagraph(section.body, '', marginLeftPx)}`); // arbitrary-text-ok
    }
  }

  return parts.join('');
}

export function serializeDocToMarkdown(docBody: HTMLElement | null, pageData: PageData | null): string {
  if (!docBody) return '';
  const lines: string[] = [];

  if (pageData && pageData.issues.length > 0) {
    lines.push('## Issues\n');
    pageData.issues.forEach(issue => lines.push(`- [${issue.severity}] ${issue.message}`));
    lines.push('');
  }

  const walk = (node: Node) => {
    if (node.nodeType === NODE_TYPE_TEXT) {
      const text = (node.textContent || '').trim();
      if (text) lines.push(`${text}\n`);
      return;
    }
    if (node.nodeType !== NODE_TYPE_ELEMENT) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1') { lines.push(`# ${el.textContent?.trim()}\n`); return; }
    if (tag === 'h2') { lines.push(`\n## ${el.textContent?.trim()}\n`); return; }
    if (tag === 'h3') { lines.push(`\n### ${el.textContent?.trim()}\n`); return; }
    if (tag === 'h4') { lines.push(`\n#### ${el.textContent?.trim()}\n`); return; }
    if (tag === 'p') {
      const parts: string[] = [];
      el.childNodes.forEach(child => {
        if (child.nodeType === NODE_TYPE_TEXT) {
          parts.push(child.textContent || '');
        } else if (child.nodeType === NODE_TYPE_ELEMENT) {
          const c = child as Element;
          if (c.tagName === 'STRONG' || c.tagName === 'B') parts.push(`**${c.textContent}**`);
          else if (c.tagName === 'EM' || c.tagName === 'I') parts.push(`*${c.textContent}*`);
          else parts.push(c.textContent || '');
        }
      });
      const text = parts.join('').trim();
      if (text) lines.push(`${text}\n`);
      return;
    }
    el.childNodes.forEach(walk);
  };

  docBody.childNodes.forEach(walk);
  return lines.join('\n');
}

export function serializeDocToDocx(docBody: HTMLElement | null, pageData: PageData | null): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const severityColor: Record<string, string> = {
    error: 'DC2626',
    warning: 'D97706',
    info: '2563EB',
  };

  if (pageData && pageData.issues.length > 0) {
    paragraphs.push(new Paragraph({ text: 'SEO Issues', heading: HeadingLevel.HEADING_2 }));
    pageData.issues.forEach(issue => {
      const color = severityColor[issue.severity] ?? '6B7280';
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children: [
          new TextRun({ text: issue.severity.toUpperCase(), bold: true, color, size: 20 }),
          new TextRun({ text: `  ${issue.message}`, size: 22 }),
        ],
      }));
    });
    paragraphs.push(new Paragraph({ text: '' }));
  }

  if (!docBody) return paragraphs;

  const headingLevel = (tag: string): typeof HeadingLevel[keyof typeof HeadingLevel] | null => {
    if (tag === 'h1') return HeadingLevel.HEADING_1;
    if (tag === 'h2') return HeadingLevel.HEADING_2;
    if (tag === 'h3') return HeadingLevel.HEADING_3;
    if (tag === 'h4') return HeadingLevel.HEADING_4;
    return null;
  };

  const walk = (node: Node) => {
    if (node.nodeType !== NODE_TYPE_ELEMENT) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const level = headingLevel(tag);
    if (level) {
      paragraphs.push(new Paragraph({ text: el.textContent?.trim() || '', heading: level }));
      return;
    }
    if (tag === 'p') {
      const runs: TextRun[] = [];
      el.childNodes.forEach(child => {
        if (child.nodeType === NODE_TYPE_TEXT) {
          runs.push(new TextRun({ text: child.textContent || '', size: 24 }));
        } else if (child.nodeType === NODE_TYPE_ELEMENT) {
          const c = child as Element;
          const ctag = c.tagName;
          runs.push(new TextRun({
            text: c.textContent || '',
            size: 24,
            bold: ctag === 'STRONG' || ctag === 'B',
            italics: ctag === 'EM' || ctag === 'I',
          }));
        }
      });
      if (runs.length) {
        paragraphs.push(new Paragraph({
          children: runs,
          spacing: { after: 160 },
        }));
      }
      return;
    }
    el.childNodes.forEach(walk);
  };

  docBody.childNodes.forEach(walk);
  return paragraphs;
}
