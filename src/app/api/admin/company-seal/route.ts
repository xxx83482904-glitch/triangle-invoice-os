import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runtimeDataDir } from "@/lib/runtime-paths";
import { loadImage } from "@napi-rs/canvas";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "管理者のみ設定できます" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  let temporary: string | undefined;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 1024 * 1024 || file.size < 24) return NextResponse.json({ error: "1MB以下のPNG画像を選択してください" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) > 2000 || bytes.readUInt32BE(20) > 2000) return NextResponse.json({ error: "2000px以下のPNG画像を選択してください" }, { status: 400 });
    await loadImage(bytes);
    const root = runtimeDataDir(); await mkdir(root, { recursive: true });
    temporary = path.join(root, `company-seal-${randomUUID()}.tmp`);
    await writeFile(temporary, bytes);
    await rename(temporary, path.join(root, "company-seal.png"));
    return NextResponse.json({ success: true, sha256: createHash("sha256").update(bytes).digest("hex") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "印影の保存に失敗しました" }, { status: 400 }); }
  finally { if (temporary) await rm(temporary, { force: true }).catch(() => undefined); }
}
