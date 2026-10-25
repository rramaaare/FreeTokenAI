"use client";

// ponytail: kamus ringan tanpa dependency. Kunci yang sama untuk id/en; kalau
// terjemahan belum ada, fallback ke teks Indonesia supaya UI tidak kosong.
import { useCallback, useEffect, useState } from "react";
import { getAppSettings, SETTINGS_CHANGED } from "./settings";

export type Lang = "id" | "en";

export type TVars = Record<string, string | number>;

const id = {
  // common
  "common.close": "Tutup",
  "common.delete": "Hapus",
  "common.download": "Unduh",
  "common.loading": "Memuat…",
  "common.settings": "Pengaturan",

  // sidebar
  "sidebar.newChat": "Obrolan Baru",
  "sidebar.image": "Bikin Gambar",
  "sidebar.video": "Bikin Video",
  "sidebar.developer": "Developer API",
  "sidebar.recent": "Terbaru",
  "sidebar.empty": "Belum ada obrolan.",
  "sidebar.deleteChat": "Hapus obrolan",
  "sidebar.deleteChatAria": "Hapus {title}",
  "sidebar.logout": "Keluar / Ganti Key",
  "sidebar.settings": "Pengaturan",
  "sidebar.collapse": "Kecilkan sidebar",
  "sidebar.expand": "Perbesar sidebar",
  "sidebar.closeMenu": "Tutup menu",

  // topbar
  "topbar.tokens": "Token Anda",
  "topbar.menu": "Buka menu",
  "theme.toggle": "Ganti mode gelap/terang",

  // auth modal
  "auth.welcome": "Selamat Datang di FreeTokenAI",
  "auth.desc":
    "Untuk memakai AI, beli struk token di kasir cafe lalu klaim kodenya.",
  "auth.needKey":
    "Sudah punya struk? Masukkan kode struk dan No. WA/email Anda di halaman klaim.",

  // token habis
  "tokens.title": "Saldo Token Habis",
  "tokens.desc": "Pilih salah satu cara di bawah untuk lanjut memakai AI.",
  "tokens.balance": "Sisa Token",
  "tokens.claimTitle": "Punya kode struk?",
  "tokens.claimDesc": "Masukkan kode struk dari kasir cafe.",
  "tokens.claimBtn": "Klaim Token",
  "tokens.claiming": "Mengklaim...",
  "tokens.claimSuccess": "Token berhasil ditambahkan ke akun ini. Kamu bisa lanjut memakai AI.",
  "tokens.claimFailed": "Gagal klaim token.",
  "tokens.adminTitle": "Minta admin tambah saldo",
  "tokens.adminDesc":
    "Minta admin menambah saldo untuk akun ini. Saldo diperbarui otomatis tanpa perlu logout.",
  "tokens.check": "Cek Saldo",
  "tokens.checking": "Memeriksa...",
  "tokens.adminSuccess": "Saldo sudah bertambah. Kamu bisa lanjut memakai AI.",
  "tokens.continue": "Lanjut Pakai AI",

  // settings
  "settings.title": "Pengaturan",
  "settings.subtitle": "Profil, perangkat, workspace, dan preferensimu.",
  "settings.profile.title": "Profil",
  "settings.profile.desc":
    "Nama dan kontak yang tampil di kartu profil sidebar.",
  "settings.profile.name": "Nama",
  "settings.profile.contact": "No. WA / email",
  "settings.profile.save": "Simpan Profil",
  "settings.profile.noName": "Tanpa Nama",
  "settings.profile.saved": "Profil disimpan.",
  "settings.devices.title": "Perangkat",
  "settings.devices.desc":
    "Maksimal {n} perangkat aktif. Kalau masuk dari perangkat baru, perangkat yang paling lama otomatis keluar.",
  "settings.devices.empty": "Tidak ada perangkat.",
  "settings.devices.this": "· ini",
  "settings.devices.active": "Aktif {date}",
  "settings.devices.revoke": "Cabut",
  "settings.workspace.title": "Workspace",
  "settings.workspace.desc":
    "Sisa Token dan masa aktif akunmu.",
  "settings.workspace.until": "Aktif Sampai {date}",
  "settings.account.title": "Akun",
  "settings.account.desc":
    "Akun yang sedang dipakai di dashboard ini.",
  "settings.account.signedIn": "Masuk sebagai",
  "settings.account.devMode":
    "Mode pengembangan: beralih ke {email} (workspace 1.500 Token). Cookie admin console tidak terpengaruh.",
  "settings.account.devLogin": "Masuk sebagai Dev (Customer)",
  "settings.account.processing": "Memproses…",
  "settings.account.signOut": "Keluar",
  "settings.account.devFailed": "Gagal masuk sebagai dev.",
  "settings.account.switchFailed": "Gagal beralih akun. Coba lagi.",
  "settings.appearance.title": "Tampilan",
  "settings.appearance.desc": "Pilih tema terang atau gelap serta bahasa tampilan.",
  "settings.appearance.dark": "Mode Gelap",
  "settings.appearance.light": "Mode Terang",
  "settings.appearance.lang": "Bahasa",
  "settings.chat.title": "Chat",
  "settings.chat.desc":
    "Atur model default untuk obrolan baru dan kelola riwayat chat.",
  "settings.chat.defaultModel": "Model default",
  "settings.chat.deleteAll": "Hapus Semua Riwayat",
  "settings.chat.deleted": "Semua riwayat obrolan dihapus.",
  "settings.chat.wipeConfirm": "Hapus semua riwayat obrolan?",
  "settings.chat.modelSaved": "Model default disimpan.",
  "settings.privacy.title": "Privasi & Data",
  "settings.privacy.desc": "Sesuai UU PDP, kamu bisa mengunduh atau menghapus datamu kapan saja.",
  "settings.privacy.download": "Unduh Dataku",
  "settings.privacy.erase": "Hapus Dataku",
  "settings.privacy.eraseConfirm":
    "Hapus semua dataku di perangkat ini? Tidak bisa dibatalkan.",
  "settings.privacy.erased": "Data di perangkat ini dihapus.",
  "settings.about.title": "Tentang",
  "settings.about.desc": "Versi & aturan main Token.",
  "settings.about.text":
    "FreeTokenAI v1.5 — Workspace berlaku 7 hari, dan Token otomatis diperpanjang 7 hari setiap transaksi berbayar selama saldo masih ada. Butuh bantuan? Hubungi kasir restoran.",

  // chat
  "chat.activeUntil": "Aktif Sampai {date}",
  "chat.headline": "Mau mulai dari mana hari ini?",
  "chat.stopped": "Dihentikan.",
  "chat.stoppedShort": "Dihentikan",
  "chat.continue": "Lanjutkan",
  "chat.loadOlder": "Muat pesan sebelumnya",
  "chat.loading": "Memuat…",
  "chat.newMessages": "Pesan baru",
  "chat.toBottom": "Ke bawah",
  "chat.scrollBottom": "Scroll ke bawah",
  "chat.sorry": "Maaf,",
  "chat.references": "Referensi",

  // suggestion cards
  "suggest.summarize.title": "Ringkas Dokumen",
  "suggest.summarize.desc":
    "Ubah artikel, PDF, atau catatan panjang jadi poin penting dalam hitungan detik.",
  "suggest.write.title": "Tulis & Kembangkan",
  "suggest.write.desc":
    "Bikin caption, email, atau draf tulisan — lengkap dengan beberapa pilihan nada.",
  "suggest.ask.title": "Tanya Apa Saja",
  "suggest.ask.desc":
    "Dari fakta sampai pertimbangan keputusan, dijawab langsung tanpa perlu menyaring hasil pencarian.",

  // chat input
  "input.uploadFile": "Upload File",
  "input.uploadDesc": "Dokumen, PDF, atau file lainnya",
  "input.placeholder": "Ketik apa saja — pertanyaan, tugas, atau ide mentah...",
  "input.disclaimer": "FreeTokenAI bisa keliru. Periksa info penting.",
  "input.terms": "Ketentuan Token",
  "input.addAttachment": "Tambah lampiran",
  "input.closeMenu": "Tutup menu lampiran",
  "input.uploadAria": "Upload file",
  "input.removeFile": "Hapus {name}",
  "input.send": "Kirim pesan",
  "input.stop": "Hentikan jawaban",
  "input.maxFiles": "Maksimal {n} file per pesan.",
  "input.tooLarge": "\"{name}\" melebihi batas {size}.",
  "input.roomLeft": "Hanya {n} file lagi yang bisa ditambahkan.",
  "input.uploadFailed": "Upload gagal (HTTP {status})",
  "input.noAttachment": "Server tidak mengembalikan data lampiran.",
  "input.uploadFailedShort": "Upload gagal.",
  "input.priceNote": "per 1.000 token (prompt + jawaban)",

  // model picker
  "model.choose": "Pilih model",
  "model.perThousand":
    "Token per 1.000 token (prompt + jawaban), dibulatkan ke atas.",
  "model.costNote": "Angka = Token terpotong {note}.",
  "model.aria": "Model: {label}, {cost} Token",

  // media studio
  "media.image.title": "Bikin Gambar",
  "media.video.title": "Bikin Video",
  "media.image.subtitle": "Teks ke gambar via VioStudio.",
  "media.video.subtitle": "Teks ke video via VioStudio.",
  "media.image.placeholder": "Tuliskan prompt kamu…",
  "media.image.empty": "Belum ada hasil",
  "media.video.empty": "Belum ada video",
  "media.empty.desc":
    "Tulis prompt di bawah lalu tekan Buat — atau klik salah satu contoh.",
  "media.download": "Unduh",
  "media.create": "Buat",
  "media.random": "Ide acak",
  "media.style": "Gaya gambar",
  "media.count": "Jumlah",
  "media.ratio": "Rasio",
  "media.failed": "Gagal: {error}",
  "media.detail": "Detail hasil",
  "media.done": "Selesai",
  "media.textToImage": "Teks ke Gambar",
  "media.textToVideo": "Teks ke Video",
  "media.imageLabel": "Gambar",
  "media.videoLabel": "Video",
  "media.prompt": "Prompt",
  "media.model": "Model",
  "media.credits": "Kredit",
  "media.created": "Dibuat",
  "media.recreate": "Buat Ulang",
  "media.delete": "Hapus",
  "media.clickDetail": "{prompt} — klik untuk lihat detail",
  "media.justNow": "baru saja",
  "media.minutesAgo": "{n} menit lalu",
  "media.hoursAgo": "{n} jam lalu",
  "media.daysAgo": "{n} hari lalu",
  "media.expiresIn": "Kedaluwarsa {n} hari lagi",
  "media.expired": "Sudah kedaluwarsa",
  "media.pricePerImage": "per gambar",
  "media.pricePerVideo": "per video",
  "media.pricePerImageTotal":
    "per gambar, total {credits} untuk {count}×",
  "media.tokens": "{n} Token",
  "media.style.auto": "Otomatis",
  "media.style.photo": "Fotorealistik",
  "media.style.anime": "Anime",
  "media.style.3d": "Ilustrasi 3D",
  "media.style.minimal": "Minimalis",
  "media.style.cinematic": "Sinematik",
  "media.style.poster": "Poster",

  // video generator
  "video.title": "Bikin Video",
  "video.subtitle.t2v": "Teks ke video via VioStudio & Gemini Veo.",
  "video.subtitle.i2v": "Gambar ke video via VioStudio & Gemini Veo.",
  "video.empty": "Belum ada video",
  "video.emptyDesc":
    "Pilih mode, tulis prompt/unggah gambar, lalu tekan Buat — atau klik contoh di bawah.",
  "video.processing": "Memproses...",
  "media.waiting": "Sedang dibuat · {time}",
  "media.waitHint": "Biasanya selesai ±1–2 menit",
  "media.waitSlow": "Antrean provider sedang ramai, tetap diproses…",
  "video.download": "Unduh",
  "video.downloadMp4": "Unduh MP4",
  "video.settings": "Pengaturan",
  "video.duration": "Durasi",
  "video.motion": "Gerakan",
  "video.quality": "Kualitas",
  "video.fps": "FPS",
  "video.random": "Ide acak",
  "video.reference.alt": "Gambar referensi",
  "video.reference.firstFrame": "Jadi bingkai pertama video",
  "video.reference.change": "Ganti",
  "video.reference.remove": "Hapus gambar",
  "video.reference.drop":
    "Klik atau tarik gambar referensi (JPG/PNG/WebP, maks 10 MB)",
  "video.prompt.t2v":
    "Jelaskan skenario video: subjek, gerakan kamera, lighting, gaya visual...",
  "video.prompt.i2v":
    "Gerakan (opsional): 'kamera zoom-in perlahan', 'subjek berjalan ke kiri'...",
  "video.mode.text": "Teks",
  "video.mode.image": "Gambar",
  "video.mode.toVideo": "{mode} → Video",
  "video.create": "Buat",
  "video.regenAlert":
    "Untuk regenerate Image-to-Video, silakan unggah ulang gambar referensinya.",
  "video.refFormat": "Format gambar harus JPG, PNG, atau WebP.",
  "video.refSize": "Ukuran gambar maksimal 10 MB.",
  "video.detail": "Detail video",
  "video.done": "Selesai",
  "video.imageToVideo": "Gambar ke Video",
  "video.textToVideo": "Teks ke Video",
  "video.prompt": "Prompt",
  "video.model": "Model",
  "video.ratio": "Rasio",
  "video.credits": "Kredit",
  "video.recreate": "Buat Ulang",
  "video.motion.low": "Low — Gerakan halus",
  "video.motion.medium": "Medium — Gerakan seimbang",
  "video.motion.high": "High — Gerakan dinamis",

  // developer api
  "dev.title": "Developer API",
  "dev.subtitle":
    "Generate API Key (PRD 7.4) lalu pakai di AI agent via gateway OpenAI-compatible (PRD 7.3).",
  "dev.keyTitle": "API Key untuk AI Agent",
  "dev.namePlaceholder": "Nama key, mis. Agen Warung — maks 100 char",
  "dev.generate": "Generate",
  "dev.copyNow": "Salin sekarang — key hanya ditampilkan 1x (NFR #2).",
  "dev.reveal": "Tampilkan key",
  "dev.copied": "Tersalin",
  "dev.copy": "Salin",
  "dev.close": "Tutup",
  "dev.noKeys": "Belum ada key. Generate satu di atas.",
  "dev.revoked": "(dicabut)",
  "dev.revoke": "Cabut key",
  "dev.reactivate": "Aktifkan lagi",
  "dev.delete": "Hapus permanen",
  "dev.usageTitle": "Pakai di AI Agent",
  "dev.usagePre":
    "Bentuk OpenAI-compatible — LangChain / Vercel AI SDK / curl langsung jalan. Base URL = asal dashboard ini + ",
  "dev.usagePost": ". Limit 60 req/menit/key (PRD 5.2).",
  "dev.modelsTitle": "Model gratis yang disarankan",
  "dev.free1.use": "Chat cepat / AI agent default",
  "dev.free1.id": "freetokenai-chat-fast → openai/gpt-oss-20b",
  "dev.free1.why":
    "Gratis di free-tier Groq, limit murah hati, terbukti 200 di repo ini. 1 Token / 1K token-LLM (PRD 6).",
  "dev.free2.use": "Chat reasoning / analisis kompleks",
  "dev.free2.id": "freetokenai-chat-pro → openai/gpt-oss-120b",
  "dev.free2.why":
    "Gratis juga di Groq, lebih pintar tapi lebih lambat. 10 Token / 1K token-LLM (PRD 6).",
  "dev.free3.use": "Fallback kalau Groq down",
  "dev.free3.id": "gemini-3.5-flash (langsung, bukan via gateway)",
  "dev.free3.why":
    "Free-tier Google AI Studio; kadang 503 high-demand — route /api/chat otomatis fallback ke Groq.",
  "dev.free4.use": "Gambar termurah",
  "dev.free4.id": "nano-banana-2 / veo-3.1-lite (Vio, berbayar)",
  "dev.free4.why":
    "Vio TIDAK punya tier gratis — tiap request motong kredit. Paling murah: gambar 3 kredit, video veo-3.1-lite 5 kredit. Alternatif benar-benar gratis: Pollinations.ai (gambar saja, kualitas kurang).",

  // claim page
  "claim.successTitle": "Token berhasil diklaim",
  "claim.successDesc":
    "Saldo token masuk ke akun Anda dan berlaku sampai {date}.",
  "claim.balance": "Saldo token",
  "claim.openDashboard": "Buka dashboard",
  "claim.autoLogin": "Anda sudah otomatis masuk di perangkat ini.",
  "claim.title": "Klaim Token Struk",
  "claim.subtitle": "Masukkan kode struk dan nomor WhatsApp/email Anda.",
  "claim.code": "Kode struk",
  "claim.identifier": "No. WhatsApp atau email",
  "claim.identifierPlaceholder": "0812xxxxxxx atau nama@email.com",
  "claim.submit": "Klaim token",
  "claim.processing": "Memproses…",
  "claim.note":
    "Satu kode struk hanya bisa diklaim satu kali. Token berlaku 7 hari sejak klaim.",
  "claim.signedInNote": "Token akan langsung masuk ke akun yang sedang login.",
  "claim.signedInSuccess": "Token masuk ke akunmu. Kamu tidak perlu login ulang.",
  "claim.httpFailed": "Klaim gagal (HTTP {status}).",
  "claim.network":
    "Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.",
} as const;

