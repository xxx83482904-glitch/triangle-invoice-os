"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: "" });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">TRIANGLE Invoice OS</CardTitle>
        <CardDescription>社内の請求・入金・支払い状況を案件単位で確認します。</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" name="email" type="email" defaultValue="admin@triangle.local" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">パスワード</Label>
            <Input id="password" name="password" type="password" defaultValue="password123" required />
          </div>
          <Button className="w-full" disabled={pending}>
            {pending ? "ログイン中..." : "ログイン"}
          </Button>
        </form>
        <div className="mt-5 rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
          デモ: admin@triangle.local / accounting@triangle.local / pm@triangle.local / designer@triangle.local
          <br />
          共通パスワード: password123
        </div>
      </CardContent>
    </Card>
  );
}
