import { createClient, createVendor } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, partnerMatchesCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { readData } from "@/lib/store";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = readData();
  const mayEdit = user && can(user, "manage:clients");
  const clients = data.clients.filter((client) => !client.deletedAt && partnerMatchesCompany(client, company));
  const vendors = data.vendors.filter((vendor) => !vendor.deletedAt && partnerMatchesCompany(vendor, company));

  return (
    <AppShell>
      <PageHeader title="取引先管理" description="クライアントと支払先の登録番号、連絡先、銀行口座情報を管理します。" />
      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">クライアント</TabsTrigger>
          <TabsTrigger value="vendors">支払先</TabsTrigger>
        </TabsList>
        <TabsContent value="clients" className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader><CardTitle>クライアント</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>会社名</TableHead><TableHead>担当者</TableHead><TableHead>メール</TableHead><TableHead>電話</TableHead><TableHead>住所</TableHead><TableHead>登録番号</TableHead></TableRow></TableHeader>
                <TableBody>{clients.map((client) => <TableRow key={client.id}><TableCell className="font-medium">{client.companyName}</TableCell><TableCell>{client.contactName}</TableCell><TableCell>{client.email}</TableCell><TableCell>{client.phone}</TableCell><TableCell>{client.address}</TableCell><TableCell>{client.invoiceRegistrationNumber}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
          {mayEdit ? (
            <Card>
              <CardHeader><CardTitle>クライアント追加</CardTitle></CardHeader>
              <CardContent><form action={createClient} className="space-y-3"><input type="hidden" name="company" value={company} /><InputBlock name="companyName" label="会社名" required /><InputBlock name="contactName" label="担当者名" /><InputBlock name="email" label="メールアドレス" type="email" /><InputBlock name="phone" label="電話番号" /><InputBlock name="address" label="住所" /><InputBlock name="invoiceRegistrationNumber" label="登録番号" /><div className="space-y-2"><Label>備考</Label><Textarea name="memo" /></div><Button className="w-full">追加</Button></form></CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="vendors" className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader><CardTitle>支払先</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>会社名</TableHead><TableHead>担当者</TableHead><TableHead>メール</TableHead><TableHead>登録番号</TableHead><TableHead>銀行</TableHead><TableHead>口座</TableHead></TableRow></TableHeader>
                <TableBody>{vendors.map((vendor) => <TableRow key={vendor.id}><TableCell className="font-medium">{vendor.companyName}</TableCell><TableCell>{vendor.contactName}</TableCell><TableCell>{vendor.email}</TableCell><TableCell>{vendor.invoiceRegistrationNumber}</TableCell><TableCell>{vendor.bankName} {vendor.branchName}</TableCell><TableCell>{vendor.accountType} {vendor.accountNumber}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
          {mayEdit ? (
            <Card>
              <CardHeader><CardTitle>支払先追加</CardTitle></CardHeader>
              <CardContent><form action={createVendor} className="space-y-3"><input type="hidden" name="company" value={company} /><InputBlock name="companyName" label="会社名" required /><InputBlock name="contactName" label="担当者名" /><InputBlock name="email" label="メールアドレス" type="email" /><InputBlock name="phone" label="電話番号" /><InputBlock name="address" label="住所" /><InputBlock name="invoiceRegistrationNumber" label="登録番号" /><InputBlock name="bankName" label="銀行名" /><InputBlock name="branchName" label="支店名" /><InputBlock name="accountType" label="口座種別" /><InputBlock name="accountNumber" label="口座番号" /><InputBlock name="accountHolder" label="口座名義" /><div className="space-y-2"><Label>備考</Label><Textarea name="memo" /></div><Button className="w-full">追加</Button></form></CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function InputBlock({ name, label, type = "text", required }: { name: string; label: string; type?: string; required?: boolean }) {
  return <div className="space-y-2"><Label>{label}</Label><Input name={name} type={type} required={required} /></div>;
}
