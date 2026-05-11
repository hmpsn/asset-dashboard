import { useCallback } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { Controller, useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';
import { post } from '../../api/client';
import { Icon, Button, FormField, FormInput } from '../ui';
import type { WorkspaceInfo } from './types';

export interface EmailCaptureGateProps {
  workspaceId: string;
  ws: WorkspaceInfo | null;
  onComplete: () => void;
  onSkip: () => void;
}

const emailCaptureSchema = z.object({
  name: z.string().trim().max(120, 'Keep name under 120 characters').optional().or(z.literal('')),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
});

type EmailCaptureFormValues = z.infer<typeof emailCaptureSchema>;

export function EmailCaptureGate({
  workspaceId,
  ws,
  onComplete,
  onSkip,
}: EmailCaptureGateProps) {
  const {
    control,
    handleSubmit,
    formState: { errors, dirtyFields, touchedFields, isSubmitting, isValid },
  } = useForm<EmailCaptureFormValues>({
    resolver: zodResolver(emailCaptureSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      email: '',
    },
  });

  const submitEmailCapture: SubmitHandler<EmailCaptureFormValues> = useCallback(
    async (values) => {
      const email = values.email.trim();
      const name = values.name?.trim();
      try {
        await post(`/api/public/capture-email/${workspaceId}`, {
          email,
          name: name || undefined,
        });
        localStorage.setItem(`portal_email_${workspaceId}`, email);
      } catch (err) {
        console.error('EmailCaptureGate operation failed:', err);
      }
      onComplete();
    },
    [workspaceId, onComplete]
  );

  const handleSkip = () => {
    try {
      localStorage.setItem(`portal_email_${workspaceId}`, '__skipped__');
    } catch (err) {
      console.error('EmailCaptureGate operation failed:', err);
    }
    onSkip();
  };

  return (
    <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* pr-check-disable-next-line -- full-screen email gate card uses brand signature radius intentionally */}
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-8 shadow-2xl shadow-black/40" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-teal-500/10 flex items-center justify-center mb-4">
              <Icon as={Mail} size="xl" className="text-accent-brand" />
            </div>
            <h2 className="t-h2 text-[var(--brand-text-bright)]">Welcome to {ws?.name}</h2>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 text-center">
              Enter your email to receive performance reports and important updates about your site.
            </p>
          </div>
          <form onSubmit={handleSubmit(submitEmailCapture)} className="space-y-3" noValidate>
            <Controller
              control={control}
              name="name"
              render={({ field }) => (
                <FormField
                  label="Your name"
                  error={errors.name?.message}
                  hint="Optional"
                  valid={Boolean(dirtyFields.name && field.value && !errors.name)}
                >
                  <FormInput
                    {...field}
                    type="text"
                    value={field.value ?? ''}
                    placeholder="Your name"
                    autoComplete="name"
                    className="bg-[var(--surface-3)] rounded-[var(--radius-xl)] px-4 py-3 t-body text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)]"
                  />
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <FormField
                  label="Email address"
                  error={errors.email?.message}
                  success="Email looks good"
                  valid={Boolean(field.value && (dirtyFields.email || touchedFields.email) && !errors.email)}
                  required
                >
                  <FormInput
                    {...field}
                    type="email"
                    value={field.value}
                    placeholder="Your email address"
                    autoComplete="email"
                    className="bg-[var(--surface-3)] rounded-[var(--radius-xl)] px-4 py-3 t-body text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)]"
                    autoFocus
                  />
                </FormField>
              )}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !isValid}
              loading={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? '' : 'Continue to Dashboard'}
            </Button>
            <button
              type="button"
              onClick={handleSkip}
              className="w-full text-center t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              Skip for now
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
