import { serveDocumentFile } from "@/lib/document-files";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  return serveDocumentFile((await params).name);
}
