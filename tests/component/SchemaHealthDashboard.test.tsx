/**
 * Component tests for Phase 3 — Schema Health Dashboard.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaHealthDashboard } from '../../src/components/schema/SchemaHealthDashboard';

interface ValidationRecord {
  id: string;
  pageId: string;
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
  validatedAt: string;
}

const mockValidations: ValidationRecord[] = [
  {
    id: '1',
    pageId: 'https://example.com/',
    status: 'valid',
    richResults: ['Organization', 'WebSite'],
    errors: [],
    warnings: [],
    validatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    pageId: 'https://example.com/blog/post',
    status: 'warnings',
    richResults: ['Article'],
    errors: [],
    warnings: [{ type: 'Article', message: 'Missing recommended property "dateModified"' }],
    validatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    pageId: 'https://example.com/faq',
    status: 'errors',
    richResults: [],
    errors: [{ type: 'FAQPage', message: 'Missing required property "mainEntity"' }],
    warnings: [],
    validatedAt: new Date().toISOString(),
  },
];

describe('SchemaHealthDashboard', () => {
  it('renders the dashboard title', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText(/Schema Health/i)).toBeTruthy();
  });

  it('shows aggregated counts — valid, warnings, errors', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText(/1 valid/i)).toBeTruthy();
    expect(screen.getByText(/1 warnings/i)).toBeTruthy();
    expect(screen.getByText(/1 errors/i)).toBeTruthy();
  });

  it('renders a row for each validation', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    // pageLabel() strips to pathname: "/", "/blog/post", "/faq"
    expect(screen.getByText('/blog/post')).toBeTruthy();
    expect(screen.getByText('/faq')).toBeTruthy();
  });

  it('shows valid badge for valid pages', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText('Valid')).toBeTruthy();
  });

  it('shows error badge for pages with errors', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText('Errors')).toBeTruthy();
  });

  it('shows warning badge for pages with warnings', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText('Warnings')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    const { container } = render(<SchemaHealthDashboard validations={[]} loading={true} onRevalidate={vi.fn()} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows empty state when no validations', () => {
    render(<SchemaHealthDashboard validations={[]} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText(/no.*validat/i)).toBeTruthy();
  });

  it('shows rich result types for valid pages', () => {
    render(<SchemaHealthDashboard validations={mockValidations} loading={false} onRevalidate={vi.fn()} />);
    expect(screen.getByText('Organization')).toBeTruthy();
  });
});
