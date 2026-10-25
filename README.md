# FreeTokenAI — Web

Platform token AI untuk kafe/restoran. **Admin** menerbitkan token ke kafe, **kafe** membagikannya ke pelanggan lewat **struk ber-QR**, dan **pelanggan** memakai token itu untuk Chat, Gambar, Video, dan Developer API.

Stack: Next.js 16 (App Router), React 18, Tailwind, PostgreSQL (`postgres.js`), Redis. Provider AI: Groq, Google Gemini, VioStudio.

---

## Alur Bisnis

```
ADMIN (pusat)          KAFE / KASIR             PELANGGAN                 SERVER FreeTokenAI → Provider AI
terbitkan token  ──►   saldo prepaid kafe  ──►  struk QR ──► /claim  ──►  Chat · Gambar · Video · API
(top-up saat kafe      buat struk:              saldo akun (masa aktif)   (pakai API key provider milik
 membayar)             Beli Produk / Ketengan                              admin, tak pernah dibagikan)
                            ▲                         │
                            └── struk tak diklaim 7 hari → token kembali ke saldo kafe
```

| Peran | Halaman | Tugas |
|---|---|---|
| **Super admin** | `/admin` | Kelola kafe & akun kasir, isi saldo prepaid kafe, atur tarif kafe, master paket (global / per kafe), provider & model AI, pantau transaksi & API key pelanggan |
| **Kasir** | `/kasir` | Buat & cetak struk QR, cek status struk, pantau penjualan & saldo kafe |
| **Pelanggan** | `/claim`, `/dashboard` | Klaim struk → pakai Chat/Gambar/Video, buat API key Developer sendiri |

Pembayaran (kafe → admin, pelanggan → kasir) terjadi di luar sistem; sistem mencatat pergerakan token. Hak akses diatur di `/admin/rbac` dan ditegakkan di server (403 `PERMISSION_DENIED`).

### Menu admin

| Menu | Isi |
|---|---|
| Dashboard | Ringkasan saldo + daftar kafe |
| Kafe, Kasir & Pengguna | CRUD akun kasir/admin, tambah kafe, tambah saldo pelanggan manual |
| Master Paket | Paket “hemat” untuk kasir. Tanpa kafe = global, dengan kafe = khusus kafe itu |
| Riwayat Transaksi | Ledger saldo kafe: top-up, terbit struk, struk hangus (refund), koreksi |
| API Key Pelanggan | Key Developer milik pelanggan, pemakaian 30 hari, cabut bila disalahgunakan |
| Provider & Model AI | API key provider (terenkripsi) & katalog model + biaya Token |
| Peran & Hak Akses | Matriks centang per peran: mode struk & dashboard kasir, Chat/Gambar/Video/Developer API pelanggan. Fitur admin selalu aktif (anti-lockout). Katalog: `lib/permissions.ts` |

---

## Aturan Token

| Aturan | Nilai | Lokasi |
|---|---|---|
| Struk harus diklaim dalam | **7 hari** sejak dibuat; lewat itu `410 RECEIPT_EXPIRED` dan token kembali ke saldo kafe | `RECEIPT_VALID_DAYS` — `lib/receipts.ts` |
| Masa aktif pelanggan per isi ulang | sisa masa aktif **+7 hari** (lewat = 7 hari dari sekarang), **maks 30 hari** ke depan. Token tetap masuk penuh walau masa aktif sudah mentok | `WORKSPACE_TOPUP_DAYS`, `WORKSPACE_MAX_DAYS` — `lib/billing.ts` |
| Lewat masa aktif | AI ditolak `402 WORKSPACE_EXPIRED`; sisa saldo tetap ada & aktif lagi setelah klaim struk baru. Pemakaian **tidak** memperpanjang masa aktif | `lib/billing.ts` |
| Beli Produk (bonus belanja) | token = `floor(total belanja / bonus_rupiah_per_token)` — default Rp100 = 1 token | tarif per kafe, `/admin/cafes/:id` |
| Beli Token Ketengan | harga = `token × retail_rupiah_per_token` — default Rp10/token | tarif per kafe, `/admin/cafes/:id` |
| Biaya pemakaian | diatur per model di *Provider & Model AI* (fallback: chat 1/10, gambar 3/50, video 5/200 Token) | `lib/model-registry.ts`, `lib/billing.ts` |

Token & harga selalu dihitung di server; struk idempoten per `pos_reference_id`. Pengembalian token struk hangus berjalan otomatis saat dashboard/daftar struk/Buat Struk dibuka (tanpa cron), tiap struk sekali.

---

## Setup Lokal

Prasyarat: Node.js 22, npm, Docker Desktop.

```bash
npm install
cp .env.example .env                              # isi API key provider (opsional, bisa juga di /admin/models)
docker compose -f docker-compose.dev.yml up -d    # Postgres :5433, Redis :6380
npm run db:migrate                                # jalankan ulang semua drizzle/*.sql (idempoten)
npm run db:seed                                   # data dev (idempoten)
npm run dev                                       # http://localhost:3000
```

| Perintah | Fungsi |
|---|---|
| `npm run dev` / `build` / `start` | Dev server / build produksi / jalankan build |
| `npm run typecheck` | `tsc --noEmit` (alias: `lint`) |
| `npm run db:migrate` / `db:seed` | Migrasi / seed |
| `npm run gen:key` | Buat `APP_ENCRYPTION_KEY` |

Reset DB: `docker compose -f docker-compose.dev.yml down -v`, lalu ulangi `up -d`, `db:migrate`, `db:seed`.

