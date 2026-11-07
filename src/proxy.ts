import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

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
  const response = NextResponse.next();
  // Slide the session forward on each page load so a signed-in phone stays signed in.
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (session && request.method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    response.cookies.set(SESSION_COOKIE_NAME, session, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_COOKIE_MAX_AGE,
      secure: process.env.SESSION_COOKIE_SECURE === "true" || process.env.SESSION_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production" });
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
