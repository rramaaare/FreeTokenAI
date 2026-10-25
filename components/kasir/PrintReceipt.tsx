"use client";

import { Printer } from "lucide-react";
import { idr } from "@/components/kasir/KasirShell";

export type PrintableReceipt = {
  code: string;
  claim_url: string;
  tokens: number;
  purchase_type: string | null;
  rupiah_amount: number | null;
  created_at: string;
  expires_at?: string | null;
  pos_reference_id?: string | null;
  cafe_name?: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  product: "Bonus belanja produk",
  retail: "Beli token ketengan",
  package: "Paket token",
  manual: "Token manual",
};

// ponytail: struk cetak thermal 58mm. Saat window.print(), globals.css
// menyembunyikan semua elemen kecuali .print-receipt (lihat @media print).
export default function PrintReceipt({ receipt, cashier }: { receipt: PrintableReceipt; cashier?: string }) {
  const qr = `/api/v1/receipts/${encodeURIComponent(receipt.code)}/qr.png`;
  const label = TYPE_LABEL[receipt.purchase_type ?? "manual"] ?? "Token";
  const fmt = (v: string) => new Date(v).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const created = fmt(receipt.created_at);

  return (
    <div className="space-y-3">
      <div className="print-receipt mx-auto w-full max-w-[280px] rounded-lg border border-dashed border-neutral-300 bg-white p-4 font-mono text-[11px] leading-relaxed text-neutral-900">
        <div className="text-center">
          <p className="text-sm font-bold">{receipt.cafe_name || "FreeTokenAI"}</p>
          <p className="text-[10px] text-neutral-500">Struk Token AI · FreeTokenAI</p>
        </div>
        <hr className="my-2 border-dashed border-neutral-300" />
        <Row k="Tanggal" v={created} />
        {receipt.pos_reference_id && <Row k="Ref" v={receipt.pos_reference_id} />}
        {cashier && <Row k="Kasir" v={cashier} />}
        <hr className="my-2 border-dashed border-neutral-300" />
        <Row k="Jenis" v={label} />
        {receipt.rupiah_amount != null && (
          <Row k={receipt.purchase_type === "product" ? "Total belanja" : "Harga"} v={idr(receipt.rupiah_amount)} />
        )}
        <Row k="Token" v={`${receipt.tokens.toLocaleString("id-ID")} token`} bold />
        {receipt.expires_at && <Row k="Klaim sebelum" v={fmt(receipt.expires_at)} bold />}
        <hr className="my-2 border-dashed border-neutral-300" />
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG dinamis dari API, bukan aset statis */}
          <img src={qr} alt={`QR klaim ${receipt.code}`} width={150} height={150} className="mx-auto" />
          <p className="mt-1 text-base font-bold tracking-widest">{receipt.code}</p>
          <p className="mt-1 text-[10px]">Scan QR atau buka</p>
          <p className="break-all text-[10px]">{receipt.claim_url}</p>
          <p className="mt-2 text-[10px] text-neutral-500">Lewat batas klaim, kode hangus. Klaim menambah masa aktif 7 hari (maks 30 hari). Satu kode untuk satu kali klaim.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.print()}
        className="mx-auto flex w-full max-w-[280px] items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 print:hidden dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        <Printer size={16} /> Cetak Struk
      </button>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-neutral-500">{k}</span>
      <span className={`text-right ${bold ? "font-bold" : ""}`}>{v}</span>
    </div>
  );
}
