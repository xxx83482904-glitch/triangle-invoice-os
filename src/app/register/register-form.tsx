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
        <CardTitle className="text-xl">利用申請</CardTitle>
        <CardDescription>管理者の承認後にログインできます。</CardDescription>
      </CardHeader>
      <CardContent>
        {state.success ? <Alert role="status"><AlertDescription>申請を受け付けました。管理者の承認をお待ちください。</AlertDescription></Alert> : <form action={action} className="space-y-4">
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="name">名前</Label>
            <Input id="name" name="name" autoComplete="name" maxLength={100} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">パスワード</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
          </div>
          <Button className="w-full" disabled={pending}>
            {pending ? "申請中..." : "利用を申請"}
          </Button>
        </form>}
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link href="/login">ログインへ戻る</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
