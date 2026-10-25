import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { recordVioJobs, startGeminiVideo } from "@/lib/ai-media";
import { resolveRoute } from "@/lib/ai-router";
import { mapAspect, vioFetch, vioUploadAsset } from "@/lib/vio";
import { evaluateAiRequest, gatekeeperAccessResponse, gatekeeperBlockResponse } from "@/lib/gatekeeper";
import { isModelAllowed, modelCost } from "@/lib/model-registry";
import {
  InsufficientTokensError,
  insufficient,
  videoCost,
  withTokens,
  workspaceIdForRequest,
} from "@/lib/billing";

// Vercel: upload referensi + submit job bisa lewat 10 detik default.
export const maxDuration = 60;

const VIDEO_MODELS = ["veo-3.1-lite", "veo-3.1-fast", "veo-3.1-quality"];

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let prompt = "";
    let model = "veo-3.1-lite";
    let aspect_ratio = "16:9";
    let duration = 5;
    let motion = "medium";
    let quality = "720p";
    let fps = 30;
    let mode = "t2v";
    let imageFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      prompt = String(form.get("prompt") ?? "").trim();
      model = String(form.get("model") ?? "veo-3.1-lite").slice(0, 120);
      aspect_ratio = String(form.get("aspect_ratio") ?? "16:9");
      duration = Number(form.get("duration") ?? 5);
      motion = String(form.get("motion") ?? "medium");
      quality = String(form.get("quality") ?? "720p");
      fps = Number(form.get("fps") ?? 30);
      mode = String(form.get("mode") ?? "t2v");
      const img = form.get("image");
      if (img instanceof File && img.size > 0) imageFile = img;
    } else {
      const body = await req.json();
      prompt = String(body.prompt ?? "").trim();
      model = String(body.model ?? "veo-3.1-lite").slice(0, 120);
      aspect_ratio = String(body.aspect_ratio ?? "16:9");
      duration = Number(body.duration ?? 5);
      motion = String(body.motion ?? "medium");
      quality = String(body.quality ?? "720p");
      fps = Number(body.fps ?? 30);
      mode = String(body.mode ?? "t2v");
    }

    if (!prompt)
      return NextResponse.json({ error: { code: "INVALID_PROMPT", message: "Deskripsi tidak boleh kosong." } }, { status: 400 });
    const gate = gatekeeperBlockResponse(evaluateAiRequest(prompt.slice(0, 5000), "video"));
    if (gate) return gate;
    if (mode === "i2v" && !imageFile)
      return NextResponse.json({ error: { code: "INVALID_PROMPT", message: "Image-to-video membutuhkan gambar referensi." } }, { status: 400 });

    const finalModel = model;
    const auth = await requireAuth(req);
    const userId = auth?.user.id ?? null;
    const route = await resolveRoute(finalModel, "video");
    if (!route && !(await isModelAllowed("video", finalModel)) && !VIDEO_MODELS.includes(finalModel))
      return NextResponse.json({ error: { code: "INVALID_MODEL", message: "Model tidak dikenal." } }, { status: 400 });
    if (!route)
      return NextResponse.json(
        { error: { code: "NO_API_KEY", message: "API key provider video belum diisi admin. Hubungi super_admin." } },
        { status: 500 },
      );

    const finalPrompt = String(prompt).slice(0, 5000);
    const aspect = mapAspect("video", aspect_ratio);

    // Calculate cost early so it can be used in run()
    const cost = (await modelCost("video", finalModel)) ?? videoCost(finalModel);

    const run = async () => {
      if (route.family === "vio") {
        const vioBody: Record<string, unknown> = {
          prompt: finalPrompt,
          mode,
          model: finalModel,
          aspect_ratio: aspect,
          count: 1,
          duration,
          motion_bucket_id: motion === "high" ? 127 : motion === "low" ? 1 : 64, // rough mapping
          fps,
        };
        // Vio i2v: unggah gambar jadi aset dulu, kirim asset_id sbg start frame.
        if (mode === "i2v" && imageFile) {
          const assetId = await vioUploadAsset(imageFile, imageFile.name || "reference.png");
          vioBody.start_frame_asset_id = assetId;
        }
        const { status, data } = await vioFetch("/videos/generate", {
          method: "POST",
          body: JSON.stringify(vioBody),
        });
        if (status < 300) await recordVioJobs(userId, "video", finalModel, finalPrompt, data);
        return NextResponse.json(data, { status });
      }
      if (route.family !== "gemini")
        return NextResponse.json(
          { error: { code: "UNSUPPORTED", message: "Provider ini belum mendukung pembuatan video." } },
          { status: 400 },
        );
      // Gemini Veo: only t2v for now; i2v needs different endpoint
      if (mode === "i2v") {
        return NextResponse.json(
          { error: { code: "UNSUPPORTED", message: "Image-to-video belum didukung untuk model Gemini/Veo." } },
          { status: 400 },
        );
      }
      const out = await startGeminiVideo(route, {
        prompt: finalPrompt,
        aspect,
        userId,
        duration,
        motion,
        quality,
        fps,
        tokensUsed: cost,
      });
      if (!out.ok)
        return NextResponse.json({ error: { code: "PROVIDER_ERROR", message: out.message } }, { status: 502 });
      return NextResponse.json({ generation_ids: [out.generationId] });
    };

    const wsId = await workspaceIdForRequest(req);
    if (!wsId) {
      if (process.env.NODE_ENV === "production")
        return gatekeeperAccessResponse("video", "Belum login.");
      return run();
    }
    try {
      return await withTokens(wsId, cost, run, { modelId: finalModel, endpointType: "video" });
    } catch (e) {
      if (e instanceof InsufficientTokensError) return insufficient(e.balance, "video");
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: msg } }, { status: 502 });
  }
}
