import { NextResponse } from "next/server";
import { permissionDenied } from "@/lib/permissions";
import { resolveRoute, chatComplete, type AiRoute } from "@/lib/ai-router";
import { DEFAULT_CHAT_MODEL } from "@/lib/chat-models";
import { isModelAllowed, modelCost } from "@/lib/model-registry";
import { sql } from "@/lib/db";
import { evaluateAiRequest, gatekeeperAccessResponse, gatekeeperBlockResponse } from "@/lib/gatekeeper";
import {
  chatCost,
  InsufficientTokensError,
  insufficient,
  withTokens,
  workspaceIdForRequest,
} from "@/lib/billing";

// Proxy server-only. API key provider diambil dari katalog admin; tidak pernah ke client.
// Semua model platform memotong Token sesuai harga model.
const GEMINI_DEFAULT = process.env.GEMINI_MODEL ?? DEFAULT_CHAT_MODEL;
const SYSTEM_ID =
  "Jawab dalam Bahasa Indonesia yang ringkas dan membantu. " +
  "Untuk jawaban yang bersifat faktual (bukan opini atau kreatif murni), akhiri dengan blok 'Referensi:' berisi 1-3 sumber relevan " +
  "(nama sumber — URL bila tahu, satu per baris). Tanpa jawaban faktual = tanpa blok referensi.";
const SYSTEM_EN =
  "Answer in concise, helpful English. " +
  "For factual answers (not opinion or purely creative), end with a 'References:' block containing 1-3 relevant sources " +
  "(source name — URL if known, one per line). No factual answer = no references block.";

type HistItem = { role?: unknown; content?: unknown };

async function callModel(route: AiRoute, message: string, history: HistItem[], system: string) {
  const out = await chatComplete(route, { system, message, history });
  return out;
}

async function providerResponse(route: AiRoute, message: string, history: HistItem[], system: string) {
  const out = await callModel(route, message, history, system);
  if (out.ok) return NextResponse.json({ reply: out.reply });

  // platform Gemini sering 503 high-demand -> fallback Groq 20b bila key tersedia
  if (route.family === "gemini") {
    const alt = await resolveRoute("openai/gpt-oss-20b", "chat");
    if (alt) {
      const retry = await callModel(alt, message, history, system);
      if (retry.ok) return NextResponse.json({ reply: retry.reply });
    }
  }
  return NextResponse.json(
    { error: { code: "PROVIDER_ERROR", message: out.message } },
    { status: out.status },
  );
}

// ponytail: persist 1 giliran chat (user + assistant) ke chat_sessions/
// chat_messages; assistant ditautkan usage_log_id (dari withTokens).
async function saveChatTurn(
  wsId: string,
  sessionId: string,
  userText: string,
  reply: string,
  usageId: string | undefined,
): Promise<string> {
  const title = userText.slice(0, 60) || "Obrolan Baru";
  return (await sql.begin(async (tx: any) => {
    let sid = sessionId;
    if (sid) {
      const ok = (await tx`
        SELECT 1 FROM chat_sessions WHERE id = ${sid} AND workspace_id = ${wsId} LIMIT 1`) as unknown as unknown[];
      if (!ok[0]) sid = "";
    }
    if (!sid) {
      const created = (await tx`
        INSERT INTO chat_sessions (workspace_id, title) VALUES (${wsId}, ${title})
        RETURNING id`) as unknown as { id: string }[];
      sid = created[0].id;
    }
    await tx`INSERT INTO chat_messages (session_id, role, content) VALUES (${sid}, 'user', ${userText})`;
    await tx`
      INSERT INTO chat_messages (session_id, role, content, usage_log_id)
      VALUES (${sid}, 'assistant', ${reply}, ${usageId ?? null})`;
    await tx`
      UPDATE chat_sessions SET updated_at = now(),
        title = CASE WHEN title = 'Obrolan Baru' THEN ${title} ELSE title END
      WHERE id = ${sid}`;
    return sid;
  })) as unknown as string;
}

async function persistAndRespond(
  res: NextResponse,
  ctx: { wsId: string; sessionId: string; message: string; usageId?: string },
) {
  let data: { reply?: string };
  try {
    data = await res.clone().json();
  } catch {
    return res;
  }
  const reply = String(data?.reply ?? "");
  if (!reply) return res;
  try {
    const sid = await saveChatTurn(ctx.wsId, ctx.sessionId, ctx.message, reply, ctx.usageId);
    return NextResponse.json({ ...data, session_id: sid });
  } catch (e) {
    console.error("chat persist failed", e);
    return res;
  }
}

export async function POST(req: Request) {
  const denied = await permissionDenied("customer", "ai.chat");
  if (denied) return denied;
  let body: { message?: unknown; history?: HistItem[]; model?: unknown; session_id?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_PROMPT", message: "Body bukan JSON." } },
      { status: 400 },
    );
  }
  const message = String(body.message ?? "").trim().slice(0, 8000);
  if (!message)
    return NextResponse.json(
      { error: { code: "INVALID_PROMPT", message: "Pesan tidak boleh kosong." } },
      { status: 400 },
    );

  const gateInput = [
    message,
    ...(Array.isArray(body.history)
      ? body.history
          .filter((item) => item.role !== "assistant")
          .slice(-20)
          .map((item) => String(item.content ?? "").slice(0, 8000))
      : []),
  ].join("\n");
  const gate = gatekeeperBlockResponse(evaluateAiRequest(gateInput, "chat"));
  if (gate) return gate;

  const model = String(body.model ?? GEMINI_DEFAULT).slice(0, 80);
  const system = body.lang === "en" ? SYSTEM_EN : SYSTEM_ID;

  const route = await resolveRoute(model, "chat");
  if (!route) {
    if (await isModelAllowed("chat", model))
      return NextResponse.json(
        { error: { code: "NO_API_KEY", message: "API key provider belum diisi admin. Hubungi super_admin." } },
        { status: 500 },
      );
    return NextResponse.json(
      { error: { code: "INVALID_MODEL", message: "Model tidak dikenal / tidak aktif di katalog." } },
      { status: 400 },
    );
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 64) : "";
  const wsId = await workspaceIdForRequest(req);

  if (!wsId) {
    if (process.env.NODE_ENV === "production")
      return gatekeeperAccessResponse("chat", "Belum login.");
    return providerResponse(route, message, history, system);
  }

  let usageId: string | undefined;
  try {
    // ponytail: tarif per 1k token × perkiraan token prompt (min 1) — konsisten
    // dengan jalur streaming yang kini ikut menagih isi pesan/history/dokumen.
    const per1k = (await modelCost("chat", model)) ?? chatCost(model);
    const inputChars =
      gateInput.length + (Array.isArray(body.history) ? body.history.reduce((n, h) => n + String(h?.content ?? "").length, 0) : 0);
    const cost = Math.max(1, Math.ceil((Math.ceil(inputChars / 4) / 1000) * per1k));
    const res = await withTokens(wsId, cost, () => providerResponse(route, message, history, system), {
      modelId: model,
      endpointType: "chat",
      onUsageLogged: (id) => {
        usageId = id;
      },
    });
    if (res.ok) return persistAndRespond(res, { wsId, sessionId, message, usageId });
    return res;
  } catch (e) {
    if (e instanceof InsufficientTokensError) return insufficient(e, "chat");
    throw e;
  }
}
