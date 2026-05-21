import { NextResponse } from "next/server";
import { readReceivedInvoiceFile } from "@/lib/files";

const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
};

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = await readReceivedInvoiceFile(name);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": mimeByExtension[extension] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
