import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  SchemaBusinessProfileCallout,
  SchemaCmsFieldMappingPanel,
  SchemaGeneratorHero,
  SchemaInitialPageTypePicker,
} from '../../src/components/schema/SchemaGeneratorSetup';
import type { SchemaMappingCollection } from '../../src/components/schema/schemaSuggesterTypes';

describe('SchemaGeneratorSetup', () => {
  it('shows and dismisses the business profile schema callout when address data is missing', () => {
    const onDismiss = vi.fn();

    render(
      <MemoryRouter>
        <SchemaBusinessProfileCallout
          businessProfile={{ address: { street: '', city: '' } }}
          dismissed={false}
          workspaceId="workspace-1"
          onDismiss={onDismiss}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Your business profile is incomplete');
    expect(screen.getByRole('link', { name: /complete business profile/i })).toHaveAttribute(
      'href',
      '/ws/workspace-1/workspace-settings?tab=business-profile',
    );

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('wires generator hero actions to scan and CMS template handlers', () => {
    const onRunScan = vi.fn();
    const onFetchCmsTemplatePages = vi.fn();

    render(
      <SchemaGeneratorHero
        loadingCmsPages={false}
        onRunScan={onRunScan}
        onFetchCmsTemplatePages={onFetchCmsTemplatePages}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generate all pages/i }));
    expect(onRunScan).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /cms templates/i }));
    expect(onFetchCmsTemplatePages).toHaveBeenCalledOnce();
  });

  it('keeps initial page type selection and single-page generation wired through props', () => {
    const onPageTypesChange = vi.fn();
    const onGenerateSinglePage = vi.fn();

    render(
      <SchemaInitialPageTypePicker
        availablePages={[{ id: 'page-1', title: 'Service Page', slug: 'services' }]}
        filteredPages={[{ id: 'page-1', title: 'Service Page', slug: 'services' }]}
        pageSearch=""
        pageTypes={{}}
        loadingPages={false}
        generatingSingle={null}
        onPageSearchChange={vi.fn()}
        onPageTypesChange={onPageTypesChange}
        onGenerateSinglePage={onGenerateSinglePage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /guide/i }));
    expect(screen.getByText(/Google knowledge panel/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'service' } });
    expect(onPageTypesChange).toHaveBeenCalledOnce();
    expect(onPageTypesChange.mock.calls[0]?.[0]({})).toEqual({ 'page-1': 'service' });

    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(onGenerateSinglePage).toHaveBeenCalledWith('page-1');
  });

  it('renders CMS mapping controls and saves selected field mappings', () => {
    const onSaveCmsFieldMapping = vi.fn();
    const collection: SchemaMappingCollection = {
      collectionId: 'collection-1',
      collectionName: 'Locations',
      collectionSlug: 'locations',
      schemaRole: 'location',
      fields: [
        { slug: 'name', displayName: 'Name', type: 'PlainText', target: 'locationName' },
        { slug: 'city', displayName: 'City', type: 'PlainText' },
      ],
      mapping: null,
    };

    render(
      <SchemaCmsFieldMappingPanel
        collections={[collection]}
        cmsMappingError="Mapping warning"
        savingCmsMapping={null}
        fieldMappingTargets={[{ target: 'locationName', label: 'Location name', roles: ['location'] }]}
        onSaveCmsFieldMapping={onSaveCmsFieldMapping}
        maxCollections={5}
      />,
    );

    expect(screen.getByText('Collection field mapping')).toBeInTheDocument();
    expect(screen.getByText('Mapping warning')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: /location name/i }), { target: { value: 'city' } });
    expect(onSaveCmsFieldMapping).toHaveBeenCalledWith(collection, 'locationName', 'city');
  });
});
