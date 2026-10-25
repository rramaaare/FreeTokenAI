import { NextResponse } from "next/server";
import { permissionDenied } from "@/lib/permissions";
import { chatComplete, resolveRoute } from "@/lib/ai-router";
import { InsufficientKeyQuotaError, InsufficientTokensError, insufficient, validateApiKey, withKeyTokens, withTokens } from "@/lib/billing";
import { defaultModel, listModels } from "@/lib/model-registry";
import { rateLimited } from "@/lib/rate-limit";
import { evaluateAiRequest, gatekeeperAccessResponse, gatekeeperBlockResponse } from "@/lib/gatekeeper";

// ponytail: gateway publik (PRD 7.3: POST /v1/chat/completions, key rst_live_*).
// Format-valid -> hash SHA-256 ke api_keys DB -> rate-limit Redis 60/mnt by
// api_key_id (PRD §5.2 `rl:{api_key_id}:{minute}`, raw secret tak pernah ke Redis) ->
// deduct atomik + usage-extend (402 bila kurang) -> provider model agent -> refund bila vendor gagal.
// Bentuk request/response ikut OpenAI agar AI agent langsung bisa pakai.

// Model yang boleh dipanggil = model berceklis "Agent (API)" di /admin/models.
// Alias lama tetap diterima supaya integrasi pelanggan yang sudah jalan tidak putus.
const LEGACY_ALIAS: Record<string, string> = {
  "freetokenai-chat-fast": "openai/gpt-oss-20b",
  "freetokenai-chat-pro": "openai/gpt-oss-120b",
};

type Msg = { role?: unknown; content?: unknown };

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(rst_live_[A-Za-z0-9]{10,})$/u.exec(auth.trim());
  if (!m)
    return gatekeeperAccessResponse(
      "developer_api",
      "API key tidak valid. Generate di halaman Developer API (/dashboard/developer) lalu pakai: Authorization: Bearer rst_live_... Model: freetokenai-chat-fast / freetokenai-chat-pro.",
    );
  const apiKey = m[1];
  const valid = await validateApiKey(apiKey);
  if (!valid)
    return gatekeeperAccessResponse("developer_api", "API key tidak dikenal / nonaktif.");
  const denied = await permissionDenied("customer", "ai.developer");
  if (denied) return denied;
  // ponytail: rate-limit SETELAH lookup, kunci = api_key_id (uuid aman log).
  if (await rateLimited(`gw:${valid.id}`))
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Maks 60 request/menit per API Key." } },
      { status: 429 },
    );

  let body: { model?: unknown; messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_PROMPT", message: "Body bukan JSON." } },
      { status: 400 },
    );
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((x) => x.role === "user");
  const message = String(lastUser?.content ?? "").trim().slice(0, 8000);
  if (!message)
    return NextResponse.json(
      { error: { code: "INVALID_PROMPT", message: "messages harus berisi pesan user." } },
      { status: 400 },
    );
  const gateInput = messages
    .slice(-20)
    .map((item) => String(item.content ?? "").slice(0, 8000))
    .join("\n");
  const gate = gatekeeperBlockResponse(evaluateAiRequest(gateInput, "developer_api"));
  if (gate) return gate;
  const requested = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const agentModels = await listModels("agent");
  const target = requested ? (LEGACY_ALIAS[requested] ?? requested) : await defaultModel("agent");
  const model = agentModels.find((x) => x.model_id === target);
  if (!model)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_MODEL",
          message: agentModels.length
            ? `Model tidak tersedia untuk API. Pakai salah satu: ${agentModels.map((x) => x.model_id).join(", ")}.`
            : "Belum ada model yang diaktifkan untuk Developer API.",
        },
      },
      { status: 400 },
    );

  const route = await resolveRoute(model.model_id, "agent");
  if (!route)
    return NextResponse.json(
      { error: { code: "NO_API_KEY", message: "API key provider model ini belum diisi (menu Provider & Model AI di /admin)." } },
      { status: 500 },
    );
  const modelId = requested ?? model.model_id;
  const cost = model.cost;
  const callProvider = async () => {
    const out = await chatComplete(route, {
      system: "Jawab dalam Bahasa Indonesia yang ringkas dan membantu.",
      message,
      history: messages.slice(0, -1),
    });
    if (!out.ok)
      return NextResponse.json(
        { error: { code: "PROVIDER_ERROR", message: out.message } },
        { status: out.status },
      );
    const reply = out.reply;
    // ponytail: bentuk OpenAI — agent tak perlu adaptor khusus.
    return NextResponse.json({
      id: `chatcmpl-dev-${Date.now()}`,
      object: "chat.completion",
      model: modelId,
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
    });
  };
  const meta = { apiKeyId: valid.id, modelId, endpointType: "chat" as const };
  try {
    // Key lama terikat workspace -> potong saldo workspace.
    if (valid.workspace_id) return await withTokens(valid.workspace_id, cost, callProvider, meta);
    // Key terbitan kasir (tanpa workspace) -> potong kuota key (sudah reserve dari cafe).
    if (valid.cafe_id) return await withKeyTokens(valid.id, valid.cafe_id, cost, callProvider, meta);
    return gatekeeperAccessResponse(
      "developer_api",
      "API key tidak terhubung ke workspace/cafe. Terbitkan key baru dari kasir.",
    );
  } catch (e) {
    if (e instanceof InsufficientTokensError) return insufficient(e, "developer_api");
    if (e instanceof InsufficientKeyQuotaError) return insufficient(e.remaining, "developer_api");
    throw e;
  }
}
