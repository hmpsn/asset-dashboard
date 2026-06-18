import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CockpitSendPanel } from '../../../src/components/strategy/CockpitSendPanel';

describe('CockpitSendPanel', () => {
  it('renders the textarea', () => {
    render(<CockpitSendPanel onSend={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('Enter sends the note immediately', () => {
    const onSend = vi.fn();
    render(<CockpitSendPanel onSend={onSend} onCancel={vi.fn()} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'great idea' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('great idea');
  });

  it('Enter with empty note sends empty string (zero-friction path)', () => {
    const onSend = vi.fn();
    render(<CockpitSendPanel onSend={onSend} onCancel={vi.fn()} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('');
  });

  it('Shift+Enter does NOT fire onSend', () => {
    const onSend = vi.fn();
    render(<CockpitSendPanel onSend={onSend} onCancel={vi.fn()} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Escape fires onCancel without sending', () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(<CockpitSendPanel onSend={onSend} onCancel={onCancel} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Send to client button fires onSend', () => {
    const onSend = vi.fn();
    render(<CockpitSendPanel onSend={onSend} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    expect(onSend).toHaveBeenCalled();
  });
});
