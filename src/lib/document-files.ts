import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canViewDocumentFile } from "@/lib/document-file-access";
import { contentDispositionFileName, readUploadedFile } from "@/lib/files";
import { readData } from "@/lib/store";

export async function serveDocumentFile(name: string) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await readData();
  if (!canViewDocumentFile(data, user, name)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = await readUploadedFile(name);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), { headers: {
    "Content-Type": file.mimeType,
    "Content-Disposition": contentDispositionFileName(name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