const en: Record<keyof typeof id, string> = {
  "common.close": "Close",
  "common.delete": "Delete",
  "common.download": "Download",
  "common.loading": "Loading…",
  "common.settings": "Settings",

  "sidebar.newChat": "New chat",
  "sidebar.image": "Create Image",
  "sidebar.video": "Create Video",
  "sidebar.developer": "Developer API",
  "sidebar.recent": "Recent",
  "sidebar.empty": "No conversations yet.",
  "sidebar.deleteChat": "Delete chat",
  "sidebar.deleteChatAria": "Delete {title}",
  "sidebar.logout": "Sign out / Change key",
  "sidebar.settings": "Settings",
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.expand": "Expand sidebar",
  "sidebar.closeMenu": "Close menu",

  "topbar.tokens": "Your tokens",
  "topbar.menu": "Open menu",
  "theme.toggle": "Toggle dark/light mode",

  "auth.welcome": "Welcome to FreeTokenAI",
  "auth.desc":
    "To use AI, buy a token receipt at the cafe cashier and claim its code.",
  "auth.needKey":
    "Have a receipt? Enter its code and your WhatsApp/email on the claim page.",

  "tokens.title": "Token Balance Empty",
  "tokens.desc": "Choose one of the options below to keep using AI.",
  "tokens.balance": "Remaining Tokens",
  "tokens.claimTitle": "Have a receipt code?",
  "tokens.claimDesc": "Enter the receipt code from the cafe cashier.",
  "tokens.claimBtn": "Claim Tokens",
  "tokens.claiming": "Claiming...",
  "tokens.claimSuccess": "Tokens were added to this account. You can keep using AI.",
  "tokens.claimFailed": "Failed to claim tokens.",
  "tokens.adminTitle": "Ask admin to add balance",
  "tokens.adminDesc":
    "Ask the admin to add balance to this account. It updates automatically without logging out.",
  "tokens.check": "Check Balance",
  "tokens.checking": "Checking...",
  "tokens.adminSuccess": "Balance has been added. You can keep using AI.",
  "tokens.continue": "Continue Using AI",

  "settings.title": "Settings",
  "settings.subtitle": "Your profile, devices, workspace, and preferences.",
  "settings.profile.title": "Profile",
  "settings.profile.desc":
    "Your name and contact, shown on the sidebar profile card.",
  "settings.profile.name": "Name",
  "settings.profile.contact": "Phone / email",
  "settings.profile.save": "Save Profile",
  "settings.profile.noName": "No Name",
  "settings.profile.saved": "Profile saved.",
  "settings.devices.title": "Devices",
  "settings.devices.desc":
    "Up to {n} active devices. Signing in on a new device signs out the oldest one.",
  "settings.devices.empty": "No devices.",
  "settings.devices.this": "· this one",
  "settings.devices.active": "Active {date}",
  "settings.devices.revoke": "Revoke",
  "settings.workspace.title": "Workspace",
  "settings.workspace.desc":
    "Your remaining Tokens and account expiry date.",
  "settings.workspace.until": "Active until {date}",
  "settings.account.title": "Account",
  "settings.account.desc":
    "The account currently being used in this dashboard.",
  "settings.account.signedIn": "Signed in as",
  "settings.account.devMode":
    "Development mode: switch to {email} (1,500 Token workspace). The admin console cookie is unaffected.",
  "settings.account.devLogin": "Sign in as Dev (Customer)",
  "settings.account.processing": "Processing…",
  "settings.account.signOut": "Sign out",
  "settings.account.devFailed": "Failed to sign in as dev.",
  "settings.account.switchFailed": "Failed to switch account. Try again.",
  "settings.appearance.title": "Appearance",
  "settings.appearance.desc": "Choose light or dark theme and your display language.",
  "settings.appearance.dark": "Dark Mode",
  "settings.appearance.light": "Light Mode",
  "settings.appearance.lang": "Language",
  "settings.chat.title": "Chat",
  "settings.chat.desc":
    "Set the default model for new chats and manage your chat history.",
  "settings.chat.defaultModel": "Default model",
  "settings.chat.deleteAll": "Delete All History",
  "settings.chat.deleted": "All chat history deleted.",
  "settings.chat.wipeConfirm": "Delete all chat history?",
  "settings.chat.modelSaved": "Default model saved.",
  "settings.privacy.title": "Privacy & Data",
  "settings.privacy.desc": "Under the PDP Law, you can download or delete your data anytime.",
  "settings.privacy.download": "Download My Data",
  "settings.privacy.erase": "Delete My Data",
  "settings.privacy.eraseConfirm":
    "Delete all my data on this device? This cannot be undone.",
  "settings.privacy.erased": "Data on this device has been deleted.",
  "settings.about.title": "About",
  "settings.about.desc": "Version & token rules.",
  "settings.about.text":
    "FreeTokenAI v1.5 — Workspaces last 7 days, and Tokens auto-extend by 7 days on every paid transaction while your balance is positive. Need help? Contact the restaurant cashier.",

  "chat.activeUntil": "Active until {date}",
  "chat.headline": "Where would you like to start today?",
  "chat.stopped": "Stopped.",
  "chat.stoppedShort": "Stopped",
  "chat.continue": "Continue",
  "chat.loadOlder": "Load earlier messages",
  "chat.loading": "Loading…",
  "chat.newMessages": "New messages",
  "chat.toBottom": "To bottom",
  "chat.scrollBottom": "Scroll to bottom",
  "chat.sorry": "Sorry,",
  "chat.references": "References",

  "suggest.summarize.title": "Summarize Documents",
  "suggest.summarize.desc":
    "Turn long articles, PDFs, or notes into key points in seconds.",
  "suggest.write.title": "Write & Expand",
  "suggest.write.desc":
    "Create captions, emails, or drafts — with several tone options.",
  "suggest.ask.title": "Ask Anything",
  "suggest.ask.desc":
    "From facts to decision considerations, answered directly without filtering search results.",

  "input.uploadFile": "Upload File",
  "input.uploadDesc": "Documents, PDFs, or other files",
  "input.placeholder": "Type anything — a question, task, or raw idea...",
  "input.disclaimer": "FreeTokenAI can make mistakes. Check important info.",
  "input.terms": "Token Terms",
  "input.addAttachment": "Add attachment",
  "input.closeMenu": "Close attachment menu",
  "input.uploadAria": "Upload file",
  "input.removeFile": "Remove {name}",
  "input.send": "Send message",
  "input.stop": "Stop response",
  "input.maxFiles": "Maximum {n} files per message.",
  "input.tooLarge": "\"{name}\" exceeds the {size} limit.",
  "input.roomLeft": "Only {n} more files can be added.",
  "input.uploadFailed": "Upload failed (HTTP {status})",
  "input.noAttachment": "Server did not return attachment data.",
  "input.uploadFailedShort": "Upload failed.",
  "input.priceNote": "per 1,000 tokens (prompt + answer)",

  "model.choose": "Choose model",
  "model.perThousand":
    "Tokens per 1,000 tokens (prompt + answer), rounded up.",
  "model.costNote": "The number = tokens deducted {note}.",
  "model.aria": "Model: {label}, {cost} Token",

  "media.image.title": "Create Image",
  "media.video.title": "Create Video",
  "media.image.subtitle": "Text to image via VioStudio.",
  "media.video.subtitle": "Text to video via VioStudio.",
  "media.image.placeholder": "Write your prompt…",
  "media.image.empty": "No results yet",
  "media.video.empty": "No videos yet",
  "media.empty.desc":
    "Write a prompt below and press Create — or click an example.",
  "media.download": "Download",
  "media.create": "Create",
  "media.random": "Random idea",
  "media.style": "Image style",
  "media.count": "Count",
  "media.ratio": "Ratio",
  "media.failed": "Failed: {error}",
  "media.detail": "Result details",
  "media.done": "Done",
  "media.textToImage": "Text to Image",
  "media.textToVideo": "Text to Video",
  "media.imageLabel": "Image",
  "media.videoLabel": "Video",
  "media.prompt": "Prompt",
  "media.model": "Model",
  "media.credits": "Credits",
  "media.created": "Created",
  "media.recreate": "Recreate",
  "media.delete": "Delete",
  "media.clickDetail": "{prompt} — click to view details",
  "media.justNow": "just now",
  "media.minutesAgo": "{n} minutes ago",
  "media.hoursAgo": "{n} hours ago",
  "media.daysAgo": "{n} days ago",
  "media.expiresIn": "Expires in {n} days",
  "media.expired": "Expired",
  "media.pricePerImage": "per image",
  "media.pricePerVideo": "per video",
  "media.pricePerImageTotal": "per image, total {credits} for {count}×",
  "media.tokens": "{n} Token",
  "media.style.auto": "Auto",
  "media.style.photo": "Photorealistic",
  "media.style.anime": "Anime",
  "media.style.3d": "3D Illustration",
  "media.style.minimal": "Minimalist",
  "media.style.cinematic": "Cinematic",
  "media.style.poster": "Poster",

  "video.title": "Create Video",
  "video.subtitle.t2v": "Text to video via VioStudio & Gemini Veo.",
  "video.subtitle.i2v": "Image to video via VioStudio & Gemini Veo.",
  "video.empty": "No videos yet",
  "video.emptyDesc":
    "Choose a mode, write a prompt/upload an image, then press Create — or click an example below.",
  "video.processing": "Processing...",
  "media.waiting": "Generating · {time}",
  "media.waitHint": "Usually ready in ~1–2 minutes",
  "media.waitSlow": "Provider queue is busy, still processing…",
  "video.download": "Download",
  "video.downloadMp4": "Download MP4",
  "video.settings": "Settings",
  "video.duration": "Duration",
  "video.motion": "Motion",
  "video.quality": "Quality",
  "video.fps": "FPS",
  "video.random": "Random idea",
  "video.reference.alt": "Reference image",
  "video.reference.firstFrame": "Becomes the video's first frame",
  "video.reference.change": "Change",
  "video.reference.remove": "Remove image",
  "video.reference.drop":
    "Click or drop a reference image (JPG/PNG/WebP, max 10 MB)",
  "video.prompt.t2v":
    "Describe the video scenario: subject, camera movement, lighting, visual style...",
  "video.prompt.i2v":
    "Motion (optional): 'slow camera zoom-in', 'subject walks left'...",
  "video.mode.text": "Text",
  "video.mode.image": "Image",
  "video.mode.toVideo": "{mode} → Video",
  "video.create": "Create",
  "video.regenAlert":
    "To regenerate Image-to-Video, please upload the reference image again.",
  "video.refFormat": "Image format must be JPG, PNG, or WebP.",
  "video.refSize": "Maximum image size is 10 MB.",
  "video.detail": "Video details",
  "video.done": "Done",
  "video.imageToVideo": "Image to Video",
  "video.textToVideo": "Text to Video",
  "video.prompt": "Prompt",
  "video.model": "Model",
  "video.ratio": "Ratio",
  "video.credits": "Credits",
  "video.recreate": "Recreate",
  "video.motion.low": "Low — Smooth motion",
  "video.motion.medium": "Medium — Balanced motion",
  "video.motion.high": "High — Dynamic motion",

  "dev.title": "Developer API",
  "dev.subtitle":
    "Generate an API Key (PRD 7.4) and use it in AI agents via the OpenAI-compatible gateway (PRD 7.3).",
  "dev.keyTitle": "API Key for AI Agents",
  "dev.namePlaceholder": "Key name, e.g. Warung Agent — max 100 chars",
  "dev.generate": "Generate",
  "dev.copyNow": "Copy now — the key is shown only once (NFR #2).",
  "dev.reveal": "Show key",
  "dev.copied": "Copied",
  "dev.copy": "Copy",
  "dev.close": "Close",
  "dev.noKeys": "No keys yet. Generate one above.",
  "dev.revoked": "(revoked)",
  "dev.revoke": "Revoke key",
  "dev.reactivate": "Reactivate",
  "dev.delete": "Delete permanently",
  "dev.usageTitle": "Use in an AI Agent",
  "dev.usagePre":
    "OpenAI-compatible — LangChain / Vercel AI SDK / curl works out of the box. Base URL = this dashboard origin + ",
  "dev.usagePost": ". Limit 60 req/min/key (PRD 5.2).",
  "dev.modelsTitle": "Recommended free models",
  "dev.free1.use": "Fast chat / default AI agent",
  "dev.free1.id": "freetokenai-chat-fast → openai/gpt-oss-20b",
  "dev.free1.why":
    "Free on Groq's free tier, generous limits, verified 200 in this repo. 1 Token / 1K LLM tokens (PRD 6).",
  "dev.free2.use": "Reasoning chat / complex analysis",
  "dev.free2.id": "freetokenai-chat-pro → openai/gpt-oss-120b",
  "dev.free2.why":
    "Also free on Groq, smarter but slower. 10 Tokens / 1K LLM tokens (PRD 6).",
  "dev.free3.use": "Fallback if Groq is down",
  "dev.free3.id": "gemini-3.5-flash (direct, not via gateway)",
  "dev.free3.why":
    "Google AI Studio free tier; sometimes 503 high-demand — the /api/chat route falls back to Groq automatically.",
  "dev.free4.use": "Cheapest image",
  "dev.free4.id": "nano-banana-2 / veo-3.1-lite (Vio, paid)",
  "dev.free4.why":
    "Vio has NO free tier — every request consumes credits. Cheapest: 3 credits for images, 5 credits for veo-3.1-lite video. Truly free alternative: Pollinations.ai (images only, lower quality).",

  "claim.successTitle": "Tokens claimed successfully",
  "claim.successDesc":
    "The token balance has been added to your account and is valid until {date}.",
  "claim.balance": "Token balance",
  "claim.openDashboard": "Open dashboard",
  "claim.autoLogin": "You are automatically signed in on this device.",
  "claim.title": "Claim Receipt Tokens",
  "claim.subtitle": "Enter your receipt code and WhatsApp number/email.",
  "claim.code": "Receipt code",
  "claim.identifier": "WhatsApp number or email",
  "claim.identifierPlaceholder": "0812xxxxxxx or name@email.com",
  "claim.submit": "Claim tokens",
  "claim.processing": "Processing…",
  "claim.note":
    "Each receipt code can only be claimed once. Tokens are valid for 7 days from claiming.",
  "claim.signedInNote": "Tokens will go directly to the account you are signed in with.",
  "claim.signedInSuccess": "Tokens were added to your account. No need to sign in again.",
  "claim.httpFailed": "Claim failed (HTTP {status}).",
  "claim.network": "Cannot reach the server. Check your connection and try again.",
};

const DICT: Record<Lang, Record<string, string>> = { id, en };

export type TKey = keyof typeof id;

export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  let text = DICT[lang][key] ?? DICT.id[key] ?? key;
  if (vars)
    for (const [name, value] of Object.entries(vars))
      text = text.split(`{${name}}`).join(String(value));
  return text;
}

export function localeOf(lang: Lang): string {
  return lang === "en" ? "en-US" : "id-ID";
}

// ponytail: bahasa disimpan di localStorage (lib/settings.ts). Event
// SETTINGS_CHANGED dipancarkan saat dropdown Bahasa diganti, jadi semua
// komponen yang memakai hook ini langsung re-render dengan bahasa baru.
export function useT() {
  const [lang, setLang] = useState<Lang>("id");

  useEffect(() => {
    const sync = () => {
      const next = getAppSettings().language;
      setLang(next);
      try {
        document.documentElement.lang = next;
      } catch {
        // abaikan
      }
    };
    sync();
    window.addEventListener(SETTINGS_CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const t = useCallback(
    (key: TKey, vars?: TVars) => translate(lang, key, vars),
    [lang],
  );

  return { lang, t, locale: localeOf(lang) };
}
