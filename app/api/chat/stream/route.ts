import { NextResponse } from "next/server";
import { permissionDenied } from "@/lib/permissions";
import { resolveRoute, streamChat, supportsVision, type StreamUsage } from "@/lib/ai-router";
import { DEFAULT_CHAT_MODEL } from "@/lib/chat-models";
import { buildChatContext, loadSessionAttachments } from "@/lib/chat-context";
import {
  ChatTurnError,
  finishAssistantTurn,
  loadHistoryBefore,
  loadLastAssistant,
  startChatTurn,
  type FinishReason,
  type StartedTurn,
} from "@/lib/chat-turn";
import { isModelAllowed, modelCost } from "@/lib/model-registry";
import { sql } from "@/lib/db";
import { evaluateAiRequest, gatekeeperAccessResponse, gatekeeperBlockResponse } from "@/lib/gatekeeper";
import {
  chatCost,
  InsufficientTokensError,
  insufficientMessage,
  withTokensStream,
  workspaceIdForRequest,
} from "@/lib/billing";

// Vercel default 10 detik -> jawaban panjang kepotong. 60 = batas Hobby.
export const maxDuration = 60;

const GEMINI_DEFAULT = process.env.GEMINI_MODEL ?? DEFAULT_CHAT_MODEL;
const SYSTEM_ID =
  "Jawab dalam Bahasa Indonesia yang ringkas dan membantu. " +
  "Untuk jawaban yang bersifat faktual (bukan opini atau kreatif murni), akhiri dengan blok 'Referensi:' berisi 1-3 sumber relevan " +
  "(nama sumber — URL bila tahu, satu per baris). Tanpa jawaban faktual = tanpa blok referensi.";
const SYSTEM_EN =
  "Answer in concise, helpful English. " +
  "For factual answers (not opinion or purely creative), end with a 'References:' block containing 1-3 relevant sources " +
  "(source name — URL if known, one per line). No factual answer = no references block.";

const CONTINUE_PROMPT_ID =
  "Lanjutkan jawaban sebelumnya TEPAT dari bagian terakhir. " +
  "Jangan mengulang kalimat yang sudah ada, jangan memberi pembuka baru. " +
  "Mulai langsung dengan kelanjutannya.";
const CONTINUE_PROMPT_EN =
  "Continue the previous answer EXACTLY from where it stopped. " +
  "Do not repeat existing sentences and do not add a new opening. " +
  "Start directly with the continuation.";

type HistItem = { role?: unknown; content?: unknown };

type Body = {
  message?: unknown;
  history?: HistItem[];
  model?: unknown;
  session_id?: unknown;
  attachment_ids?: unknown;
  continue?: unknown;
  lang?: unknown;
};

function normalizeFinish(reason: string): FinishReason {
  if (reason === "stop" || reason === "length" || reason === "aborted" || reason === "token_exhausted")
    return reason;
  return "error";
}

async function hasImageAttachments(wsId: string, attachmentIds: string[]): Promise<boolean> {
  if (!attachmentIds.length) return false;
  const rows = (await sql`
    SELECT 1 FROM chat_attachments
    WHERE id = ANY(${attachmentIds})
      AND workspace_id = ${wsId}
      AND message_id IS NULL
      AND kind = 'image'
    LIMIT 1`) as unknown as unknown[];
  return Boolean(rows[0]);
}

