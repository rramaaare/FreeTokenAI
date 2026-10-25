'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, Info, Loader2, X } from 'lucide-react';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
  info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  neutral: 'bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700',
};

export const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-primary dark:border-neutral-600 dark:bg-neutral-900 dark:text-white';

export const cardCls =
  'rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-800';

export function PageHeader({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export function Alert({
  tone = 'danger',
  children,
  onClose,
}: {
  tone?: 'success' | 'danger' | 'info';
  children: ReactNode;
  onClose?: () => void;
}) {
  const map = {
    success: { cls: TONE.success, Icon: CheckCircle2 },
    danger: { cls: TONE.danger, Icon: AlertCircle },
    info: { cls: TONE.info, Icon: Info },
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${map.cls}`}>
      <map.Icon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Tutup">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const LABEL_TONE: Record<Tone, string> = {
  primary: 'text-primary',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
  info: 'text-blue-600 dark:text-blue-400',
  neutral: 'text-neutral-500 dark:text-neutral-400',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`${cardCls} min-w-0 p-4 sm:p-5`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-[11px] font-semibold uppercase leading-4 tracking-wide ${LABEL_TONE[tone]}`}>{label}</p>
        {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE[tone]}`}>{icon}</span>}
      </div>
      <p className="mt-2 break-words text-xl font-bold tabular-nums text-neutral-900 dark:text-white sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
    </div>
  );
}

export function WelcomeBanner({ name, description }: { name: string; description: string }) {
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    );
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-[#7c2d12] px-6 py-6 text-white shadow-sm sm:px-8 print:hidden">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/30 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Selamat Datang Kembali, {name}!</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/70">{description}</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 backdrop-blur sm:self-auto">
          <CalendarDays size={16} className="text-primary" />
          {today || 'Hari ini'}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      {icon && <div className="mb-3 text-neutral-300 dark:text-neutral-600">{icon}</div>}
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-neutral-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Memuat...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-400">
      <Loader2 size={18} className="animate-spin text-primary" />
      {label}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Tutup" onClick={onClose} className="absolute inset-0 cursor-default bg-neutral-900/60 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative w-full ${width} max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800`}>
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-4 dark:border-neutral-700">
          {icon}
          <h2 className="font-semibold text-neutral-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Tutup" className="ml-auto rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 px-5 py-4 dark:border-neutral-700">{footer}</div>}
      </div>
    </div>
  );
}
