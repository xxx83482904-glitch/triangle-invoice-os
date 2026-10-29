import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.getAll("company").includes("CHINA")) {
    if (request.method !== "GET" || pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "中国のデータは中国版で操作してください" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.searchParams.set("company", "JAPAN");
    for (const key of ["account", "transaction", "invoice", "document", "project", "page"]) url.searchParams.delete(key);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
