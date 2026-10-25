import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { pollMediaGeneration, vioJobOwner } from "@/lib/ai-media";
import { vioFetch } from "@/lib/vio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cek status job media: job Gemini async (UUID) atau Vio (id numerik, lama).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (UUID.test(id)) {
    const auth = await requireAuth(req);
    if (!auth)
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Belum login." } }, { status: 401 });
    const result = await pollMediaGeneration(id, auth.user.id);
    if (!result)
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Job tidak ditemukan." } }, { status: 404 });
    return NextResponse.json(result);
  }
  // Job Vio: hanya pemiliknya yang boleh cek status/ambil hasil. Job yang tak
  // tercatat atau milik user lain dijawab 404 (sama-sama "tidak ada") supaya id
  // berurutan tidak bisa dipakai menebak hasil generate orang lain.
  if (!/^\d+$/.test(id))
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Job tidak ditemukan." } }, { status: 404 });
  const auth = await requireAuth(req);
  const owner = await vioJobOwner(id);
  const devAnon = process.env.NODE_ENV !== "production" && !auth && owner?.user_id === null;
  if (!owner || (!devAnon && (!auth || owner.user_id !== auth.user.id)))
    return NextResponse.json(
      { error: { code: auth || devAnon ? "NOT_FOUND" : "UNAUTHORIZED", message: auth ? "Job tidak ditemukan." : "Belum login." } },
      { status: auth ? 404 : 401 },
    );
  const { status, data } = await vioFetch(`/generations/${id}`);
  return NextResponse.json(data, { status });
}
