import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { documentRows, visibleProjects } from "@/lib/documents";
import { contentDispositionFileName, readUploadedFile, uploadedFileNameFromUrl } from "@/lib/files";
import { readData } from "@/lib/store";

export async function serveDocumentFile(name: string) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!name || /[\\/\x00]/.test(name) || name === "." || name === "..") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await readData();
  const matches = (url?: string) => Boolean(url && uploadedFileNameFromUrl(url) === name);
  const rows = [...documentRows(data, user, "JAPAN"), ...documentRows(data, user, "CHINA")];
  const projects = new Set(visibleProjects(data, user).map((p) => p.id));
  const designerUpload = user.role === "DESIGNER" && data.receivedInvoices.some((i) => !i.deletedAt && projects.has(i.projectId) && matches(i.fileUrl));
  const guestInvoice = user.role === "GUEST" && data.issuedInvoices.some((i) => !i.deletedAt && i.createdById === user.id && (matches(i.fileUrl) || matches(i.pdfUrl)));
  if (!rows.some((r) => matches(r.fileUrl)) && !designerUpload && !guestInvoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = await readUploadedFile(name);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), { headers: {
    "Content-Type": file.mimeType,
    "Content-Disposition": contentDispositionFileName(name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
