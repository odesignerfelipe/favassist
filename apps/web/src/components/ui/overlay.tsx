import { X } from 'lucide-react';
import { Dialog as D, DropdownMenu as DM } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------- Dialog / Sheet ----------------
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

interface ContentProps extends React.ComponentPropsWithoutRef<typeof D.Content> {
  /** "sheet" abre como painel lateral (ou inferior no celular) */
  variant?: 'dialog' | 'sheet';
  title: string;
  description?: string;
  hideTitle?: boolean;
}

export function DialogContent({ variant = 'dialog', title, description, hideTitle, className, children, ...props }: ContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          'fixed z-50 flex flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-fade-in',
          variant === 'dialog'
            ? 'left-1/2 top-1/2 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border'
            : 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-none sm:border-l sm:border-t-0',
          className,
        )}
        {...props}
      >
        <div className={cn('flex items-start justify-between gap-4 border-b px-5 py-4', hideTitle && 'sr-only')}>
          <div className="min-w-0">
            <D.Title className="text-base font-semibold leading-snug">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-muted-foreground">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground" aria-label="Fechar">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-surface px-5 py-3 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

// ---------------- Dropdown ----------------
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentPropsWithoutRef<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-48 rounded-lg border bg-surface p-1 shadow-lg data-[state=open]:animate-fade-in', className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Label>) {
  return <DM.Label className={cn('px-2.5 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
}

export const DropdownMenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
