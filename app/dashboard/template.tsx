// Template (beda dengan layout) remount tiap navigasi, jadi tempat yang tepat
// untuk animasi masuk konten. Wrapper flex disamakan dengan <main> agar class
// root tiap panel (h-full / min-h-0 flex-1 / mx-auto) tetap berperilaku sama.
// min-w-0: tanpa ini wrapper melebar mengikuti konten terlebar (blok kode,
// tabel) sehingga Developer/Pengaturan meluber keluar layar HP.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex min-h-0 min-w-0 flex-1">{children}</div>;
}
