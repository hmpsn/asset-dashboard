import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormField } from '../../../src/components/ui/forms/FormField';
import { FormInput } from '../../../src/components/ui/forms/FormInput';
import { FormSelect } from '../../../src/components/ui/forms/FormSelect';
import { FormTextarea } from '../../../src/components/ui/forms/FormTextarea';
import { Checkbox } from '../../../src/components/ui/forms/Checkbox';
import { Toggle } from '../../../src/components/ui/forms/Toggle';

// ─── FormField ───────────────────────────────────────────────────────────────

describe('FormField', () => {
  it('renders label', () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>
    );
    expect(screen.getByText('Email')).toBeTruthy();
  });

  it('shows red asterisk when required', () => {
    const { container } = render(
      <FormField label="Name" required>
        <input />
      </FormField>
    );
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('*');
  });

  it('shows error message and hides hint when error is set', () => {
    render(
      <FormField label="Email" error="Invalid email" hint="Enter your email">
        <input />
      </FormField>
    );
    expect(screen.getByRole('alert').textContent).toBe('Invalid email');
    expect(screen.queryByText('Enter your email')).toBeNull();
  });

  it('shows hint when no error', () => {
    render(
      <FormField label="Email" hint="Enter your work email">
        <input />
      </FormField>
    );
    expect(screen.getByText('Enter your work email')).toBeTruthy();
  });

  it('passes error state to child FormInput via context', () => {
    const { container } = render(
      <FormField label="Email" error="Required">
        <FormInput value="" onChange={vi.fn()} />
      </FormField>
    );
    const input = container.querySelector('input');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.className).toContain('border-red-500/50');
  });

  it('wires label htmlFor to child input id (clicking label focuses input)', () => {
    render(
      <FormField label="Email">
        <FormInput value="" onChange={vi.fn()} />
      </FormField>
    );
    // getByLabelText resolves the htmlFor↔id pairing — passing here
    // confirms the label is semantically associated with the input.
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
  });

  it('caller-provided id wins over auto-generated id', () => {
    const { container } = render(
      <FormField label="Email">
        <FormInput id="custom-id" value="" onChange={vi.fn()} />
      </FormField>
    );
    expect(container.querySelector('input')?.id).toBe('custom-id');
  });

  it('wires aria-describedby to error message id', () => {
    const { container } = render(
      <FormField label="Email" error="Required">
        <FormInput value="" onChange={vi.fn()} />
      </FormField>
    );
    const input = container.querySelector('input');
    const describedBy = input?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorEl = container.querySelector(`#${describedBy}`);
    expect(errorEl?.textContent).toBe('Required');
  });
});

// ─── FormInput ───────────────────────────────────────────────────────────────

