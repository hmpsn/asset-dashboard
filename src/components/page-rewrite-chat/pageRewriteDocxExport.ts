import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { PageData } from './pageRewriteChatModel';

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

export type PageRewriteDocxProfile = 'legacy' | 'rebuilt';

interface DownloadPageRewriteDocxParams {
  docBody: HTMLElement | null;
  pageData: PageData | null;
  fileName: string;
  profile: PageRewriteDocxProfile;
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
          const childElement = child as Element;
          const childTag = childElement.tagName;
          runs.push(new TextRun({
            text: childElement.textContent || '',
            size: 24,
            bold: childTag === 'STRONG' || childTag === 'B',
            italics: childTag === 'EM' || childTag === 'I',
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

function createPageRewriteDocx(
  docBody: HTMLElement | null,
  pageData: PageData | null,
  profile: PageRewriteDocxProfile,
): Document {
  const sections = [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: serializeDocToDocx(docBody, pageData),
  }];
  const defaultStyles = {
    document: { run: { font: 'Calibri', size: 24, color: '1a1a1a' } },
  };

  if (profile === 'legacy') {
    return new Document({
      styles: {
        default: defaultStyles,
        paragraphStyles: [
          {
            id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 56, bold: true, color: '111111' },
            paragraph: { spacing: { before: 480, after: 160 }, outlineLevel: 0 },
          },
          {
            id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 40, bold: true, color: '111111' },
            paragraph: { spacing: { before: 400, after: 120 }, outlineLevel: 1 },
          },
          {
            id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 32, bold: true, color: '222222' },
            paragraph: { spacing: { before: 320, after: 80 }, outlineLevel: 2 },
          },
          {
            id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 26, bold: true, italics: true, color: '444444' },
            paragraph: { spacing: { before: 240, after: 60 }, outlineLevel: 3 },
          },
        ],
      },
      sections,
    });
  }

  return new Document({
    styles: { default: defaultStyles },
    sections,
  });
}

export async function downloadPageRewriteDocx({
  docBody,
  pageData,
  fileName,
  profile,
}: DownloadPageRewriteDocxParams): Promise<void> {
  const blob = await Packer.toBlob(createPageRewriteDocx(docBody, pageData, profile));
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
