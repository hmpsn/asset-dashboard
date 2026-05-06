import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SchemaPageCard, type SchemaPageCardProps } from '../../src/components/schema/SchemaPageCard';
import { groupValidationFindings } from '../../src/components/schema/SchemaPageCardDetails';
import type { SchemaDeliveryDecision } from '../../shared/types/schema-generation';

const schemaTemplate = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebPage', '@id': 'https://example.com/discovery#webpage', name: 'Discovery' },
  ],
};

function makeProps(overrides: Partial<SchemaPageCardProps> = {}): SchemaPageCardProps {
  return {
    page: {
      pageId: 'page-discovery',
      pageTitle: 'Discovery',
      slug: '/discovery',
      url: 'https://example.com/discovery',
      existingSchemas: [],
      suggestedSchemas: [
        {
          type: 'WebPage',
          reason: 'Generic page',
          priority: 'high',
          template: schemaTemplate,
        },
      ],
    },
    isOpen: true,
    isRegenLoading: false,
    editState: undefined,
    copiedId: null,
    published: false,
    publishing: false,
    publishError: undefined,
    manualDelivery: undefined,
    confirmPublish: false,
    sentPage: false,
    sendingPage: false,
    editingSchema: false,
    editedSchemaJson: undefined,
    schemaParseError: undefined,
    showDiff: false,
    schemaRecs: [],
    workspaceId: undefined,
    pageType: 'auto',
    isHomepage: false,
    savingTemplate: false,
    templateSaved: false,
    onPageTypeChange: vi.fn(),
    onToggleExpand: vi.fn(),
    onRegenerate: vi.fn(),
    onToggleDiff: vi.fn(),
    onToggleSchemaEdit: vi.fn(),
    onSchemaJsonChange: vi.fn(),
    onCopyTemplate: vi.fn(),
    onCopyJsonLd: vi.fn(),
    onPublish: vi.fn(),
    onConfirmPublish: vi.fn(),
    onSendToClient: vi.fn(),
    onSaveAsTemplate: vi.fn(),
    onRetract: vi.fn(),
    retracting: false,
    retracted: false,
    getEffectiveSchema: () => schemaTemplate,
    siteId: 'site-123',
    onRestore: vi.fn(),
    validationStatus: 'valid',
    ...overrides,
  };
}

describe('SchemaPageCard manual schema delivery', () => {
  it('groups validation findings by field and sorts error groups first', () => {
    const groups = groupValidationFindings([
      { severity: 'warning', type: 'Organization', field: 'publisher.logo', message: 'Logo missing', ruleId: 'required-field-missing' },
      { severity: 'error', type: 'Article', field: 'headline', message: 'Headline missing', ruleId: 'required-field-missing' },
      { severity: 'warning', type: 'Organization', field: 'publisher.logo', message: 'Logo not crawlable', ruleId: 'url-unreachable' },
    ]);

    expect(groups.map(([field, findings]) => [field, findings.length])).toEqual([
      ['headline', 1],
      ['publisher.logo', 2],
    ]);
  });

  it('renders manual Webflow schema field instructions and JSON-only copy action', () => {
    const manualDelivery: SchemaDeliveryDecision = {
      method: 'manual-native-schema-field',
      status: 'manual-required',
      reason: 'webflow-inline-script-limit',
      message: 'Copy the JSON-LD into Webflow Page Settings -> Schema markup.',
      jsonLd: JSON.stringify(schemaTemplate, null, 2),
      characterCount: 2400,
      apiLimit: 2000,
    };
    const onCopyJsonLd = vi.fn();

    render(<SchemaPageCard {...makeProps({ manualDelivery, onCopyJsonLd })} />);

    expect(screen.getByText('Manual Webflow schema paste required')).toBeInTheDocument();
    expect(screen.getAllByText(/Webflow Page Settings -> Schema markup/i)).not.toHaveLength(0);
    expect(screen.getByText(/API payload 2400\/2000 chars/i)).toBeInTheDocument();
    expect(screen.queryByText(/Publish failed/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Copy JSON-LD').at(-1)!);
    expect(onCopyJsonLd).toHaveBeenCalledWith(expect.objectContaining({ type: 'WebPage' }), 'page-discovery');
  });

  it('keeps script copy and JSON-LD copy as separate actions', () => {
    const onCopyTemplate = vi.fn();
    const onCopyJsonLd = vi.fn();

    render(<SchemaPageCard {...makeProps({ onCopyTemplate, onCopyJsonLd })} />);

    fireEvent.click(screen.getByText('Copy script'));
    expect(onCopyTemplate).toHaveBeenCalledOnce();
    expect(onCopyJsonLd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Copy JSON-LD'));
    expect(onCopyJsonLd).toHaveBeenCalledOnce();
  });
});
