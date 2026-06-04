import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ocrConfigStatus, updateOcrRuntimeSettings } from "@/lib/ocr-settings";
import { can } from "@/lib/rbac";

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

export async function GET() {
  const user = await requireUser();
  if (!can(user, "manage:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  return NextResponse.json(await ocrConfigStatus());
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "manage:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const body = (await request.json()) as {
    googleCloudVisionApiKey?: unknown;
    openAiApiKey?: unknown;
    ocrAiModel?: unknown;
  };

  await updateOcrRuntimeSettings(user.id, {
    googleCloudVisionApiKey: textValue(body.googleCloudVisionApiKey),
    openAiApiKey: textValue(body.openAiApiKey),
    ocrAiModel: textValue(body.ocrAiModel),
  });

  return NextResponse.json(await ocrConfigStatus());
}
