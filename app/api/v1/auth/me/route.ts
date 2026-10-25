import { NextResponse } from "next/server";
import { clearedSessionCookie, requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth && (auth.user.role === "customer" || auth.user.role === "super_admin")) {
    return NextResponse.json({ user: auth.user });
  }

  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Belum login. Klaim kode struk dari kasir di halaman /claim." } },
    { status: 401 },
  );
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true, message: "Berhasil logout." });
  res.headers.set("Set-Cookie", clearedSessionCookie());
  return res;
}
