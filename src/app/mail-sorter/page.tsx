import Link from "next/link";
import { MailSorterDropzone } from "@/app/mail-sorter/mail-sorter-dropzone";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac";
import { readData } from "@/lib/store";
import type { MailDocumentCategory } from "@/lib/types";

const categoryLabels: Record<MailDocumentCategory, string> = {
  INVOICE: "請求書",
  CONTRACT: "契約書",
  ESTIMATE: "見積書",
  DELIVERY_NOTE: "納品書",
  RECEIPT: "領収書",
  NOTICE: "通知",
  OTHER: "その他",
};

export default async function MailSorterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = await readData();
  const mayUpload = user && (can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices"));
  const documents = data.mailDocuments
    .filter((document) => !document.deletedAt && companyFromParam(document.company) === company)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <AppShell>
      <PageHeader
        title="郵便物仕分け"
        description="郵便物をまとめてアップロードし、請求書は受領請求書へ、その他の書類はその他書類として保存します。"
      >
        <Button asChild variant="outline">
          <Link href={`/received-invoices?company=${company}`}>受領請求書を見る</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          {mayUpload ? <MailSorterDropzone company={company} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>仕分けルール</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>請求書キーワードと金額がある書類は受領請求書として登録します。</div>
              <div>契約書・見積書・納品書・領収書・通知は書類種別を付けて保管します。</div>
              <div>判定できない郵便物は「その他」に入り、後から確認できます。</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>仕分け済み郵便物</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>受領日</TableHead>
                  <TableHead>分類</TableHead>
                  <TableHead>ファイル名</TableHead>
                  <TableHead>保存先</TableHead>
                  <TableHead>判定</TableHead>
                  <TableHead>ファイル</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(document.createdAt.slice(0, 10))}</TableCell>
                    <TableCell>
                      <Badge variant={document.category === "INVOICE" ? "default" : "secondary"}>
                        {categoryLabels[document.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate font-medium">{document.originalFileName}</TableCell>
                    <TableCell>
                      {document.relatedReceivedInvoiceId ? (
                        <Link className="text-sm underline" href={`/received-invoices?company=${company}`}>
                          受領請求書
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">その他書類</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {document.confidence ? `信頼度 ${document.confidence}%` : "-"}
                    </TableCell>
                    <TableCell>
                      <a className="text-sm underline" href={document.fileUrl} target="_blank">
                        表示
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
                {!documents.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      まだ仕分け済みの郵便物はありません。
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
