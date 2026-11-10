import { clsx, type ClassValue } from 'clsx';
import { addDays, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Data local no formato AAAA-MM-DD */
export function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export const todayISO = () => toISODate(new Date());

export function fromISODate(iso: string): Date {
  return parseISO(iso);
}

export function formatDate(iso: string | null | undefined, pattern = "d 'de' MMM"): string {
  if (!iso) return '—';
  return format(parseISO(iso), pattern, { locale: ptBR });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: ptBR });
}

export function weekRange(base: Date) {
  const from = startOfWeek(base, { weekStartsOn: 1 });
  return { from: toISODate(from), to: toISODate(endOfWeek(base, { weekStartsOn: 1 })) };
}

export function monthRange(base: Date) {
  return { from: toISODate(startOfMonth(base)), to: toISODate(endOfMonth(base)) };
}

export function shiftISO(iso: string, days: number) {
  return toISODate(addDays(parseISO(iso), days));
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function pct(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Math.round(value)}%`;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Valor em dólares (custos de IA). Valores muito pequenos ganham 4 casas. */
export function formatUsd(v: number): string {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: v > 0 && v < 0.01 ? 4 : 2,
  });
}
