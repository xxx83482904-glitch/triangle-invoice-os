import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { mutateData, newId } from "@/lib/store";

const inputSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
}).strict();

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  if (!can(user, "manage:users")) return NextResponse.json({ error: "管理者のみ作成できます" }, { status: 403 });
  const origin = request.headers.get("origin");
  if ((origin && new URL(origin).host !== request.headers.get("host")) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "この接続元からは作成できません" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSONを指定してください" }, { status: 415 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "名前・メールアドレス・8文字以上のパスワードを確認してください" }, { status: 400 });
  const { name, email, password } = parsed.data;
  const passwordHash = await hash(password, 12);
  const id = newId();
  try {
    const result = await mutateData(user.id, "CREATE_INVOICE_STAFF", "User", id, (data) => {
      if (data.users.some((u) => u.email.toLowerCase() === email)) throw new Error("EMAIL_EXISTS");
      const timestamp = new Date().toISOString();
      data.users.push({ id, name, email, passwordHash, role: "BILLING_EDITOR", createdAt: timestamp, updatedAt: timestamp });
      return { id, name, email, role: "BILLING_EDITOR", company: "JAPAN" };
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_EXISTS") return NextResponse.json({ error: "同じメールアドレスが登録済みです。既存アカウントは変更していません" }, { status: 409 });
    return NextResponse.json({ error: "アカウント作成に失敗しました" }, { status: 500 });
  }
}
