import { redirect } from "next/navigation";
import { createClient, createSelectOption, createVendor, moveClientOption, moveSelectOption, moveVendorOption } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app/shell";
import { ClientDeleteButton } from "@/components/app/client-delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { can, canEditOptionGroup, companyForUser, defaultPathForRole } from "@/lib/rbac";
import { managedOptionGroups, optionGroupLabels, selectOptionsFor } from "@/lib/select-options";
import { readDataForRequest as readData } from "@/lib/store";
import type { SelectOptionGroup } from "@/lib/types";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:partners")) redirect(defaultPathForRole(user.role));
  const company = companyForUser(user, params.company);
  const billingOnly = user.role === "BILLING_EDITOR";
  const data = await readData();
  const mayEdit = Boolean(user && can(user, "manage:clients"));
  const clients = data.clients
    .filter((client) => !client.deletedAt && partnerMatchesCompany(client, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const vendors = data.vendors
    .filter((vendor) => !vendor.deletedAt && partnerMatchesCompany(vendor, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));

  return (
    <AppShell>
      <PageHeader title={billingOnly ? "請求先・請求書設定" : "取引先・プルダウン管理"} />
      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">クライアント</TabsTrigger>
          {!billingOnly ? <TabsTrigger value="vendors">支払先</TabsTrigger> : null}
          <TabsTrigger value="options">プルダウン</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader><CardTitle>クライアント</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead className="w-20">順番</TableHead><TableHead>会社名</TableHead><TableHead>担当者</TableHead><TableHead>メール</TableHead><TableHead>登録番号</TableHead>{mayEdit ? <TableHead className="w-12"><span className="sr-only">操作</span></TableHead> : null}</TableRow></TableHeader>
                <TableBody>
                  {clients.map((client, index) => (
                    <TableRow key={client.id}>
                      <TableCell><MoveButtons action={moveClientOption} id={client.id} disabled={!mayEdit} first={index === 0} last={index === clients.length - 1} /></TableCell>
                      <TableCell className="font-medium">{client.companyName}</TableCell>
                      <TableCell>{client.contactName}</TableCell>
                      <TableCell>{client.email}</TableCell>
                      <TableCell>{client.invoiceRegistrationNumber}</TableCell>
                      {mayEdit ? <TableCell><ClientDeleteButton company={company} client={{ id: client.id, companyName: client.companyName, updatedAt: client.updatedAt }} /></TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {mayEdit ? (
            <Card>
              <CardHeader><CardTitle>クライアント追加</CardTitle></CardHeader>
              <CardContent><ClientForm company={company} /></CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {!billingOnly ? <TabsContent value="vendors" className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader><CardTitle>支払先</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead className="w-20">順番</TableHead><TableHead>会社名</TableHead><TableHead>担当者</TableHead><TableHead>メール</TableHead><TableHead>銀行</TableHead></TableRow></TableHeader>
                <TableBody>
                  {vendors.map((vendor, index) => (
                    <TableRow key={vendor.id}>
                      <TableCell><MoveButtons action={moveVendorOption} id={vendor.id} disabled={!mayEdit} first={index === 0} last={index === vendors.length - 1} /></TableCell>
                      <TableCell className="font-medium">{vendor.companyName}</TableCell>
                      <TableCell>{vendor.contactName}</TableCell>
                      <TableCell>{vendor.email}</TableCell>
                      <TableCell>{vendor.bankName} {vendor.branchName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {mayEdit ? (
            <Card>
              <CardHeader><CardTitle>支払先追加</CardTitle></CardHeader>
              <CardContent><VendorForm company={company} /></CardContent>
            </Card>
          ) : null}
        </TabsContent> : null}

        <TabsContent value="options" className="mt-6 space-y-6">
          {managedOptionGroups.filter((group) => !billingOnly || canEditOptionGroup(user, group)).map((group) => (
            <OptionGroupCard key={group} company={company} disabled={!mayEdit} group={group} options={selectOptionsFor(data, group, company)} />
          ))}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function MoveButtons({
  action,
  disabled,
  first,
  id,
  last,
}: {
  action: (formData: FormData) => Promise<void>;
  disabled?: boolean;
  first: boolean;
  id: string;
  last: boolean;
}) {
  return (
    <div className="flex gap-1">
      <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="direction" value="up" /><Button type="submit" size="xs" variant="outline" disabled={disabled || first}>上</Button></form>
      <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="direction" value="down" /><Button type="submit" size="xs" variant="outline" disabled={disabled || last}>下</Button></form>
    </div>
  );
}

function OptionGroupCard({
  company,
  disabled,
  group,
  options,
}: {
  company: CompanyScope;
  disabled: boolean;
  group: SelectOptionGroup;
  options: Array<{ id: string; label: string; value: string }>;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{optionGroupLabels[group]}</CardTitle></CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Table>
          <TableHeader><TableRow><TableHead className="w-20">順番</TableHead><TableHead>表示名</TableHead><TableHead>値</TableHead></TableRow></TableHeader>
          <TableBody>
            {options.map((option, index) => (
              <TableRow key={option.id}>
                <TableCell><MoveButtons action={moveSelectOption} id={option.id} disabled={disabled} first={index === 0} last={index === options.length - 1} /></TableCell>
                <TableCell className="font-medium">{option.label}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{option.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!disabled ? (
          <form action={createSelectOption} className="space-y-3 rounded-md border p-3">
            <input type="hidden" name="company" value={company} />
            <input type="hidden" name="group" value={group} />
            <InputBlock name="label" label="表示名" required />
            <InputBlock name="value" label="値 任意" />
            <Button className="w-full">追加</Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ClientForm({ company }: { company: CompanyScope }) {
  return (
    <form action={createClient} className="space-y-3">
      <input type="hidden" name="company" value={company} />
      <InputBlock name="companyName" label="会社名" required />
      <InputBlock name="contactName" label="担当者名" />
      <InputBlock name="email" label="メールアドレス" type="email" />
      <InputBlock name="phone" label="電話番号" />
      <InputBlock name="address" label="住所" />
      <InputBlock name="invoiceRegistrationNumber" label="登録番号" />
      <div className="space-y-2"><Label>備考</Label><Textarea name="memo" /></div>
      <Button className="w-full">追加</Button>
    </form>
  );
}

function VendorForm({ company }: { company: CompanyScope }) {
  return (
    <form action={createVendor} className="space-y-3">
      <input type="hidden" name="company" value={company} />
      <InputBlock name="companyName" label="会社名" required />
      <InputBlock name="contactName" label="担当者名" />
      <InputBlock name="email" label="メールアドレス" type="email" />
      <InputBlock name="phone" label="電話番号" />
      <InputBlock name="address" label="住所" />
      <InputBlock name="invoiceRegistrationNumber" label="登録番号" />
      <InputBlock name="bankName" label="銀行名" />
      <InputBlock name="branchName" label="支店名" />
      <InputBlock name="accountType" label="口座種別" />
      <InputBlock name="accountNumber" label="口座番号" />
      <InputBlock name="accountHolder" label="口座名義" />
      <div className="space-y-2"><Label>備考</Label><Textarea name="memo" /></div>
      <Button className="w-full">追加</Button>
    </form>
  );
}

function InputBlock({ name, label, type = "text", required }: { name: string; label: string; type?: string; required?: boolean }) {
  return <div className="space-y-2"><Label>{label}</Label><Input name={name} type={type} required={required} /></div>;
}
