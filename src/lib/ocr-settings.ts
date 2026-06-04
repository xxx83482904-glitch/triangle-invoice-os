import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeDataDir } from "@/lib/runtime-paths";

export type OcrRuntimeSettings = {
  googleCloudVisionApiKey?: string;
  openAiApiKey?: string;
  ocrAiModel?: string;
  updatedAt?: string;
  updatedById?: string;
};

export type EffectiveOcrConfig = {
  googleVisionApiKey: string;
  googleVisionSource: "env" | "settings" | "none";
  openAiApiKey: string;
  openAiSource: "env" | "settings" | "none";
  ocrAiModel: string;
  ocrAiModelSource: "env" | "settings" | "default";
};

const SETTINGS_FILE = path.join(runtimeDataDir(), "ocr-settings.json");

function cleanSecret(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanModel(value: unknown) {
  const model = typeof value === "string" ? value.trim() : "";
  return model || "gpt-5.4-mini";
}

export async function readOcrRuntimeSettings(): Promise<OcrRuntimeSettings> {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as OcrRuntimeSettings;
  } catch {
    return {};
  }
}

export async function writeOcrRuntimeSettings(settings: OcrRuntimeSettings) {
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export async function updateOcrRuntimeSettings(
  userId: string,
  next: Pick<OcrRuntimeSettings, "googleCloudVisionApiKey" | "openAiApiKey" | "ocrAiModel">,
) {
  const current = await readOcrRuntimeSettings();
  const settings: OcrRuntimeSettings = {
    ...current,
    updatedAt: new Date().toISOString(),
    updatedById: userId,
  };

  if (typeof next.googleCloudVisionApiKey === "string") {
    settings.googleCloudVisionApiKey = cleanSecret(next.googleCloudVisionApiKey);
  }
  if (typeof next.openAiApiKey === "string") {
    settings.openAiApiKey = cleanSecret(next.openAiApiKey);
  }
  if (typeof next.ocrAiModel === "string") {
    settings.ocrAiModel = cleanModel(next.ocrAiModel);
  }

  await writeOcrRuntimeSettings(settings);
  return settings;
}

export async function effectiveOcrConfig(): Promise<EffectiveOcrConfig> {
  const settings = await readOcrRuntimeSettings();
  const envGoogle = cleanSecret(process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY);
  const settingsGoogle = cleanSecret(settings.googleCloudVisionApiKey);
  const envOpenAi = cleanSecret(process.env.OPENAI_API_KEY);
  const settingsOpenAi = cleanSecret(settings.openAiApiKey);
  const envModel = cleanSecret(process.env.OCR_AI_MODEL);
  const settingsModel = cleanSecret(settings.ocrAiModel);

  return {
    googleVisionApiKey: envGoogle || settingsGoogle,
    googleVisionSource: envGoogle ? "env" : settingsGoogle ? "settings" : "none",
    openAiApiKey: envOpenAi || settingsOpenAi,
    openAiSource: envOpenAi ? "env" : settingsOpenAi ? "settings" : "none",
    ocrAiModel: envModel || settingsModel || "gpt-5.4-mini",
    ocrAiModelSource: envModel ? "env" : settingsModel ? "settings" : "default",
  };
}

export async function ocrConfigStatus() {
  const settings = await readOcrRuntimeSettings();
  const config = await effectiveOcrConfig();
  return {
    googleVisionConfigured: Boolean(config.googleVisionApiKey),
    googleVisionSource: config.googleVisionSource,
    openAiConfigured: Boolean(config.openAiApiKey),
    openAiSource: config.openAiSource,
    ocrAiModel: config.ocrAiModel,
    ocrAiModelSource: config.ocrAiModelSource,
    updatedAt: settings.updatedAt ?? null,
  };
}
