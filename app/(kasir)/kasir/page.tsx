"use client";

import Link from "next/link";
import { ArrowUpRight, ReceiptText, Search } from "lucide-react";
import { WelcomeBanner } from "@/components/admin/ui";
import KasirDashboard from "@/components/kasir/KasirDashboard";
import { useKasir } from "@/components/kasir/KasirShell";

const QUICK_LINKS = [
  { href: "/kasir/struk", label: "Buat Struk", description: "Cetak kode klaim token", icon: ReceiptText },
  { href: "/kasir/status", label: "Cek Status Struk", description: "Status klaim & saldo pelanggan", icon: Search },
];

export default function KasirHomePage() {
  const { user, authFetch } = useKasir();

  return (
    <div className="space-y-6">
      <WelcomeBanner
        name={user.name || "Kasir"}
        description="Buat struk token dan pantau saldo cafe Anda."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUICK_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-primary hover:shadow-sm dark:border-neutral-700 dark:bg-neutral-800"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <item.icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-neutral-900 dark:text-white">{item.label}</span>
              <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{item.description}</span>
            </span>
            <ArrowUpRight size={16} className="shrink-0 text-neutral-300 transition group-hover:text-primary" />
          </Link>
        ))}
      </div>

      <KasirDashboard authFetch={authFetch} />
    </div>
  );
}
