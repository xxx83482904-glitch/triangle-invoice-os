"use client";
import { useListSelection } from "@/hooks/use-list-selection";
import { RowSelectionCheckbox, SelectAllCheckbox, SelectionToolbar } from "@/components/app/list-selection";
import { isSelectionControl } from "@/lib/list-selection";

import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Image as ImageIcon, Save } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { updateReceivedInvoiceInline, updateReceivedInvoiceStatus } from "@/app/actions";
import { saveReceivedInvoice } from "./actions";
import { OriginalDocumentPreview } from "./original-document-preview";
import { PaymentRecordsPanel } from "./payment-records-panel";
import { DebtGroupPanel } from "./debt-group-panel";
import { debtRoles, type DebtGroupView } from "@/lib/debt-groups";
import { ReceivedAmountFields } from "./received-amount-fields";
import type { PaymentRecordView } from "@/lib/payment-records";
import { receivedInvoiceEvidence, receivedInvoiceWarnings, type ReceivedInvoiceAmounts } from "@/lib/received-invoice-review";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyScope } from "@/lib/company";
import { formatDate, yen } from "@/lib/format";
import type { ReceivedInvoiceStatus } from "@/lib/types";

type Option = {
  label: string;
  value: string;
};

export type ReceivedInvoiceWorkspaceItem = ReceivedInvoiceAmounts & {
  createdAt: string;
  updatedAt: string;
  debt: DebtGroupView;
  mailProcessed: boolean;
  bankReconciledAmount: number;
  dueDate: string;
  fileUrl?: string;
  folderMonth?: string;
  id: string;
  issueDate: string;
  memo?: string;
  mimeType?: string;
  ocrText?: string;
  originalFileName?: string;
  paidAmount: number;
  payments: PaymentRecordView[];
  projectId: string;
  projectName: string;
  status: ReceivedInvoiceStatus;
  statusMismatch: boolean;
  subtotal: number;
  taxTotal: number;
  total: number;
  unpaidAmount: number;
  vendorId: string;
  vendorName: string;
};

type WorkFilter = "all" | "unpaid" | "overdue" | "dueSoon" | "review" | "scheduled" | "paid";

const filterLabels: Record<WorkFilter, string> = {
  all: "すべて",
  dueSoon: "期限近い",
  overdue: "期限超過",
  paid: "支払済み",
  review: "確認待ち",
  scheduled: "支払予定",
  unpaid: "未払い",
};

const reviewStatuses = new Set<ReceivedInvoiceStatus>(["OCR_PENDING", "REVIEWING", "APPROVAL_PENDING", "REJECTED", "ON_HOLD"]);

function monthKey(row: ReceivedInvoiceWorkspaceItem) {
  if (row.folderMonth) return row.folderMonth;
  return row.issueDate ? row.issueDate.slice(0, 7) : "0000-00";
}

function monthLabel(key: string) {
  if (!key || key === "0000-00") return "日付なし";
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

function isOverdue(row: ReceivedInvoiceWorkspaceItem, today: string) {
  return row.unpaidAmount > 0 && Boolean(row.dueDate) && row.dueDate < today;
}

function isDueSoon(row: ReceivedInvoiceWorkspaceItem, today: string) {
  if (row.unpaidAmount <= 0 || row.dueDate < today) return false;
  const due = new Date(`${row.dueDate}T00:00:00`).getTime();
  const now = new Date(`${today}T00:00:00`).getTime();
  return due - now <= 1000 * 60 * 60 * 24 * 7;
}

function paymentTone(row: ReceivedInvoiceWorkspaceItem, today: string) {
  if (row.unpaidAmount <= 0 || row.status === "PAID") return "border-l-emerald-500";
  if (isOverdue(row, today)) return "border-l-red-500";
  if (isDueSoon(row, today)) return "border-l-amber-500";
  return "border-l-sky-500";
}

function invoiceMatchesFilter(row: ReceivedInvoiceWorkspaceItem, filter: WorkFilter, today: string) {
  if (filter === "all") return true;
  if (filter === "unpaid") return row.unpaidAmount > 0;
  if (filter === "overdue") return isOverdue(row, today);
  if (filter === "dueSoon") return isDueSoon(row, today);
  if (filter === "review") return reviewStatuses.has(row.status);
  if (filter === "scheduled") return row.status === "SCHEDULED";
  if (filter === "paid") return row.unpaidAmount <= 0 || row.status === "PAID";
  return true;
}

function SelectField({
  defaultValue,
  disabled,
  disabledValues = [],
  name,
  options,
}: {
  defaultValue: string;
  disabled?: boolean;
  disabledValues?: string[];
  name: string;
  options: Option[];
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      disabled={disabled}
      className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={disabledValues.includes(option.value) && option.value !== defaultValue}>{option.label}</option>
      ))}
    </select>
  );
}

