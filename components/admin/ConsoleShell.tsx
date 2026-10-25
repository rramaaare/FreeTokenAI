'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';

export type ConsoleRole = 'super_admin' | 'kasir';

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const NAV: Record<ConsoleRole, NavGroup[]> = {
  super_admin: [
    { label: 'Ringkasan', items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard }] },
    {
      label: 'Manajemen',
      items: [
        { href: '/admin/users', label: 'Kafe, Kasir & Pengguna', icon: Users },
        { href: '/admin/packages', label: 'Master Paket', icon: Package },
      ],
    },
    {
      label: 'Keuangan',
      items: [{ href: '/admin/transactions', label: 'Riwayat Transaksi', icon: ScrollText }],
    },
    {
      label: 'Sistem',
      items: [
        { href: '/admin/api-keys', label: 'API Key Pelanggan', icon: KeyRound },
        { href: '/admin/models', label: 'Provider & Model AI', icon: SlidersHorizontal },
        { href: '/admin/rbac', label: 'Peran & Hak Akses', icon: ShieldCheck },
      ],
    },
  ],
  kasir: [
    {
      label: 'Operasional',
      items: [
        { href: '/kasir', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/kasir/struk', label: 'Buat Struk', icon: ReceiptText },
        { href: '/kasir/status', label: 'Cek Status Struk', icon: Search },
      ],
    },
  ],
};

const EXTRA_TITLES: [string, string][] = [['/admin/cafes', 'Detail Cafe']];

const ROLE_LABEL: Record<ConsoleRole, string> = { super_admin: 'Super Admin', kasir: 'Kasir' };
const PANEL_LABEL: Record<ConsoleRole, string> = { super_admin: 'Admin Panel', kasir: 'Kasir Panel' };

function isActive(pathname: string, href: string) {
  return href === '/admin' || href === '/kasir' ? pathname === href : pathname.startsWith(href);
}

function pageTitle(pathname: string) {
  const item = NAV.super_admin
    .concat(NAV.kasir)
    .flatMap((g) => g.items)
    .find((i) => isActive(pathname, i.href));
  if (item) return item.label;
  const extra = EXTRA_TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return extra?.[1] ?? 'Dashboard';
}

function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

export default function ConsoleShell({
  role,
  name,
  email,
  onLogout,
  children,
}: {
  role: ConsoleRole;
  name: string;
  email?: string;
  onLogout?: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? (role === 'kasir' ? '/kasir' : '/admin');
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function logout() {
    setLoggingOut(true);
    try {
      if (onLogout) onLogout();
      else await fetch('/api/v1/admin/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      if (!onLogout) window.location.assign('/admin/login');
      else setLoggingOut(false);
    }
  }

  const groups = NAV[role];
  const title = pageTitle(pathname);

  const nav = (
    <div className="flex-1 overflow-y-auto px-3 pb-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400 dark:text-neutral-500">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const cls = `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition ${
                active
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white'
              }`;
              return (
                <li key={item.href}>
                  <Link href={item.href} className={cls} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}>
                    <item.icon size={17} className="shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  const footer = (
    <div className="border-t border-neutral-200 p-3 dark:border-neutral-700/70">
      <div className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initials(name || email || ROLE_LABEL[role])}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-neutral-900 dark:text-white">{name || ROLE_LABEL[role]}</p>
          <p className="truncate text-[11px] text-neutral-400">{email || ROLE_LABEL[role]}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={logout}
        disabled={loggingOut}
        className="mt-1.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <LogOut size={17} className="shrink-0" />
        {loggingOut ? 'Keluar...' : 'Logout'}
      </button>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary">
        <Image src="/logo-ftk.svg" alt="FreeTokenAI" width={20} height={18} priority />
      </span>
      <div className="min-w-0">
        <p className="font-sf truncate text-[15px] font-semibold leading-tight text-neutral-900 dark:text-white">FreeTokenAI</p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{PANEL_LABEL[role]}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-neutral-100/70 dark:bg-neutral-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex print:hidden">
        {brand}
        {nav}
        {footer}
      </aside>

      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-neutral-200/80 bg-white/85 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85 lg:px-8 print:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Buka menu"
            className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800 lg:hidden"
          >
            <Menu size={18} />
          </button>
          <p className="flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-white">{title}</p>
          {email && <span className="hidden max-w-[220px] truncate text-xs text-neutral-400 sm:block">{email}</span>}
          <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Bell size={16} className="text-neutral-500 dark:text-neutral-400" />
          </span>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button type="button" aria-label="Tutup menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-neutral-900/50" />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl dark:bg-neutral-900">
            <div className="flex items-start justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup"
                className="mr-3 mt-5 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X size={18} />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}
    </div>
  );
}
