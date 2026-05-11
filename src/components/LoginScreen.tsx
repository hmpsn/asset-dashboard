import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react';
import { Controller, useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';
import { Icon, Button, FormField, FormInput } from './ui';

interface Props {
  onLogin: (password: string) => Promise<boolean>;
}

const loginSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginScreen({ onLogin }: Props) {
  const {
    control,
    handleSubmit,
    resetField,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onChange',
    defaultValues: {
      password: '',
    },
  });

  const submitLogin: SubmitHandler<LoginFormValues> = async ({ password }) => {
    const ok = await onLogin(password);
    if (!ok) {
      resetField('password');
      setError('password', {
        type: 'manual',
        message: 'Incorrect password',
      });
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-[var(--surface-1)]">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/logo.svg" alt="hmpsn.studio" className="h-9" />
          <p className="t-caption text-[var(--brand-text-muted)]">Asset Dashboard</p>
        </div>

        <form onSubmit={handleSubmit(submitLogin)} className="space-y-3" noValidate>
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <FormField label="Password" error={errors.password?.message} required>
                <div className="relative">
                  <Icon as={Lock} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
                  <FormInput
                    {...field}
                    type="password"
                    value={field.value}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    autoFocus
                    className="pl-10 pr-4 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-2)] text-[var(--brand-text)]"
                  />
                </div>
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
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