const paidGuardMessage = "支払済みにするには支払記録の登録か銀行照合が必要です。状態の変更だけでは支払記録は作られません。「支払記録」から登録してください。";

export function ReceivedInvoicesWorkspace({
  initialId,
  showTotals = true,
  canApprove,
  canEdit,
  canRecordPayments,
  company,
  invoices,
  projects,
  statusOptions,
  vendors,
}: {
  initialId?: string;
  showTotals?: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canRecordPayments: boolean;
  company: CompanyScope;
  invoices: ReceivedInvoiceWorkspaceItem[];
  projects: Option[];
  statusOptions: Option[];
  vendors: Option[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [activeId, setActiveId] = useState(initialId ?? invoices[0]?.id ?? "");
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<WorkFilter>(initialId ? "all" : "unpaid");
  const [query, setQuery] = useState("");
  const [saving, startSaving] = useTransition();
  const [saveResult, setSaveResult] = useState<{ id: string; message: string; error?: boolean }>();

  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (!invoiceMatchesFilter(invoice, filter, today)) return false;
      if (!needle) return true;
      return [invoice.vendorName, invoice.projectName, invoice.originalFileName, invoice.memo, invoice.ocrText]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [filter, invoices, query, today]);

  const activeInvoice = filteredInvoices.find((invoice) => invoice.id === activeId) ?? filteredInvoices[0] ?? null;

  const monthGroups = useMemo(() => {
    const grouped = new Map<string, ReceivedInvoiceWorkspaceItem[]>();
    for (const invoice of filteredInvoices) {
      const key = monthKey(invoice);
      grouped.set(key, [...(grouped.get(key) ?? []), invoice]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredInvoices]);

  const totals = useMemo(() => {
    return filteredInvoices.reduce(
      (sum, invoice) => ({
        paid: sum.paid + invoice.paidAmount,
        total: sum.total + invoice.total,
        unpaid: sum.unpaid + invoice.unpaidAmount,
      }),
      { paid: 0, total: 0, unpaid: 0 },
    );
  }, [filteredInvoices]);

  const selection = useListSelection(monthGroups.flatMap(([month, list]) => collapsedMonths.has(month) ? [] : list.map((row) => row.id)), { availableIds: invoices.map((row) => row.id) });

  const counts = useMemo(() => {
    return {
      all: invoices.length,
      dueSoon: invoices.filter((invoice) => isDueSoon(invoice, today)).length,
      overdue: invoices.filter((invoice) => isOverdue(invoice, today)).length,
      paid: invoices.filter((invoice) => invoice.unpaidAmount <= 0 || invoice.status === "PAID").length,
      review: invoices.filter((invoice) => reviewStatuses.has(invoice.status)).length,
      scheduled: invoices.filter((invoice) => invoice.status === "SCHEDULED").length,
      unpaid: invoices.filter((invoice) => invoice.unpaidAmount > 0).length,
    };
  }, [invoices, today]);

  const toggleMonth = (month: string) => {
    setCollapsedMonths((current) => {
      const next = new Set(current);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  return (
    <Card variant="section">
      <CardHeader className="gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>受領請求書一覧</CardTitle>
        </div>
        {showTotals ? <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground lg:min-w-[420px]">
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div>合計</div>
            <div className="break-all font-mono text-sm font-semibold text-foreground">{yen.format(totals.total)}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div>支払済</div>
            <div className="break-all font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-300">{yen.format(totals.paid)}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div>未払い</div>
            <div className="break-all font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">{yen.format(Math.max(0, totals.unpaid))}</div>
          </div>
        </div> : null}
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
          {(Object.keys(filterLabels) as WorkFilter[]).map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={filter === item ? "default" : "outline"}
              onClick={() => setFilter(item)}
            >
              {filterLabels[item]}
              <span className="ml-1 text-xs opacity-70">{counts[item]}</span>
            </Button>
          ))}
          <Input
            value={query}
            placeholder="支払先・案件・OCRを検索"
            className="h-9 min-w-56 flex-1 md:max-w-80"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <SelectionToolbar selection={selection} />
        {filteredInvoices.length ? (
          <div className="grid min-h-[720px] overflow-hidden border">
            <div className="max-h-[420px] min-w-0 overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-11 p-0"><SelectAllCheckbox selection={selection} label="表示中の受領請求書をすべて選択" /></th>
                    <th className="px-3 py-2 text-left">請求元</th>
                    <th className="px-3 py-2 text-left">案件</th>
                    <th className="px-3 py-2 text-left">請求日</th>
                    <th className="px-3 py-2 text-left">支払期限</th>
                    <th className="px-3 py-2 text-right">差引支払額</th>
                    <th className="px-3 py-2 text-right">未払い</th>
                    <th className="px-3 py-2 text-left">状態</th>
                    <th className="px-3 py-2 text-left">ファイル</th>
                  </tr>
                </thead>
                {monthGroups.map(([month, monthInvoices]) => {
                    const collapsed = collapsedMonths.has(month);
                    const monthTotal = monthInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
                    const monthUnpaid = monthInvoices.reduce((sum, invoice) => sum + invoice.unpaidAmount, 0);
                    return (
                      <tbody key={month}>
                        <tr className="border-t bg-muted/30">
                          <td colSpan={9} className="px-3 py-2">
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 text-left"
                              onClick={() => toggleMonth(month)}
                            >
                              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                <span>{monthLabel(month)}</span>
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {monthInvoices.length}件{showTotals ? ` / ${yen.format(monthTotal)} / 未払い ${yen.format(Math.max(0, monthUnpaid))}` : ""}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {collapsed ? null : monthInvoices.map((invoice) => {
                          const active = activeInvoice?.id === invoice.id;
                          return (
                            <tr
                              key={invoice.id}
                              {...selection.rowProps(invoice.id)}
                              className={`cursor-pointer border-t border-l-2 transition hover:bg-muted/40 ${paymentTone(invoice, today)} ${selection.selected.has(invoice.id) ? "bg-primary/10" : active ? "bg-primary/5" : ""}`}
                              onClick={(event) => { if (!isSelectionControl(event.target, event.currentTarget)) setActiveId(invoice.id); }}
                            >
                              <td className="p-0"><RowSelectionCheckbox selection={selection} id={invoice.id} label={`${invoice.vendorName} ${invoice.issueDate}を選択`} /></td>
                              <td className="max-w-[220px] truncate px-3 py-2 font-medium">{invoice.vendorName}</td>
                              <td className="max-w-[220px] truncate px-3 py-2">
                                <Link href={`/projects/${invoice.projectId}?company=${company}`} prefetch={false} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                                  {invoice.projectName}
                                </Link>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2">{formatDate(invoice.issueDate)}</td>
                              <td className="whitespace-nowrap px-3 py-2">
                                <span className={isOverdue(invoice, today) ? "font-medium text-red-700" : isDueSoon(invoice, today) ? "font-medium text-amber-700" : ""}>
                                  {formatDate(invoice.dueDate)}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{yen.format(invoice.total)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{invoice.debt.payable ? yen.format(Math.max(0, invoice.unpaidAmount)) : <span className="font-sans text-xs text-muted-foreground" title="債務グループの支払対象外">対象外</span>}</td>
                              <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                {canApprove ? (
                                  <form action={updateReceivedInvoiceStatus}>
                                    <input type="hidden" name="receivedInvoiceId" value={invoice.id} />
                                    <select
                                      name="status"
                                      defaultValue={invoice.status}
                                      className="h-7 max-w-[140px] rounded-full border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                      onChange={(event) => {
                                        // A status change never creates a payment; paid is reached through payment records or bank reconciliation.
                                        if (event.currentTarget.value === "PAID" && invoice.unpaidAmount > 0) { event.currentTarget.value = invoice.status; setActiveId(invoice.id); setSaveResult({ id: invoice.id, message: paidGuardMessage, error: true }); return; }
                                        event.currentTarget.form?.requestSubmit();
                                      }}
                                    >
                                      {statusOptions.map((option) => (
                                        <option key={option.value} value={option.value} disabled={option.value === "PAID" && invoice.unpaidAmount > 0 && invoice.status !== "PAID"}>{option.label}</option>
                                      ))}
                                    </select>
                                  </form>
                                ) : (
                                  <StatusBadge kind="received" status={invoice.status} />
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {invoice.fileUrl ? (
                                  <a className="text-sm underline" href={invoice.fileUrl} target="_blank" onClick={(event) => event.stopPropagation()}>
                                    表示
                                  </a>
                                ) : (
                                  "-"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    );
                  })}
              </table>
            </div>

            <aside className="min-w-0 border-t bg-background p-4">
              {activeInvoice ? (
                <div className="space-y-4">
                  <div className="border-b pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-base font-semibold">{activeInvoice.vendorName}</div>
                        <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{activeInvoice.projectName}</div>
                      </div>
                      <StatusBadge status={activeInvoice.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">{activeInvoice.mailProcessed ? "処理済み" : "未処理"}</Badge>
                      <Badge variant="outline">支払登録 {yen.format(activeInvoice.paidAmount)}</Badge>
                      <Badge variant={activeInvoice.total > 0 && activeInvoice.bankReconciledAmount >= activeInvoice.total ? "secondary" : "outline"}>
                        {activeInvoice.total > 0 && activeInvoice.bankReconciledAmount >= activeInvoice.total ? "銀行照合済み" : activeInvoice.bankReconciledAmount > 0 ? "銀行一部照合" : "銀行未照合"} {yen.format(activeInvoice.bankReconciledAmount)}
                      </Badge>
                      <Badge variant={activeInvoice.unpaidAmount > 0 ? "secondary" : "outline"}>
                        未払い {yen.format(Math.max(0, activeInvoice.unpaidAmount))}
                      </Badge>
                      <Badge variant="outline">請求月 {monthLabel(monthKey(activeInvoice))}</Badge>
                      {activeInvoice.debt.groupId ? <Badge variant={activeInvoice.debt.payable ? "outline" : "secondary"}>債務グループ / {debtRoles[activeInvoice.debt.role]} / {activeInvoice.debt.payable ? "支払対象" : "支払対象外"}</Badge> : null}
                      {activeInvoice.fileUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={activeInvoice.fileUrl} target="_blank">
                            <ExternalLink className="h-4 w-4" />
                            別画面
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">請求日 / 支払期限</div>
                      <div className="mt-1 text-sm font-medium">{formatDate(activeInvoice.issueDate)} / {formatDate(activeInvoice.dueDate)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">差引支払額 / 支払登録済み</div>
                      <div className="mt-1 text-sm font-medium">{yen.format(activeInvoice.total)} / {yen.format(activeInvoice.paidAmount)}</div>
                    </div>
                  </div>

                  <PaymentRecordsPanel key={`${activeInvoice.id}:${activeInvoice.updatedAt}:${activeInvoice.payments.map((row) => `${row.id}:${row.updatedAt}`).join()}`} company={company} invoice={activeInvoice} records={activeInvoice.payments} canRecord={canRecordPayments} />
                  <DebtGroupPanel key={`debt:${activeInvoice.id}:${activeInvoice.updatedAt}:${activeInvoice.debt.members.map((row) => `${row.id}:${row.updatedAt}`).join()}`} company={company} invoice={activeInvoice} canManage={canApprove} />

                  <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {activeInvoice.mimeType?.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      プレビュー
                    </div>
                    <OriginalDocumentPreview key={`${activeInvoice.id}:${activeInvoice.fileUrl}`} fileUrl={activeInvoice.fileUrl} mimeType={activeInvoice.mimeType} fileName={activeInvoice.originalFileName ?? activeInvoice.vendorName} />
                  </div>

                  <div className="min-w-0 space-y-4">
                  {receivedInvoiceWarnings(activeInvoice).length ? <ul className="space-y-1 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950" aria-label="原本確認の注意点">
                    {receivedInvoiceWarnings(activeInvoice).map((warning) => <li key={warning}>{warning}</li>)}
                  </ul> : null}
                  {Object.keys(receivedInvoiceEvidence(activeInvoice.ocrText ?? "").snippets).length ? <details open className="border-b pb-3 text-xs">
                    <summary className="cursor-pointer font-medium">OCR抽出根拠（原文）</summary>
                    <dl className="mt-2 space-y-2">{Object.entries(receivedInvoiceEvidence(activeInvoice.ocrText ?? "").snippets).map(([field, text]) => <div key={field}>
                      <dt className="font-medium">{({ issuer: "請求元", bank: "振込先・銀行", issueDate: "請求日", dueDate: "支払期限", subtotal: "税抜", taxTotal: "消費税", grossAmount: "税込総額", withholdingAmount: "源泉徴収税", total: "差引支払額" } as Record<string, string>)[field]}</dt>
                      <dd className="break-words whitespace-pre-wrap text-muted-foreground">{text}</dd>
                    </div>)}</dl>
                  </details> : null}
                  {canEdit ? (
                    <form key={`${activeInvoice.id}:${activeInvoice.updatedAt}`} action={updateReceivedInvoiceInline} onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      if (form.get("status") === "PAID" && Number(form.get("total")) > activeInvoice.paidAmount) { setSaveResult({ id: activeInvoice.id, message: paidGuardMessage, error: true }); return; }
                      startSaving(async () => {
                        try {
                          const result = await saveReceivedInvoice(form);
                          setSaveResult({ id: activeInvoice.id, message: result.ok ? "保存しました。" : result.error, error: !result.ok });
                        } catch {
                          setSaveResult({ id: activeInvoice.id, message: "通信に失敗しました。入力内容を保持しています。再試行してください。", error: true });
                        }
                      });
                    }} className="space-y-3">
                      <input type="hidden" name="company" value={company} />
                      <input type="hidden" name="receivedInvoiceId" value={activeInvoice.id} />
                      <input type="hidden" name="expectedUpdatedAt" value={activeInvoice.updatedAt} />
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">詳細編集</div>
                        <Button type="submit" size="sm" className="gap-1" disabled={saving}>
                          <Save className="h-4 w-4" />
                          {saving ? "保存中…" : "保存"}
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">請求元（発行者）</span>
                          <SelectField name="vendorId" defaultValue={activeInvoice.vendorId} options={vendors} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">案件</span>
                          <SelectField name="projectId" defaultValue={activeInvoice.projectId} options={projects} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">状態</span>
                          <SelectField name="status" defaultValue={activeInvoice.status} options={statusOptions} disabledValues={activeInvoice.unpaidAmount > 0 ? ["PAID"] : []} />
                          <span className="block text-[11px] text-muted-foreground">支払済みは支払記録・銀行照合で決まります。金額の訂正は支払記録とは別に保存できます。</span>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">請求日</span>
                          <Input name="issueDate" type="date" defaultValue={activeInvoice.issueDate} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">支払期限</span>
                          <Input name="dueDate" type="date" defaultValue={activeInvoice.dueDate} />
                        </label>
                      </div>
                      <ReceivedAmountFields amounts={activeInvoice} />
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">メモ</span>
                        <Textarea name="memo" defaultValue={activeInvoice.memo ?? ""} className="min-h-24" />
                      </label>
                      {saveResult?.id === activeInvoice.id ? <p role={saveResult.error ? "alert" : "status"} className={`text-sm ${saveResult.error ? "text-destructive" : "text-emerald-700"}`}>{saveResult.message}</p> : null}
                    </form>
                  ) : null}

                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-sm font-medium">OCR本文</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                      {activeInvoice.ocrText || "OCR本文はありません。"}
                    </pre>
                  </div>
                  </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                  請求書を選択するとプレビューを表示します。
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border py-12 text-sm text-muted-foreground">
            <p>条件に合う受領請求書はありません。</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setFilter("all"); setQuery(""); }}>
              条件をリセット
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
