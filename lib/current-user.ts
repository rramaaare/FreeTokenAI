// ponytail: semua key riwayat lokal (chat + media + profil) di-scope ke id ini.
// Id = id AKUN yang sedang login (diset DashboardShell lewat bindCurrentUser
// setelah /api/v1/auth/me), jadi dua pelanggan di HP/tablet yang sama tidak
// saling melihat riwayat. Belum login -> "anon" (tidak pernah id akun lain).
// Pembaca riwayat wajib menunggu isUserResolved() / event CURRENT_USER_CHANGED:
// sebelum itu id masih milik sesi sebelumnya di perangkat ini.
export const CURRENT_USER_CHANGED = "ftai:current-user-changed";
const KEY = "ftai:user:id";
let resolved = false;

export function currentUserId(): string {
  if (typeof window === "undefined") return "server";
  try {
    return localStorage.getItem(KEY) || "anon";
  } catch {
    return "anon";
  }
}

export function isUserResolved(): boolean {
  return resolved;
}

/** Ikat riwayat lokal ke akun login (null = belum login / keluar). Selalu memicu event. */
export function bindCurrentUser(userId: string | null) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, userId || "anon");
  } catch {
    // storage diblokir -> currentUserId() jatuh ke "anon"
  }
  resolved = true;
  window.dispatchEvent(new Event(CURRENT_USER_CHANGED));
}
