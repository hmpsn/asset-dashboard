/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const docxMocks = vi.hoisted(() => ({
  documentConstructor: vi.fn(),
  toBlob: vi.fn(),
}));

vi.mock('docx', () => {
  class MockDocument {
    constructor(options: unknown) {
      docxMocks.documentConstructor(options);
    }
  }

  class MockParagraph {
    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
    }
  }

  class MockTextRun {
    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
    }
  }

  return {
    Document: MockDocument,
    HeadingLevel: {
      HEADING_1: 'Heading1',
      HEADING_2: 'Heading2',
      HEADING_3: 'Heading3',
      HEADING_4: 'Heading4',
    },
    Packer: { toBlob: (...args: unknown[]) => docxMocks.toBlob(...args) },
    Paragraph: MockParagraph,
    TextRun: MockTextRun,
  };
});

import {
  downloadPageRewriteDocx,
  serializeDocToDocx,
} from '../../src/components/page-rewrite-chat/pageRewriteDocxExport';
import type { PageData } from '../../src/components/page-rewrite-chat/pageRewriteChatModel';

const pageData = {
  title: 'Dental Implants',
  slug: '/services/implants',
  bodyText: '',
  html: '',
  sections: [],
  issues: [{ check: 'meta', severity: 'warning' as const, message: 'Needs a stronger description' }],
} satisfies PageData;

describe('page rewrite DOCX export boundary', () => {
  const createObjectURL = vi.fn(() => 'blob:page-rewrite-docx');
  const revokeObjectURL = vi.fn();
  const anchorClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    docxMocks.toBlob.mockResolvedValue(new Blob(['docx']));
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves issue, heading, and inline emphasis serialization', () => {
    const docBody = document.createElement('div');
    docBody.innerHTML = '<h1>Dental Implants</h1><p><strong>Stable</strong> and <em>natural</em></p>';

    const paragraphs = serializeDocToDocx(docBody, pageData) as Array<{ options: unknown }>;

    expect(paragraphs).toHaveLength(5);
    expect(paragraphs[0]?.options).toEqual({ text: 'SEO Issues', heading: 'Heading2' });
    expect(paragraphs[3]?.options).toEqual({ text: 'Dental Implants', heading: 'Heading1' });
    expect(paragraphs[4]?.options).toMatchObject({
      children: [
        { options: { text: 'Stable', size: 24, bold: true, italics: false } },
        { options: { text: ' and ', size: 24 } },
        { options: { text: 'natural', size: 24, bold: false, italics: true } },
      ],
      spacing: { after: 160 },
    });
  });

  it('downloads the legacy profile exactly once with its heading styles and revokes the URL', async () => {
    const docBody = document.createElement('div');
    docBody.innerHTML = '<h2>Benefits</h2><p>Stable replacement teeth.</p>';

    await downloadPageRewriteDocx({
      docBody,
      pageData,
      fileName: 'services-implants-brief.docx',
      profile: 'legacy',
    });

    const documentOptions = docxMocks.documentConstructor.mock.calls[0]?.[0] as {
      styles: { paragraphStyles?: unknown[] };
    };
    expect(documentOptions.styles.paragraphStyles).toHaveLength(4);
    expect(docxMocks.toBlob).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(anchorClick.mock.instances[0]).toMatchObject({
      download: 'services-implants-brief.docx',
      href: 'blob:page-rewrite-docx',
    });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:page-rewrite-docx');
  });

  it('keeps the rebuilt profile compact and revokes its URL even when the click fails', async () => {
    anchorClick.mockImplementationOnce(() => {
      throw new Error('download blocked');
    });

    await expect(downloadPageRewriteDocx({
      docBody: document.createElement('div'),
      pageData,
      fileName: 'services-implants-rewrite.docx',
      profile: 'rebuilt',
    })).rejects.toThrow('download blocked');

    const documentOptions = docxMocks.documentConstructor.mock.calls[0]?.[0] as {
      styles: { paragraphStyles?: unknown[] };
    };
    expect(documentOptions.styles.paragraphStyles).toBeUndefined();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(anchorClick.mock.instances[0]).toMatchObject({ download: 'services-implants-rewrite.docx' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:page-rewrite-docx');
  });

  it('does not create or revoke an object URL when DOCX packing fails', async () => {
    docxMocks.toBlob.mockRejectedValueOnce(new Error('packing failed'));

    await expect(downloadPageRewriteDocx({
      docBody: document.createElement('div'),
      pageData,
      fileName: 'services-implants-rewrite.docx',
      profile: 'rebuilt',
    })).rejects.toThrow('packing failed');

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