export async function POST(req: Request) {
  const denied = await permissionDenied("customer", "ai.chat");
  if (denied) return denied;
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_PROMPT", message: "Body bukan JSON." } },
      { status: 400 },
    );
  }

  const isContinue = body.continue === true;
  const lang: "id" | "en" = body.lang === "en" ? "en" : "id";
  const L = (id: string, en: string) => (lang === "en" ? en : id);
  const message = String(body.message ?? "").trim().slice(0, 16_000);
  if (!isContinue && !message)
    return NextResponse.json(
      { error: { code: "INVALID_PROMPT", message: "Pesan tidak boleh kosong." } },
      { status: 400 },
    );

  const history = Array.isArray(body.history) ? body.history : [];
  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 64) : "";
  const attachmentIds = Array.isArray(body.attachment_ids)
    ? body.attachment_ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.slice(0, 64))
        .slice(0, 5)
    : [];

  // Gatekeeper: bila diblokir, balas SEKARANG. Bila user login, giliran (user +
  // jawaban penolakan) disimpan lalu dikirim sebagai frame SSE `done` — bukan
  // error HTTP — supaya tampil seketika dan tetap ada setelah reload. (Sebelumnya
  // error HTTP hilang saat sesi baru hydrate dari DB, baru muncul di prompt berikutnya.)
  if (!isContinue) {
    const gateInput = [
      message,
      ...(Array.isArray(body.history)
        ? body.history
            .filter((item) => item.role !== "assistant")
            .slice(-20)
            .map((item) => String(item.content ?? "").slice(0, 8000))
        : []),
    ].join("\n");
    const gate = evaluateAiRequest(gateInput, "chat");
    if (gate.decision !== "ALLOW") {
      // DB bisa sedang off -> jangan gagal hanya karena penolakan; fallback ke HTTP.
      const gateWs = await workspaceIdForRequest(req).catch(() => null);
      if (gateWs) {
        try {
          const gturn = await startChatTurn({ workspaceId: gateWs, sessionId, userText: message, attachmentIds });
          const assistantMessageId = await finishAssistantTurn({
            workspaceId: gateWs,
            sessionId: gturn.sessionId,
            reply: gate.user_message,
            finishReason: "error",
          });
          const payload =
            `data: ${JSON.stringify({ text: gate.user_message })}\n\n` +
            `data: ${JSON.stringify({
              done: true,
              totalTokens: 0,
              finishReason: "error",
              sessionId: gturn.sessionId,
              assistantMessageId,
            })}\n\n`;
          return new Response(payload, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (e) {
          if (e instanceof ChatTurnError)
            return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
          // persistensi gagal -> tetap beri tahu user lewat HTTP
        }
      }
      return gatekeeperBlockResponse(gate)!;
    }
  }

  const model = String(body.model ?? GEMINI_DEFAULT).slice(0, 80);
  const route = await resolveRoute(model, "chat");
  if (!route) {
    if (await isModelAllowed("chat", model))
      return NextResponse.json(
        { error: { code: "NO_API_KEY", message: L("API key provider belum diisi admin. Hubungi super_admin.", "The provider API key has not been set by the admin. Contact super_admin.") } },
        { status: 500 },
      );
    return NextResponse.json(
      { error: { code: "INVALID_MODEL", message: L("Model tidak dikenal / tidak aktif di katalog.", "Unknown model / not active in the catalog.") } },
      { status: 400 },
    );
  }

  const wsId = await workspaceIdForRequest(req);
  if (!wsId && process.env.NODE_ENV === "production")
    return gatekeeperAccessResponse("chat", "Belum login.");
  if (isContinue && (!wsId || !sessionId))
    return NextResponse.json(
      { error: { code: "INVALID_SESSION", message: L("Sesi tidak valid untuk melanjutkan.", "Invalid session for continuing.") } },
      { status: 400 },
    );

  let lastAssistant: Awaited<ReturnType<typeof loadLastAssistant>> = null;
  let appendToMessageId: string | undefined;
  let historyForApi: HistItem[] = history;
  let providerMessage = message;

  if (isContinue && wsId) {
    lastAssistant = await loadLastAssistant(wsId, sessionId);
    if (!lastAssistant)
      return NextResponse.json(
        { error: { code: "NO_MESSAGE", message: L("Tidak ada jawaban yang bisa dilanjutkan.", "There is no answer to continue.") } },
        { status: 400 },
      );
    historyForApi = [
      ...(await loadHistoryBefore(sessionId, lastAssistant.id)),
      { role: "assistant", content: lastAssistant.content },
    ];
    providerMessage = lang === "en" ? CONTINUE_PROMPT_EN : CONTINUE_PROMPT_ID;
    appendToMessageId = lastAssistant.id;
  }

  // Cek gambar SEBELUM menyimpan pesan user agar tidak ada giliran yatim.
  if (wsId && attachmentIds.length && (await hasImageAttachments(wsId, attachmentIds)) && !supportsVision(route))
    return NextResponse.json(
      {
        error: {
          code: "VISION_UNSUPPORTED",
          message: L("Model ini belum mendukung gambar. Pilih model Gemini atau model vision lain.", "This model does not support images yet. Choose Gemini or another vision model."),
        },
      },
      { status: 400 },
    );

  // Gambar dari pesan lama di sesi ini juga harus didukung model yang dipilih.
  if (wsId && sessionId && !isContinue) {
    const preAttachments = await loadSessionAttachments(wsId, sessionId);
    if (preAttachments.some((a) => a.kind === "image") && !supportsVision(route))
      return NextResponse.json(
        {
          error: {
            code: "VISION_UNSUPPORTED",
            message: L("Sesi ini berisi gambar. Pilih model Gemini atau model vision lain.", "This session contains images. Choose Gemini or another vision model."),
          },
        },
        { status: 400 },
      );
  }

  let turn: StartedTurn | null = null;
  if (!isContinue && wsId) {
    try {
      turn = await startChatTurn({ workspaceId: wsId, sessionId, userText: message, attachmentIds });
    } catch (e) {
      if (e instanceof ChatTurnError)
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      throw e;
    }
  }

  const contextSessionId = isContinue ? sessionId : turn?.sessionId;
  const attachments =
    wsId && contextSessionId ? await loadSessionAttachments(wsId, contextSessionId) : [];

  // Continue bisa memakai gambar lama; cek juga di sini.
  if (attachments.some((a) => a.kind === "image") && !supportsVision(route))
    return NextResponse.json(
      {
        error: {
          code: "VISION_UNSUPPORTED",
          message: L("Model ini belum mendukung gambar. Pilih model Gemini atau model vision lain.", "This model does not support images yet. Choose Gemini or another vision model."),
        },
      },
      { status: 400 },
    );

  const { documentPrompt, images } = buildChatContext(
    attachments,
    isContinue ? (lastAssistant?.content ?? "") : message,
    route.family,
  );
  const system = (lang === "en" ? SYSTEM_EN : SYSTEM_ID) + documentPrompt;
  // ponytail: prompt (system + dokumen + history + pesan) ikut ditagih per 1k token,
  // jadi kirim panjang ~2x lebih mahal — sesuai perilaku provider.
  const inputChars =
    system.length +
    providerMessage.length +
    historyForApi.reduce((n, h) => n + String(h.content ?? "").length, 0);

  const encoder = new TextEncoder();
  let usageId: string | undefined;
  let sessionIdFinal = turn?.sessionId ?? sessionId;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // client sudah menutup koneksi (stop); simpan parsial tetap lanjut.
        }
      };

      try {
        // Demo tanpa workspace: tidak ada billing/persistensi.
        if (!wsId) {
          let reply = "";
          let lastUsage: StreamUsage | undefined;
          let finishReason: FinishReason = "stop";
          await streamChat(
            route,
            { system, message: providerMessage, history: historyForApi, images },
            (text, done, usage, providerFinish) => {
              if (done) {
                lastUsage = usage;
                if (providerFinish === "length" || providerFinish === "MAX_TOKENS") finishReason = "length";
                return;
              }
              reply += text;
              enqueue({ text });
            },
            req.signal,
          );
          enqueue({
            done: true,
            totalTokens: lastUsage?.totalTokens ?? 0,
            finishReason,
            sessionId: sessionIdFinal,
          });
          return;
        }

        const costPer1k = (await modelCost("chat", model)) ?? chatCost(model);
        const result = await withTokensStream(
          wsId,
          costPer1k,
          async (onChunk, signal) => {
            await streamChat(
              route,
              { system, message: providerMessage, history: historyForApi, images },
              (text, done, usage, providerFinish) => {
                if (done) {
                  onChunk("", true, usage, providerFinish);
                } else {
                  onChunk(text, false);
                  enqueue({ text });
                }
              },
              signal,
            );
          },
          { modelId: model, endpointType: "chat", onUsageLogged: (id) => { usageId = id; } },
          req.signal,
          inputChars,
        );

        const finishReason = normalizeFinish(result.finishReason);
        const assistantMessageId = await finishAssistantTurn({
          workspaceId: wsId,
          sessionId: sessionIdFinal || sessionId,
          reply: result.reply || (finishReason === "aborted" ? "Dihentikan." : ""),
          usageId,
          finishReason,
          appendToMessageId,
        });

        enqueue({
          done: true,
          totalTokens: result.totalTokens,
          finishReason,
          sessionId: sessionIdFinal,
          assistantMessageId,
        });
      } catch (e) {
        if (e instanceof InsufficientTokensError) {
          const insufficientMsg = L(insufficientMessage(e, "id"), insufficientMessage(e, "en"));
          enqueue({
            error: {
              code: e.expired ? "WORKSPACE_EXPIRED" : "INSUFFICIENT_TOKENS",
              message: insufficientMsg,
            },
            gatekeeper: {
              decision: "BLOCK",
              service: "chat",
              category: "credit",
              risk_level: "low",
              reason: e.expired ? "Masa aktif workspace sudah lewat." : "Saldo workspace tidak mencukupi biaya permintaan.",
              user_message: insufficientMsg,
            },
          });
          return;
        }

        // Abort yang lolos dari withTokensStream: jangan simpan apa pun.
        if (req.signal.aborted) return;

        const messageText = e instanceof Error ? e.message : "Streaming error";
        if (wsId && !isContinue && turn) {
          await finishAssistantTurn({
            workspaceId: wsId,
            sessionId: sessionIdFinal || sessionId,
            reply: L(`Maaf, ${messageText}`, `Sorry, ${messageText}`),
            finishReason: "error",
          }).catch(() => undefined);
        }
        enqueue({ error: { code: "PROVIDER_ERROR", message: messageText } });
      } finally {
        try {
          controller.close();
        } catch {
          // sudah ditutup client
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
