# FreeTokenAI — Web

Aplikasi web SaaS untuk restoran/kafe: pelanggan membeli **struk** di kasir, mengklaim **QR struk** menjadi **Token**, lalu memakai Token untuk chat, generate gambar, dan generate video AI. Kasir menerbitkan struk (memotong kuota prepaid kafe), super admin memantau kafe dan pemakaian API. Tersedia juga **API gateway** yang kompatibel dengan format OpenAI chat completions untuk integrasi POS.

Stack: Next.js 16 (App Router) + React 18 + TypeScript + Tailwind, Postgres 16 + Redis 7 (Docker), `postgres.js`, `drizzle-orm` (migrasi SQL manual), `ioredis`, `qrcode`.

---

## Daftar Isi

- [Fitur](#fitur)
- [Struktur Proyek](#struktur-proyek)
- [Setup Lokal](#setup-lokal)
- [Deploy Produksi](#deploy-produksi)
- [Environment Variables](#environment-variables)
- [Akun & Data Seed](#akun--data-seed)
- [Cara Penggunaan](#cara-penggunaan)
- [Alur Sistem](#alur-sistem)
- [Referensi API](#referensi-api)
- [Model Token & Billing](#model-token--billing)
- [Alur Kerja Tiket & Status Task](#alur-kerja-tiket--status-task)
- [Yang Belum Selesai / Catatan](#yang-belum-selesai--catatan)
- [Troubleshooting](#troubleshooting)

---

## Fitur

| Area | Fitur |
|------|-------|
| Dashboard pelanggan | Chat AI, Image Studio, Video Studio, Developer API, Settings |
| Token & billing | Saldo per workspace, ledger dua arah (`token_transactions`), refund otomatis saat provider gagal, `402 INSUFFICIENT_TOKENS` |
| Klaim struk | QR publik per struk, klaim satu kali, grant Token + perpanjang 7 hari, sesi cookie otomatis |
| Kasir | Web Kasir universal di `/kasir`: login, pilih paket, generate struk idempoten, QR, cetak 80mm, QR statis kafe |
| Super admin | `/admin`: daftar kafe, detail kafe, workspace, agregat pemakaian 30 hari |
| Multi-tenant | Tabel `cafes`, `token_packages`, kuota prepaid kafe, atribusi pemakaian ke kafe |
| API gateway | `POST /api/v1/chat/completions` dengan API key `rst_live_*`, rate limit 60/menit |
| Streaming | `POST /api/chat/stream` (SSE) dengan metered billing |
| Observability | `GET /healthz` (DB + Redis), request-id + structured log untuk semua `/api/*` |

---

## Struktur Proyek

```
web/
├─ app/
│  ├─ page.tsx                    redirect ke /dashboard
│  ├─ layout.tsx, globals.css     root layout + Tailwind
│  ├─ healthz/route.ts            GET /healthz — status DB + Redis
│  ├─ dashboard/                  UI pelanggan
│  │  ├─ page.tsx                 chat (ChatPanel)
│  │  ├─ chat/[id]/page.tsx       lanjutkan sesi chat
│  │  ├─ image/page.tsx           Media Studio — image
│  │  ├─ video/page.tsx           Media Studio — video
│  │  ├─ developer/page.tsx       kelola API key
│  │  └─ settings/page.tsx        profil, device, workspace, preferensi
│  ├─ admin/
│  │  ├─ login/page.tsx           login super admin (cookie)
│  │  └─ (console)/               konsol super admin (dijaga cookie session)
│  │     ├─ page.tsx              daftar kafe
│  │     └─ cafes/[id]/page.tsx   detail kafe + chart usage
│  ├─ (kasir)/kasir/page.tsx      Web Kasir universal (bearer token)
│  └─ api/                        seluruh endpoint HTTP (lihat Referensi API)
├─ components/                    ChatInput, ChatPanel, DashboardShell, DeveloperApi,
│                                 MediaStudio, SettingsPanel, Sidebar, TopBar, dll.
├─ lib/
│  ├─ auth.ts                     cookie session, Bearer JWT admin, scrypt password
│  ├─ billing.ts                  withTokens / withTokensStream, cost model, refund
│  ├─ rate-limit.ts               fixed-window Redis (fallback in-memory)
│  ├─ db.ts, redis.ts             singleton Postgres + Redis
│  ├─ api-keys.ts                 hash SHA-256 + prefix API key
│  ├─ chat-history.ts             persist chat_sessions / chat_messages
│  ├─ chat-jobs.ts, media-jobs.ts, media-history.ts
│  ├─ chat-models.ts              katalog model chat
│  ├─ current-user.ts, settings.ts, mock-data.ts
│  ├─ obs.ts                      structured log + request id
│  └─ vio.ts                      client VIO (image/video)
├─ drizzle/
│  ├─ 0001_init.sql               10 tabel inti (users … ratings)
│  ├─ 0002_tenant.sql             cafes, token_packages, role, cafe_id
│  └─ 0003_admin_auth.sql         admin_password_hash, admin_sessions
├─ scripts/
│  ├─ db-migrate.mjs              jalankan semua drizzle/*.sql berurutan
│  └─ db-seed.mjs                 seed kafe, admin, kasir, paket, workspace dev
├─ middleware.ts                  x-request-id + log untuk /api/:path*
├─ docker-compose.dev.yml         Postgres 16 (host 5433) + Redis 7 (host 6380)
├─ drizzle.config.ts
└─ package.json
```

---

## Setup Lokal

**Prasyarat:** Node.js 20+, npm, Docker Desktop.

```bash
# 1. Install dependency
npm install

# 2. Siapkan env
cp .env.example .env.local
# lalu isi GEMINI_API_KEY / GROQ_API_KEY / VIO_API_KEY

# 3. Nyalakan Postgres + Redis
docker compose -f docker-compose.dev.yml up -d

# 4. Migrasi + seed
npm run db:migrate
npm run db:seed

# 5. Jalankan dev server
npm run dev
```

Buka http://localhost:3000 → redirect ke `/dashboard`.

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Dev server Next.js |
| `npm run build` | Build produksi |
| `npm run start` | Jalankan hasil build |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm run typecheck` | Sama dengan `lint` |
| `npm run db:migrate` | Jalankan `drizzle/*.sql` berurutan (idempoten, tanpa journal) |
| `npm run db:seed` | Seed data dev (idempoten) |

Port host: Postgres `5433` → container `5432`, Redis `6380` → container `6379`.

### Reset database

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
npm run db:migrate
npm run db:seed
```

`db-migrate` sengaja menolak jalan bila menemukan kolom legacy `users.password_hash`; pesannya menyuruh `down -v`.

---

## Environment Variables

`.env.example`:

| Variable | Wajib | Keterangan |
|----------|-------|------------|
| `DATABASE_URL` | ya | `postgres://postgres:postgres@localhost:5433/freetokenai_dev` |
| `REDIS_URL` | ya | `redis://localhost:6380` |
| `VIO_API_KEY` | untuk image/video | API key VIO |
| `GEMINI_API_KEY` | untuk chat/image | API key Google Gemini |
| `GEMINI_MODEL` | tidak | Default `gemini-3.5-flash` |
| `GROQ_API_KEY` | untuk chat fallback | API key Groq |
| `ADMIN_JWT_SECRET` | production | Signing key JWT admin. Kosong = dev fallback; production menolak request auth |
| `ADMIN_PASSWORD_PEPPER` | production | Pepper hash password admin (scrypt) |
| `APP_ENCRYPTION_KEY` | production | Kunci AES-256-GCM API key provider; buat dengan `npm run gen:key` |
| `APP_BASE_URL` | production | Base URL publik untuk link klaim & QR struk. Kosong = ikut origin request |
| `ADMIN_ACCESS_TTL` | tidak | Umur access token admin (detik), default `900` |
| `ADMIN_REFRESH_TTL` | tidak | Umur refresh token admin (detik), default `604800` |
| `ADMIN_ALLOWED_ORIGINS` | tidak | Origin CORS admin tambahan, dipisah koma |
| `CLAIM_BASE_URL` | tidak | Nama lama `APP_BASE_URL` (masih dibaca, fallback kedua) |

---

## Deploy Produksi

Checklist minimal sebelum go-live:

1. **Env**: isi semua variabel bertanda `production` di tabel [Environment Variables](#environment-variables). Bila `ADMIN_JWT_SECRET` / `ADMIN_PASSWORD_PEPPER` kosong, request auth admin gagal (fail-fast) alih-alih diam-diam memakai secret dev.
2. **Build & jalankan**:

   ```bash
   npm ci
   npm run db:migrate
   npm run build
   npm run start        # default port 3000; set PORT bila berbeda
   ```

3. **HTTPS + reverse proxy**: cookie sesi otomatis `Secure` saat `NODE_ENV=production`, jadi aplikasi wajib di belakang TLS. Teruskan header `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, atau set `APP_BASE_URL` eksplisit supaya `claim_url` dan QR mengarah ke domain publik.
4. **Migrasi**: `scripts/db-migrate.mjs` menjalankan ulang seluruh `drizzle/*.sql` setiap kali, jadi setiap file migrasi wajib idempoten (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`).
5. **Health check**: probe `GET /healthz` (DB + Redis).
6. **Security headers**: middleware memasang `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, dan `Permissions-Policy` untuk semua route.
7. **Artefak lokal** (`.next/`, `*.log`, `.sokudo/`) tidak di-track git.

---

## Akun & Data Seed

| Peran | Email | Password | Catatan |
|-------|-------|----------|---------|
| Super admin | `admin@example.com` | `Admin123!` | Akses `/admin` |
| Kasir | `kasir.kopi@example.com` | `Kasir123!` | Kafe Kopi Senja |
| Kasir | `kasir.lestari@example.com` | `Kasir123!` | Kafe Warung Lestari |
| Customer (dev) | `dev@example.com` | — | Login otomatis di dev; workspace 1.500 Token |

Data lain:

- Kafe `kopi-senja` — Kopi Senja, kuota prepaid **100.000 Token**.
- Kafe `warung-lestari` — Warung Lestari, kuota prepaid **50.000 Token**.
- Paket: **Rp10.000 → 1.500 Token**, **Rp25.000 → 4.000 Token**.
- Workspace dev: **1.500 Token**, aktif 7 hari, plus beberapa contoh usage log.

Seed bersifat idempoten: re-run tidak mereset saldo dan tidak menimpa password admin yang sudah diganti.

---

## Cara Penggunaan

### 1. Dashboard pelanggan

| Halaman | Fungsi |
|---------|--------|
| `/dashboard` | Chat AI (Groq/Gemini), riwayat sesi di sidebar |
| `/dashboard/chat/:id` | Lanjutkan sesi chat |
| `/dashboard/image` | Generate gambar (nano-banana-2 / pro, qwen-image) |
| `/dashboard/video` | Generate video (veo-3.1-lite/fast/quality) |
| `/dashboard/developer` | Buat/revoke API key workspace |
| `/dashboard/settings` | Nama & kontak, device (maks 2), saldo Token, preferensi |

Setiap request AI memotong Token dari workspace yang sedang login. Di development tanpa cookie, request jatuh ke workspace seed (`dev@example.com`); di produksi request anonim ditolak `401`.

### 2. Kasir — `/kasir`

1. Buka `/kasir`, login dengan akun kasir (lihat tabel akun).
2. Token disimpan di `localStorage` (kunci sama dengan `/admin`).
3. **Buat Struk**, pilih salah satu:
   - **Beli Produk**: isi total belanja → token bonus = `floor(total / bonus_rupiah_per_token)`.
   - **Beli Token Ketengan**: isi jumlah token (harga = `token × retail_rupiah_per_token`) atau pilih paket hemat.
4. Sistem memanggil `POST /api/v1/admin/receipts/generate`; respons berisi `code`, `claim_url`, `tokens`, `rupiah_amount`.
5. Struk siap cetak tampil (kop kafe, rincian, QR, kode); tombol **Cetak Struk** memakai CSS print thermal **58mm**.
6. **Cek Status Struk**: daftar struk + filter klaim, detail pengklaim & sisa saldo, cetak ulang struk yang belum diklaim.
7. Top-up pelanggan = buat struk baru; diklaim dengan No. WA/email yang sama → masuk saldo yang sama.
8. QR statis kafe: `GET /api/v1/admin/cafes/:id/static-qr.png` (Bearer kasir kafe tersebut).

Tarif `retail_rupiah_per_token` (default Rp10) dan `bonus_rupiah_per_token` (default Rp100) diatur super admin per kafe di `/admin/cafes/:id`.

Struk idempoten: `pos_reference_id` yang sama tidak membuat struk baru dan tidak memotong kuota lagi.

### 3. Super admin — `/admin`

1. Buka `/admin/login`, login dengan `admin@example.com` / `Admin123!`.
2. Route memanggil `/api/v1/admin/auth/cookie-login` dan men-set cookie `ftai_session`.
3. `/admin` menampilkan daftar kafe: kuota prepaid, saldo, workspace aktif, total Token diberikan.
4. Klik kafe → detail workspace + agregat pemakaian (per endpoint dan harian 30 hari).

Halaman `/admin/*` dijaga di server: tanpa cookie → redirect `/admin/login`; role bukan `super_admin` → redirect `/dashboard`.

### 4. API gateway (integrasi POS)

1. Buat API key di `/dashboard/developer` (raw key hanya ditampilkan sekali).
2. Panggil gateway:

```bash
curl -X POST http://localhost:3000/api/v1/chat/completions \
  -H "Authorization: Bearer rst_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"freetokenai-chat-fast","messages":[{"role":"user","content":"Menu kopi?"}]}'
```

Model: `freetokenai-chat-fast`, `freetokenai-chat-pro`. Rate limit **60 request/menit per API key**.

### 5. Klaim struk (pelanggan)

```bash
# 1. Ambil PNG QR struk (publik, tanpa auth)
curl -o struk.png http://localhost:3000/api/v1/receipts/RST-XXXX/qr.png

# 2. Klaim (identifier: No. WhatsApp atau email)
curl -X POST http://localhost:3000/api/v1/auth/claim \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"code":"RST-XXXX","identifier":"081200000001"}'
```

Respons sukses men-set cookie `ftai_session` sehingga pelanggan langsung masuk dashboard. Struk yang sudah diklaim -> `409`; kode tidak ada -> `404`.

Halaman klaim untuk pelanggan: **`/claim?code=RST-XXXX`**. Form meminta No. WhatsApp/email, memanggil endpoint di atas, lalu menampilkan saldo token yang masuk. `claim_url` dari `POST /admin/receipts/generate` dan isi QR struk memakai `APP_BASE_URL` (atau origin request bila kosong) - tidak ada domain hardcode.

### 6. Integrasi aplikasi kasir kafe (POS) → buat struk FreeTokenAI

Aplikasi kasir milik kafe (POS, mesin kasir, aplikasi tablet) bisa membuat struk token langsung lewat API — tanpa membuka `/kasir`. Ganti `https://freetokenai.example.com` dengan domain FreeTokenAI Anda (lokal: `http://localhost:3000`).

**Ringkasan alur**

```
POS login (akun kasir) ─► access_token
   │
   ├─ pelanggan bayar ─► POST /api/v1/admin/receipts/generate  { pos_reference_id = no. nota POS }
   │                         └─ respons: code, claim_url, tokens, rupiah_amount
   ├─ cetak struk: tampilkan code + QR (isi QR = claim_url)
   └─ (opsional) cek status: GET /api/v1/admin/receipts/lookup?code=...
```

**1. Login akun kasir** — sekali di awal shift, simpan kedua token di POS.

```bash
curl -X POST https://freetokenai.example.com/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"kasir.kopi@example.com","password":"Kasir123!"}'
```

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "3f9c1e...",
  "user": { "id": "…", "role": "kasir", "cafe_id": "…" }
}
```

`access_token` berlaku 15 menit, `refresh_token` 7 hari dan **sekali pakai**. Struk selalu masuk ke kafe milik akun kasir tersebut (`cafe_id` tidak perlu dikirim).

**2. (Opsional) Ambil tarif & paket** — untuk menampilkan harga di layar POS.

```bash
# Tarif kafe: retail_rupiah_per_token & bonus_rupiah_per_token
curl https://freetokenai.example.com/api/v1/kasir/pricing \
  -H "Authorization: Bearer <access_token>"

# Daftar paket token aktif (id dipakai di token_package_id)
curl https://freetokenai.example.com/api/v1/admin/token-packages \
  -H "Authorization: Bearer <access_token>"
```

**3. Buat struk** — pilih salah satu bentuk body. `pos_reference_id` = nomor nota POS (3–100 karakter, unik).

```bash
# a) Beli Produk: pelanggan belanja Rp50.000, dapat token bonus sesuai tarif kafe
curl -X POST https://freetokenai.example.com/api/v1/admin/receipts/generate \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"product","rupiah_amount":50000,"pos_reference_id":"NOTA-20261025-0001"}'

# b) Beli Token Ketengan: 500 token, harga dihitung server (500 x tarif ketengan)
curl -X POST https://freetokenai.example.com/api/v1/admin/receipts/generate \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"retail","tokens":500,"pos_reference_id":"NOTA-20261025-0002"}'

# c) Paket token
curl -X POST https://freetokenai.example.com/api/v1/admin/receipts/generate \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"token_package_id":"<id-paket>","pos_reference_id":"NOTA-20261025-0003"}'
```

Respons (`201` struk baru, `200` bila `pos_reference_id` sudah pernah dipakai — struk lama dikembalikan, saldo tidak dipotong lagi):

```json
{
  "code": "RST-482913",
  "claim_url": "https://freetokenai.example.com/claim?code=RST-482913",
  "tokens": 500,
  "purchase_type": "product",
  "rupiah_amount": 50000,
  "created_at": "2026-10-25T08:12:44.120Z",
  "pos_reference_id": "NOTA-20261025-0001",
  "cafe_name": "Kopi Senja"
}
```

Jumlah token dan harga **selalu dihitung server** dari tarif kafe; POS cukup kirim nominal belanja / jumlah token. Karena idempoten, aman mengirim ulang request yang timeout dengan `pos_reference_id` yang sama.

**4. Cetak di struk POS** — cetak `code` dan QR berisi `claim_url`. Printer POS bisa membuat QR sendiri dari `claim_url`, atau unduh PNG siap pakai:

```bash
curl -o qr.png https://freetokenai.example.com/api/v1/receipts/RST-482913/qr.png
```

Pelanggan scan QR → `/claim` (kode terisi otomatis) → masukkan No. WA/email → token masuk.

**5. (Opsional) Cek status struk**

```bash
# Satu struk: status klaim, pengklaim (disamarkan), sisa saldo pelanggan
curl "https://freetokenai.example.com/api/v1/admin/receipts/lookup?code=RST-482913" \
  -H "Authorization: Bearer <access_token>"

# Daftar struk kafe (status=claimed|unclaimed, q=potongan kode, limit maks 100)
curl "https://freetokenai.example.com/api/v1/admin/receipts?status=unclaimed&limit=20" \
  -H "Authorization: Bearer <access_token>"
```

**6. Perpanjang sesi** — saat API membalas `401`, tukar `refresh_token` lalu ulangi request. Simpan `refresh_token` baru (yang lama hangus).

```bash
curl -X POST https://freetokenai.example.com/api/v1/admin/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<refresh_token>"}'
```

**Kode error yang perlu ditangani POS**

| HTTP | `error.code` | Arti / tindakan |
|------|--------------|-----------------|
| 400 | `INVALID_POS_REFERENCE` | `pos_reference_id` kosong / bukan 3–100 karakter |
| 400 | `INVALID_AMOUNT`, `AMOUNT_TOO_SMALL` | Nominal belanja tidak valid / terlalu kecil untuk 1 token |
| 400 | `INVALID_TOKENS`, `PACKAGE_NOT_FOUND` | Jumlah token tidak valid / paket tidak aktif |
| 401 | (apa pun) | Token kedaluwarsa → refresh (langkah 6), lalu ulangi |
| 402 | `INSUFFICIENT_CAFE_QUOTA` | Saldo prepaid kafe habis → minta top-up ke super admin |
| 403 | `FORBIDDEN_CAFE`, `FORBIDDEN_ORIGIN` | Akun bukan kasir kafe ini / header `Origin` tidak diizinkan |

Header `Origin` tidak wajib untuk panggilan server-ke-server (curl, backend POS). Bila POS memanggil dari **browser** di domain lain, daftarkan domain itu di env `ADMIN_ALLOWED_ORIGINS`.

### 7. Health check

```bash
curl http://localhost:3000/healthz
```

Mengembalikan status DB + Redis (`ok` / `degraded`). Catatan: path-nya `/healthz`, bukan `/api/healthz`.

---

## Alur Sistem

### Alur klaim struk

```
Kasir /kasir
  └─ POST /api/v1/admin/receipts/generate
       ├─ validasi role kasir + cafe_id
       ├─ pos_reference_id sudah ada? -> 200, struk lama (tidak potong kuota)
       ├─ UPDATE cafes SET prepaid_token_balance = ... WHERE saldo >= n
       └─ INSERT receipts (code, tokens_granted) -> 201 + claim_url

Pelanggan scan QR
  └─ GET /api/v1/receipts/:code/qr.png (publik, cache 1 jam)
       └─ POST /api/v1/auth/claim { code, identifier }
            ├─ lock receipt FOR UPDATE (tolak 409 bila sudah diklaim)
            ├─ find-or-create user + workspace
            ├─ grant Token + expires_at = now() + 7 hari
            ├─ tulis token_transactions (grant)
            ├─ tandai receipt claimed
            └─ buat sesi cookie (di luar transaksi)
```

### Alur billing satu request AI

```
requireAuth / API key
  └─ withTokens(workspace, cost, fn)
       ├─ cek + potong saldo secara atomik (row lock)
       ├─ workspace expired -> expires_at = now() + 7 hari
       ├─ panggil provider
       ├─ sukses -> catat usage_logs + token_transactions (burn)
       ├─ provider gagal / respons non-OK (kecuali 402) -> refund + ledger refund
       └─ saldo kurang -> 402 INSUFFICIENT_TOKENS (tanpa potong)
```

### Alur streaming

```
POST /api/chat/stream
  └─ withTokensStream(workspace, costPer1k, streamFn)
       ├─ butuh saldo minimal 5 Token
       ├─ stream delta provider -> SSE `data: {"text":"..."}`
       ├─ stop bila budget Token habis (`TOKEN_EXHAUSTED`)
       ├─ selesai -> potong ceil(totalTokens/1000 * costPer1k) + burn
       └─ frame terakhir `data: {"done":true,"totalTokens":...}`
```

---

## Referensi API

Auth: **cookie** = `ftai_session`; **bearer** = `Authorization: Bearer <admin JWT>`; **api-key** = `Authorization: Bearer rst_live_...`.

### AI (dashboard)

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| POST | `/api/chat` | cookie | Chat non-streaming + persist riwayat; respons `session_id` |
| POST | `/api/chat/stream` | cookie | Chat streaming SSE + metered billing |
| POST | `/api/images/generate` | cookie | Proxy generate gambar (VIO) |
| POST | `/api/videos/generate` | cookie | Proxy generate video (VIO) |
| GET | `/api/generations/:id` | — | Cek status job VIO |

### Admin auth

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| POST | `/api/v1/admin/auth/login` | — | Login admin/kasir → access + refresh token |
| POST | `/api/v1/admin/auth/cookie-login` | — | Login super admin web → cookie `ftai_session` |
| POST | `/api/v1/admin/auth/refresh` | — | Rotasi refresh token |

### Admin / tenant

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| GET | `/api/v1/admin/cafes` | bearer/cookie `super_admin` | Daftar kafe + kuota + usage ringkas |
| GET | `/api/v1/admin/cafes/:id` | bearer/cookie `super_admin` | Detail kafe + workspace + agregat |
| GET | `/api/v1/admin/cafes/:id/usage` | bearer/cookie `super_admin` | Usage per endpoint + harian 30 hari |
| GET | `/api/v1/admin/cafes/:id/static-qr.png` | bearer/cookie `kasir` (kafe sendiri) / `super_admin` | QR statis kafe |
| POST | `/api/v1/admin/receipts/generate` | bearer/cookie `kasir` / `super_admin` | Generate struk idempoten |
| GET | `/api/v1/admin/token-packages` | bearer/cookie `kasir` / `super_admin` | Daftar paket Token |

### Workspace & pelanggan

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| GET | `/api/v1/auth/me` | cookie | User aktif (dev: auto-login seed) |
| DELETE | `/api/v1/auth/me` | cookie | Logout, hapus cookie |
| POST | `/api/v1/auth/claim` | — | Klaim struk → Token + sesi |
| GET | `/api/v1/workspace` | cookie | Saldo Token + masa aktif |
| GET/PATCH | `/api/v1/users/profile` | cookie | Baca/ubah nama & kontak |
| DELETE | `/api/v1/users/me` | cookie | Hapus akun + data terkait |
| GET/POST/DELETE | `/api/v1/sessions` | cookie | Kelola device (maks 2) |

### API key & chat gateway

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| GET/POST | `/api/v1/api-keys` | cookie | List / buat API key |
| POST | `/api/v1/api-keys/:id/revoke` | cookie | Revoke API key |
| POST | `/api/v1/chat/completions` | api-key | Gateway chat kompatibel OpenAI |
| GET/POST | `/api/v1/chat/sessions` | cookie | List / buat sesi chat |
| DELETE | `/api/v1/chat/sessions/:id` | cookie | Hapus sesi chat |
| GET | `/api/v1/chat/sessions/:id/messages` | cookie | Riwayat pesan |

### Lain-lain

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| GET | `/api/v1/receipts/:code/qr.png` | — | QR klaim publik (rate limit 30/menit/IP) |
| POST | `/api/v1/usage-logs/:id/rating` | cookie | Rating 1–5 + feedback (upsert) |
| GET | `/healthz` | — | Status DB + Redis |

### Rate limit

| Endpoint | Batas |
|----------|-------|
| `/api/v1/chat/completions` | 60/menit per API key |
| `/api/v1/auth/claim` | 10/menit per IP + 5/jam per identifier |
| `/api/v1/receipts/:code/qr.png` | 30/menit per IP |
| `/api/v1/admin/auth/cookie-login` | 10/menit per IP |

Respons `429` menyertakan header `Retry-After`. Bila Redis mati, rate limit **fail-open** (request tetap dilayani) dan warning dicatat.

---

## Model Token & Billing

Token adalah unit aplikasi (bukan token LLM).

| Aksi | Biaya |
|------|-------|
| Chat (`freetokenai-chat-fast`) | 1 Token per pesan |
| Chat model pro / `120b` | 10 Token per pesan |
| Streaming chat | 1 Token per 1.000 token LLM (10 untuk model pro) |
| Image default | 3 Token |
| Image `nano-banana-pro` | 50 Token |
| Video default | 5 Token |
| Video `veo-3.1-quality` | 200 Token |

Aturan:

- Potong saldo dilakukan atomik; saldo kurang → `402 { code: INSUFFICIENT_TOKENS }` tanpa potong.
- Workspace yang kedaluwarsa diperpanjang **7 hari** saat dipakai.
- Setiap potong/tambah Token dicatat di `token_transactions` (`grant` / `burn` / `refund`) sehingga `token_balance` dapat direkonsiliasi dari ledger.
- Provider gagal pada non-streaming → refund otomatis + baris `refund`.
- Struk memotong **kuota prepaid kafe** (`cafes.prepaid_token_balance`), bukan kuota pelanggan.

---

## Alur Kerja Tiket & Status Task

Pekerjaan proyek ini dilacak sebagai tiket kanban. Alurnya:

```
Backlog -> In Progress -> Under Review -> Done
                             |
                             +-> REQUEST CHANGES -> In Progress (revisi)
                             |
                             +-> APPROVE -> QA -> Done
```

- Setiap tiket memuat **Goal**, **Context**, **Steps**, dan **Acceptance Criteria**.
- Peran: **Planner** (rencana), **Fullstack** (implementasi), **Code Reviewer** (verdict), **QA** (verifikasi end-to-end).
- Dependensi dicatat terstruktur (`blocked_by`), bukan sekadar prosa. Contoh: QA baru jalan setelah review APPROVE.
- Perubahan worker masuk `master` hanya lewat **Approve** pada kartu tiket; tiket tanpa diff tidak bisa di-approve (discard).
- Verifikasi wajib menyertakan bukti: `tsc` bersih, `curl`/HTTP code, atau query DB.

### Status per Oktober 2026: 51/51 tiket di kolom Done

**Fase 0 — Fondasi (TASK-001…020)**

| ID | Judul | Status |
|----|-------|--------|
| TASK-001 | Infra Postgres+Redis + skema 10 tabel | Done |
| TASK-002 | Auth cookie + workspace/device API | Done |
| TASK-003 | Billing Token + wiring gateway | Done |
| TASK-004 | Plan fix skema DB ke PRD §5.3 | Done |
| TASK-005 | Review backend auth/billing | Done |
| TASK-006 | QA backend auth/billing | Done |
| TASK-007 | Plan fix TASK-002/003 | Done |
| TASK-008 | Fix auto-revoke device + gate dev login | Done |
| TASK-009 | Fix extend/refund/rate-limit | Done |
| TASK-010 | Review fix auto-revoke | Done |
| TASK-011 | Review fix extend/refund/rate-limit | Done |
| TASK-012 | Plan ledger billing dua arah | Done |
| TASK-013 | Temuan: anon AI endpoint gratis | Done |
| TASK-014 | Fix race `createSession` | Done |
| TASK-015 | Fix anon AI: `requireAuth` | Done |
| TASK-016 | Ledger billing dua arah satu transaksi | Done |
| TASK-017 | Review fix race | Done |
| TASK-018 | Review fix anon AI | Done |
| TASK-019 | Fix PATCH profile email | Done |
| TASK-020 | QA round-trip profile | Done |

**Fase 1 — Tenant, kasir, QR, riwayat (TASK-021…035)**

| ID | Judul | Status |
|----|-------|--------|
| TASK-021 | Plan tenant + kasir + super admin | Done |
| TASK-022 | Skema multi-tenant (0002) | Done |
| TASK-023 | Endpoint receipt idempoten + kuota kafe | Done |
| TASK-024 | Repo admin kasir standalone | Done (digantikan TASK-033) |
| TASK-025 | Halaman super admin + usage | Done |
| TASK-026 | API key CRUD + claim grant Token | Done |
| TASK-027 | Chat history persist DB | Done |
| TASK-028 | Streaming chat + metered billing | Done |
| TASK-029 | Rating + healthz/log + retry + erasure + dark mode | Done |
| TASK-030 | Halaman `/kasir` (web) | Done (digantikan TASK-033) |
| TASK-031 | QR struk publik | Done |
| TASK-032 | QR statis admin | Done (digantikan TASK-035) |
| TASK-033 | Halaman `/kasir` universal | Done |
| TASK-034 | QA QR struk publik | Done |
| TASK-035 | QR statis admin kafe | Done |

**Fase 2 — Hardening & QA (TASK-036…051)**

| ID | Judul | Status |
|----|-------|--------|
| TASK-036 | Fix race `createSession` | Done |
| TASK-037 | Fix 7 endpoint AI `requireAuth` | Done |
| TASK-038 | Fix race `createSession` | Done |
| TASK-039 | Auth endpoint AI anonim | Done |
| TASK-040 | Streaming chat + `withTokensStream` | Done |
| TASK-041 | QR statis admin | Done |
| TASK-042 | Rate limit endpoint claim | Done |
| TASK-043 | Admin auth JWT + `admin_sessions` | Done |
| TASK-044 | Kasir thin client | Done (superseded: `/kasir` in-web) |
| TASK-045 | Duplikat TASK-040 | Done |
| TASK-046 | Duplikat TASK-041 | Done |
| TASK-047 | Duplikat TASK-042 | Done |
| TASK-048 | Review cluster admin/tenant/auth | Done |
| TASK-049 | Review cluster billing/chat/user | Done |
| TASK-050 | QA admin/tenant/auth end-to-end | Done |
| TASK-051 | QA billing/streaming/rate-limit/claim | Done |

---

## Yang Belum Selesai / Catatan

Tidak ada tiket terbuka di board. Yang tersisa adalah pekerjaan non-tiket berikut:

1. **Perbaikan QA sudah masuk `main`.** Delta streaming (`app/api/chat/stream/route.ts`), `requireAdmin` untuk Bearer super admin (`app/api/v1/admin/cafes/*`), dan fallback cookie `ftai_session` di `requireAdmin` sudah ter-commit. `npm run lint` (`tsc --noEmit`) bersih.

2. **Deviasi yang disengaja (bukan bug):**
   - Guard anonim pada endpoint AI hanya aktif saat `NODE_ENV=production`. Di development request anonim memakai workspace seed agar demo jalan.
   - Streaming memotong Token **setelah** stream selesai, bukan per chunk. Biaya chat bersifat flat sehingga tidak bisa dipecah per chunk; tidak ada refund karena potong baru terjadi di akhir.
   - Nama field akhir stream `sessionId`, sedangkan chat JSON memakai `session_id`. Belum diseragamkan.
   - Repo kasir terpisah tidak dibuat. Sejak PRD v1.6 kasir berupa route in-web `/kasir` (TASK-033).

3. **Belum ada test otomatis.** Tidak ada script `npm test`. Verifikasi yang dipakai: `npm run lint` (`tsc --noEmit`), `curl`/HTTP code, dan query DB langsung.

4. **Konfigurasi produksi** ada di [Deploy Produksi](#deploy-produksi). `ADMIN_JWT_SECRET`, `ADMIN_PASSWORD_PEPPER`, dan `APP_ENCRYPTION_KEY` wajib diset; tanpa itu auth admin dan enkripsi API key provider gagal alih-alih memakai nilai dev.

5. **Artefak lokal sudah tidak di-track:** `.sokudo/`, `dev.log`, `dev.err.log`, `check_ts.txt` masuk `.gitignore`.

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|--------|-------------------|
| `tsc` error "Cannot find module" | `node_modules` tidak lengkap → `npm install` |
| `db-migrate` berhenti karena kolom legacy `password_hash` | `docker compose -f docker-compose.dev.yml down -v`, lalu migrate + seed |
| DB/Redis timeout walau port 5433/6380 terbuka | Docker Desktop wedged → restart Docker Desktop, `wsl --shutdown`, lalu tunggu engine hidup |
| `401` di produksi padahal sudah login | Cookie tidak terkirim (cross-origin) → gunakan Bearer untuk API admin, cookie hanya untuk web same-origin |
| `403 forbidden-origin` di endpoint admin | Kirim header `Origin` yang ada di `ADMIN_ALLOWED_ORIGINS` |
| `402 INSUFFICIENT_TOKENS` | Saldo workspace habis → klaim struk atau top-up kuota kafe |
| Streaming hanya mengirim satu frame `done` | Perbaikan delta belum ter-commit / server lama masih jalan → restart `npm run dev` |
| Rate limit tidak konsisten setelah restart | Redis mati → rate limit fallback in-memory (fail-open) |

---

## Lisensi

Proyek internal (private). Tidak dipublikasikan sebagai paket.
