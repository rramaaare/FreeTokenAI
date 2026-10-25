import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { mediaAssetSource } from "@/lib/ai-media";

// Proxy aset video platform: file provider butuh header key, sedangkan <video src>
// tidak bisa mengirim header. Stream diteruskan tanpa membocorkan key.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth)
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Belum login." } }, { status: 401 });
  const { id } = await params;
  const source = await mediaAssetSource(id);
  if (!source)
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Aset tidak ditemukan." } }, { status: 404 });
  // Aset tanpa pemilik (user_id NULL) juga ditolak: jangan jadi celah lintas user.
  if (source.user_id !== auth.user.id)
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Bukan asetmu." } }, { status: 403 });

  try {
    const res = await fetch(source.url, {
      headers: source.key ? { "x-goog-api-key": source.key } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body)
      return NextResponse.json({ error: { code: "UPSTREAM", message: `Gagal mengambil aset (HTTP ${res.status}).` } }, { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "video/mp4",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: { code: "UPSTREAM", message: e instanceof Error ? e.message : "Gagal mengambil aset." } },
      { status: 502 },
    );
  }
}
