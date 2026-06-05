"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, { error: "" });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">アカウント登録</CardTitle>
        <CardDescription>登録後、権限に応じた画面へ移動します。</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="name">名前</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">パスワード</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">担当種別</Label>
            <select
              id="role"
              name="role"
              defaultValue="PROJECT_MANAGER"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="PROJECT_MANAGER">担当: 案件・発行請求書</option>
              <option value="MAIL_EDITOR">郵便物担当: 郵便仕分けのみ</option>
            </select>
          </div>
          <Button className="w-full" disabled={pending}>
            {pending ? "登録中..." : "登録する"}
          </Button>
        </form>
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link href="/login">ログインへ戻る</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
