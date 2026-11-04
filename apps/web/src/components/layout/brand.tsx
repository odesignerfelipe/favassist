import { cn } from '@/lib/utils';

/** Marca do produto: ícone FAV oficial + nome do produto + assinatura FAVIS. */
export function BrandMark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src="/brand/icon-192.png" alt="" width={32} height={32} className="size-8 rounded-[9px]" />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-brand">FAV Assist</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-ink">by FAVIS</div>
        </div>
      )}
    </div>
  );
}

/** Logotipo FAVIS Design Studio. `variant="light"` para fundos escuros. */
export function FavisLogo({ variant = 'default', className }: { variant?: 'default' | 'light'; className?: string }) {
  return (
    <img
      src={variant === 'light' ? '/brand/favis-logo-horizontal-light.png' : '/brand/favis-logo-horizontal.png'}
      alt="FAVIS Design Studio"
      className={cn('h-auto', className)}
    />
  );
}