### Akun dev (dari seed)

| Peran | Login | Catatan |
|---|---|---|
| Super admin | `admin@example.com` / `Admin123!` | `/admin/login` |
| Kasir | `kasir.kopi@example.com` / `Kasir123!` | Kopi Senja, saldo awal 100.000 |
| Kasir | `kasir.lestari@example.com` / `Kasir123!` | Warung Lestari, saldo awal 50.000 |
| Pelanggan | `dev@example.com` | Login otomatis di dev, 1.500 Token |

### Environment

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Wajib. Default dev ada di `.env.example` |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `VIO_API_KEY` | Fallback API key provider bila belum diisi di `/admin/models` |
| `ADMIN_JWT_SECRET`, `ADMIN_PASSWORD_PEPPER` | **Wajib di produksi** — kosong = request auth admin ditolak |
| `APP_ENCRYPTION_KEY` | **Wajib di produksi** — enkripsi API key provider di DB (`npm run gen:key`) |
| `APP_BASE_URL` | URL publik untuk link klaim & QR struk (kosong = ikut origin request) |
| `ADMIN_ALLOWED_ORIGINS` | Origin tambahan untuk API admin dari browser domain lain |
| `ADMIN_ACCESS_TTL`, `ADMIN_REFRESH_TTL` | Umur token admin (detik), default 900 / 604800 |

---

## Integrasi Aplikasi Kasir (POS)

POS kafe bisa membuat struk tanpa membuka `/kasir`. `Origin` tidak wajib untuk panggilan server-ke-server.

```bash
# 1. Login akun kasir → access_token (15 menit) + refresh_token (7 hari, sekali pakai)
curl -X POST $BASE/api/v1/admin/auth/login -H "Content-Type: application/json" \
  -d '{"email":"kasir.kopi@example.com","password":"Kasir123!"}'

# 2. Buat struk — pilih salah satu body. pos_reference_id = no. nota POS (idempoten)
curl -X POST $BASE/api/v1/admin/receipts/generate \
  -H "Authorization: Bearer <access_token>" -H "Content-Type: application/json" \
  -d '{"mode":"product","rupiah_amount":50000,"pos_reference_id":"NOTA-0001"}'
#   {"mode":"retail","tokens":500,"pos_reference_id":"NOTA-0002"}
#   {"token_package_id":"<id-paket>","pos_reference_id":"NOTA-0003"}
# → { code, claim_url, tokens, rupiah_amount, expires_at, ... }  (201 baru, 200 nota sama)

# 3. Cetak code + QR berisi claim_url (atau unduh PNG)
curl -o qr.png $BASE/api/v1/receipts/RST-482913/qr.png

# 4. (opsional) Status struk / daftar struk / perpanjang sesi
curl "$BASE/api/v1/admin/receipts/lookup?code=RST-482913" -H "Authorization: Bearer <access_token>"
curl "$BASE/api/v1/admin/receipts?status=unclaimed" -H "Authorization: Bearer <access_token>"
curl -X POST $BASE/api/v1/admin/auth/refresh -H "Content-Type: application/json" -d '{"refresh_token":"<rt>"}'
```

Error penting: `402 INSUFFICIENT_CAFE_QUOTA` (saldo kafe habis), `400 AMOUNT_TOO_SMALL` / `INVALID_TOKENS`, `401` (refresh lalu ulangi).

## Gateway AI (Developer API pelanggan)

Pelanggan membuat API key di `/dashboard/developer` (disimpan sebagai hash, tampil sekali). Pemakaian memotong saldo & mengikuti masa aktif akun pemilik. Limit 60 request/menit per key.

```bash
curl -X POST $BASE/api/v1/chat/completions -H "Authorization: Bearer rst_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"freetokenai-chat-fast","messages":[{"role":"user","content":"Halo!"}]}'
```

Model: `freetokenai-chat-fast`, `freetokenai-chat-pro`.

---

## Struktur Proyek

```
app/
  (kasir)/kasir/        Panel kasir: dashboard, buat struk, cek status struk
  admin/                Panel admin (login + console)
  claim/                Halaman klaim struk pelanggan
  dashboard/            Chat, gambar, video, developer, pengaturan
  api/                  Endpoint: /api/v1/admin/*, /api/v1/kasir/*, /api/v1/auth/*, AI (/api/chat, /api/images, /api/videos)
components/             UI dashboard pelanggan; components/admin & components/kasir untuk panel
lib/                    billing (saldo & masa aktif), receipts (masa berlaku struk), auth, ai-router, model-registry, i18n
drizzle/                Migrasi SQL berurutan (wajib idempoten)
scripts/                db-migrate, db-seed, gen-encryption-key
```

## Deploy

```bash
npm ci && npm run db:migrate && npm run build && npm run start
```

- Isi env produksi (lihat tabel), jalankan di belakang HTTPS (cookie `Secure`), teruskan `Host`/`X-Forwarded-*` atau set `APP_BASE_URL`.
- **Vercel**: set `APP_ENCRYPTION_KEY` yang **sama** dengan environment tempat key provider disimpan. Kalau berbeda, key di DB tidak bisa didekripsi, jadi simpan ulang key di `/admin/models`. Key yang ditempel otomatis dirapikan (spasi, kutip, `Bearer `). Kalau muncul "diblokir firewall provider", IP Vercel ditolak provider, bukan key yang salah.
- Health check: `GET /healthz` (DB + Redis). `railway.json` sudah menjalankan migrasi sebelum deploy.