describe('FormInput', () => {
  it('renders with value', () => {
    const { container } = render(<FormInput value="hello" onChange={vi.fn()} />);
    const input = container.querySelector('input');
    expect(input?.value).toBe('hello');
  });

  it('fires onChange with new value', () => {
    const onChange = vi.fn();
    const { container } = render(<FormInput value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('input')!, { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalledWith('test');
  });

  it('appends className', () => {
    const { container } = render(
      <FormInput value="" onChange={vi.fn()} className="custom-class" />
    );
    expect(container.querySelector('input')?.className).toContain('custom-class');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<FormInput ref={ref} value="" onChange={vi.fn()} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});

// ─── FormSelect ──────────────────────────────────────────────────────────────

const OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

describe('FormSelect', () => {
  it('renders all options', () => {
    render(<FormSelect options={OPTIONS} value="a" onChange={vi.fn()} />);
    expect(screen.getByText('Option A')).toBeTruthy();
    expect(screen.getByText('Option B')).toBeTruthy();
    expect(screen.getByText('Option C')).toBeTruthy();
  });

  it('fires onChange with selected value', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FormSelect options={OPTIONS} value="a" onChange={onChange} />
    );
    fireEvent.change(container.querySelector('select')!, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('appends className', () => {
    const { container } = render(
      <FormSelect options={OPTIONS} value="a" onChange={vi.fn()} className="my-class" />
    );
    expect(container.querySelector('select')?.className).toContain('my-class');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(<FormSelect ref={ref} options={OPTIONS} value="a" onChange={vi.fn()} />);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it('shows error border via context', () => {
    const { container } = render(
      <FormField label="Pick" error="Required">
        <FormSelect options={OPTIONS} value="" onChange={vi.fn()} />
      </FormField>
    );
    expect(container.querySelector('select')?.className).toContain('border-red-500/50');
  });
});

// ─── FormTextarea ─────────────────────────────────────────────────────────────

describe('FormTextarea', () => {
  it('renders with value', () => {
    const { container } = render(<FormTextarea value="hello" onChange={vi.fn()} />);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('fires onChange with new value', () => {
    const onChange = vi.fn();
    const { container } = render(<FormTextarea value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'new text' } });
    expect(onChange).toHaveBeenCalledWith('new text');
  });

  it('shows character counter when maxLength is set', () => {
    render(<FormTextarea value="hello" onChange={vi.fn()} maxLength={100} />);
    expect(screen.getByText('5/100')).toBeTruthy();
  });

  it('counter turns red near limit', () => {
    render(<FormTextarea value={'x'.repeat(95)} onChange={vi.fn()} maxLength={100} />);
    const counter = screen.getByText('95/100');
    expect(counter.className).toContain('text-red-400');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<FormTextarea ref={ref} value="" onChange={vi.fn()} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });
});

// ─── Checkbox ────────────────────────────────────────────────────────────────

describe('Checkbox', () => {
  it('renders with label', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Accept terms" />);
    expect(screen.getByText('Accept terms')).toBeTruthy();
  });

  it('reflects checked state', () => {
    const { container } = render(
      <Checkbox checked={true} onChange={vi.fn()} label="Active" />
    );
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Checkbox checked={false} onChange={onChange} label="Subscribe" />
    );
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('fires onChange when label is clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Subscribe" />);
    fireEvent.click(screen.getByText('Subscribe'));
    expect(onChange).toHaveBeenCalled();
  });

  it('handles Space key via native checkbox', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Checkbox checked={false} onChange={onChange} label="Toggle me" />
    );
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: ' ', code: 'Space' });
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalled();
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} checked={false} onChange={vi.fn()} label="Ref test" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});

// ─── Toggle ──────────────────────────────────────────────────────────────────

describe('Toggle', () => {
  it('renders with label', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Enable feature" />);
    expect(screen.getByText('Enable feature')).toBeTruthy();
  });

  it('reflects checked state', () => {
    const { container } = render(
      <Toggle checked={true} onChange={vi.fn()} label="On" />
    );
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Toggle checked={false} onChange={onChange} label="Notifications" />
    );
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('fires onChange when label is clicked', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Notifications" />);
    fireEvent.click(screen.getByText('Notifications'));
    expect(onChange).toHaveBeenCalled();
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Toggle ref={ref} checked={false} onChange={vi.fn()} label="Ref test" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('disabled sets the input disabled attribute (native click prevention)', () => {
    // Native browser click-prevention on disabled checkboxes is not simulated
    // in jsdom — so we assert the disabled ATTRIBUTE rather than trying to
    // catch a non-invocation. Real browsers handle the behavioral side.
    const { container } = render(
      <Toggle checked={false} onChange={vi.fn()} label="Off" disabled />
    );
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('disabled dims the wrapping label via opacity', () => {
    const { container } = render(
      <Toggle checked={false} onChange={vi.fn()} label="Off" disabled />
    );
    const label = container.querySelector('label');
    expect(label?.className).toContain('opacity-50');
  });

  it('uses role="switch" on the underlying input (WAI-ARIA)', () => {
    const { container } = render(
      <Toggle checked={false} onChange={vi.fn()} label="x" />
    );
    const input = container.querySelector('input[type="checkbox"]');
    expect(input?.getAttribute('role')).toBe('switch');
  });

  it('does NOT set redundant aria-checked (implicit on native checkbox+switch)', () => {
    const { container } = render(
      <Toggle checked={true} onChange={vi.fn()} label="x" />
    );
    // Native <input type=checkbox role=switch> announces checked state via the
    // `checked` attribute; an explicit aria-checked is redundant and risks
    // desyncing if the two ever diverge.
    const input = container.querySelector('input[type="checkbox"]');
    expect(input?.hasAttribute('aria-checked')).toBe(false);
  });
});
