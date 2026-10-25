import { NextResponse } from "next/server";
import { generateImages, recordVioJobs } from "@/lib/ai-media";
import { requireAuth } from "@/lib/auth";
import { resolveRoute } from "@/lib/ai-router";
import { mapAspect, vioFetch } from "@/lib/vio";
import { evaluateAiRequest, gatekeeperAccessResponse, gatekeeperBlockResponse } from "@/lib/gatekeeper";
import { isModelAllowed, modelCost } from "@/lib/model-registry";
import {
  imageCost,
  InsufficientTokensError,
  insufficient,
  withTokens,
  workspaceIdForRequest,
} from "@/lib/billing";

// Vercel: generate bisa lewat 10 detik default.
export const maxDuration = 60;

const IMAGE_MODELS = ["nano-banana-2", "nano-banana-pro", "qwen-image"];

export async function POST(req: Request) {
  try {
    const { prompt, model, aspect_ratio, count } = await req.json();
    if (!prompt || String(prompt).trim().length === 0)
      return NextResponse.json({ error: { code: "INVALID_PROMPT", message: "Deskripsi tidak boleh kosong." } }, { status: 400 });
    const gate = gatekeeperBlockResponse(evaluateAiRequest(String(prompt).slice(0, 5000), "image"));
    if (gate) return gate;
    const finalModel = String(model ?? "nano-banana-2").slice(0, 120);
    const route = await resolveRoute(finalModel, "image");
    if (!route && !(await isModelAllowed("image", finalModel)) && !IMAGE_MODELS.includes(finalModel))
      return NextResponse.json({ error: { code: "INVALID_MODEL", message: "Model tidak dikenal." } }, { status: 400 });
    if (!route)
      return NextResponse.json(
        { error: { code: "NO_API_KEY", message: "API key provider gambar belum diisi admin. Hubungi super_admin." } },
        { status: 500 },
      );

    const finalCount = Math.min(2, Math.max(1, Number(count) || 1));
    const aspect = mapAspect("image", aspect_ratio ?? "1:1");
    const finalPrompt = String(prompt).slice(0, 5000);
    const userId = (await requireAuth(req))?.user.id ?? null;

    const run = async () => {
      if (route.family === "vio") {
        const { status, data } = await vioFetch("/images/generate", {
          method: "POST",
          body: JSON.stringify({ prompt: finalPrompt, model: finalModel, aspect_ratio: aspect, count: finalCount }),
        });
        if (status < 300) await recordVioJobs(userId, "image", finalModel, finalPrompt, data);
        return NextResponse.json(data, { status });
      }
      const out = await generateImages(route, { prompt: finalPrompt, aspect, count: finalCount });
      if (!out.ok)
        return NextResponse.json({ error: { code: "PROVIDER_ERROR", message: out.message } }, { status: 502 });
      return NextResponse.json({
        status: "completed",
        asset_url: out.urls[0],
        asset_urls: out.urls,
      });
    };

    const wsId = await workspaceIdForRequest(req);
    if (!wsId) {
      if (process.env.NODE_ENV === "production")
        return gatekeeperAccessResponse("image", "Belum login.");
      return run();
    }
    try {
      const cost = (await modelCost("image", finalModel)) ?? imageCost(finalModel);
      return await withTokens(wsId, cost, run, {
        modelId: finalModel,
        endpointType: "image",
        units: finalCount,
      });
    } catch (e) {
      if (e instanceof InsufficientTokensError) return insufficient(e.balance, "image");
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: msg } }, { status: 502 });
  }
}
