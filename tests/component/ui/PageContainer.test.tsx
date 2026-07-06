import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PageContainer } from '../../../src/components/ui/layout/PageContainer';
import { expectNoA11yViolations } from '../a11y';

afterEach(() => {
  cleanup();
});

describe('PageContainer', () => {
  it('maps width="default" to --page-max', () => {
    const { container } = render(<PageContainer>content</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.maxWidth).toBe('var(--page-max)');
  });

  it('maps width="narrow" to --page-max-narrow', () => {
    const { container } = render(<PageContainer width="narrow">content</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.maxWidth).toBe('var(--page-max-narrow)');
  });

  it('maps width="wide" to --page-max-wide', () => {
    const { container } = render(<PageContainer width="wide">content</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.maxWidth).toBe('var(--page-max-wide)');
  });

  it('maps width="full" to no max-width', () => {
    const { container } = render(<PageContainer width="full">content</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.maxWidth).toBe('none');
  });

  it('maps a numeric width to an explicit px value', () => {
    const { container } = render(<PageContainer width={900}>content</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.maxWidth).toBe('900px');
  });

  it('renders a <main> landmark when as="main"', () => {
    render(
      <PageContainer as="main">
        <div>Landmark content</div>
      </PageContainer>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders a <div> by default', () => {
    const { container } = render(<PageContainer>content</PageContainer>);
    expect(container.querySelector('main')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('DIV');
  });

  it('stacks children as a flex column with --section-gap by default', () => {
    const { container } = render(
      <PageContainer>
        <div>One</div>
        <div>Two</div>
      </PageContainer>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.display).toBe('flex');
    expect(el.style.flexDirection).toBe('column');
    expect(el.style.gap).toBe('var(--section-gap)');
  });

  it('does not apply flex/gap when gap is false', () => {
    const { container } = render(<PageContainer gap={false}>content</PageContainer>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.display).not.toBe('flex');
    expect(el.style.gap).toBe('');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<PageContainer>content</PageContainer>);
    await expectNoA11yViolations(container);
  }, 15_000);
});
