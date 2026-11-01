// Keep useful server validation/conflict messages; never render an opaque object as text.
export function operationErrorMessage(error: unknown, fallback = "結果を確認できませんでした。入力内容を保持しています。通信状況を確認してください。") {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message
    : error && typeof error === "object" && "error" in error && typeof error.error === "string" ? error.error : "";
  return message.trim() || fallback;
}

export function operationFailureToast(error: unknown, fallback?: string) {
  return { title: "操作に失敗しました", description: operationErrorMessage(error, fallback), variant: "destructive" as const };
}

export function bankSaveFailureMessage(error: unknown, saved: number, uncertain: boolean) {
  return `${saved}件保存済み。${operationErrorMessage(error, "通信に失敗しました")}。${uncertain ? "応答のないバッチは結果未確認です。再保存前に最新状態を確認してください。" : ""}残りの変更・選択は保持されています`;
}

export function unconfirmedUploadFiles<T extends { name: string }>(files: T[], results: Array<{ fileName: string; error?: string }>) {
  // Retain the actual File objects for an explicit retry. Ambiguous/missing responses are not successes.
  return files.filter((file) => {
    const matches = results.filter((result) => result.fileName === file.name);
    return matches.length < files.filter((item) => item.name === file.name).length || matches.some((result) => Boolean(result.error));
  });
}

export function uploadFeedback(results: Array<{ error?: string }>, unconfirmed: number) {
  const failed = results.filter((row) => row.error).length, saved = results.length - failed;
  return { title: `${saved}件取込${failed ? `、${failed}件エラー` : unconfirmed ? "・結果の確認が必要です" : ""}`,
    description: unconfirmed ? `選択${unconfirmed}件を保持しています。登録済みの内容を確認してから再試行してください。` : undefined,
    variant: failed || unconfirmed ? "destructive" as const : "success" as const };
}

// An authentication/error page after a followed redirect is not a successful registration.
export function receivedUploadRedirect(response: Pick<Response, "ok" | "redirected" | "url">, origin: string) {
  if (!response.ok || !response.redirected) return undefined;
  try {
    const url = new URL(response.url);
    return url.origin === origin && url.pathname === "/received-invoices" && url.searchParams.get("company") === "JAPAN" && url.searchParams.get("uploaded") === "1"
      ? `${url.pathname}${url.search}` : undefined;
  } catch { return undefined; }
}
