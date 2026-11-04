import { cn } from '@/lib/utils';

/**
 * Marca do produto. PROVISÓRIA: quando o logotipo oficial da FAVIS chegar,
 * substitua o conteúdo por <img src="/brand/logo.svg" … /> (ver public/brand/README.md).
 */
export function BrandMark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src="/brand/icon.svg" alt="" className="size-8 rounded-lg" />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">FAV Assist</div>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">by FAVIS</div>
        </div>
      )}
    </div>
  );
}
