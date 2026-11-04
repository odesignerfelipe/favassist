import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@fav/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <div className="hidden flex-col justify-between bg-brand p-12 text-brand-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <img src="/brand/icon.svg" alt="" className="size-9 rounded-lg ring-1 ring-white/20" />
          <span className="text-lg font-semibold">FAV Assist</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Planejamento estratégico de conteúdo, do roteiro à execução.
          </p>
          <p className="mt-4 text-brand-foreground/70">
            Diagnóstico, calendário, campanhas e acompanhamento da equipe em um só lugar.
          </p>
        </div>
        <p className="text-sm text-brand-foreground/60">by FAVIS Design Studio</p>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <BrandMark className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="mt-1 text-muted-foreground">Use o e-mail cadastrado pela equipe FAVIS.</p>
          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
            <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
              <Input type="email" autoComplete="email" inputMode="email" autoFocus {...form.register('email')} />
            </Field>
            <Field label="Senha" htmlFor="password" error={form.formState.errors.password?.message}>
              <Input type="password" autoComplete="current-password" {...form.register('password')} />
            </Field>
            {error && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="mt-2">
              Entrar
            </Button>
          </form>
          <p className="mt-8 text-center text-[13px] text-muted-foreground">Esqueceu a senha? Fale com a equipe FAVIS.</p>
        </div>
      </div>
    </div>
  );
}
