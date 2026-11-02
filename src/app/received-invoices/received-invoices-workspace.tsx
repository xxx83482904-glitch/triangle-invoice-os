"use client";
import { statusToneClass } from "@/lib/status-tone";
import { cardPressProps } from "@/components/app/list-selection";
import { RecordDetail } from "@/components/app/record-detail";

import Link from "next/link";
import { ArrowUpRight, ExternalLink, FileText, Image as ImageIcon, Save } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { updateReceivedInvoiceInline, updateReceivedInvoiceStatus } from "@/app/actions";
import { useFeedbackForm } from "@/hooks/use-feedback-form";
import { OperationError, OperationPending } from "@/components/app/operation-feedback";
import { toast } from "@/hooks/use-toast";
import { operationFailureToast } from "@/lib/operation-feedback";
import { saveReceivedInvoiceStatus, saveReceivedInvoice } from "./actions";
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
import { MonthTabs } from "@/components/app/month-tabs";
import { countByMonth } from "@/lib/month-tabs";
import { filterReceivedInvoices, receivedFilterLabels as filterLabels, receivedInvoiceIsOverdue as isOverdue, receivedInvoiceIsDueSoon as isDueSoon, receivedListTotals, receivedSummaryBasis, type ReceivedWorkFilter as WorkFilter } from "@/lib/received-invoice-list";

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
  sourceMissing?: boolean;
  folderMonth?: string;
  id: string;
  issueDate: string;
  memo?: string;
  mimeType?: string;
  ocrText?: string;
  originalFileName?: string;
  paidAmount: number;
  paymentComplete: boolean;
  paymentOutstandingAmount: number;
  unpaidExclusion?: string;
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

function monthKey(row: ReceivedInvoiceWorkspaceItem) {
  if (row.folderMonth) return row.folderMonth;
  return row.issueDate ? row.issueDate.slice(0, 7) : "0000-00";
}

function monthLabel(key: string) {
  if (!key || key === "0000-00") return "日付なし";
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

function paymentTone(row: ReceivedInvoiceWorkspaceItem, today: string) {
  if (row.unpaidExclusion || row.total <= 0) return "[--card-tone:var(--muted-foreground)]";
  if (row.paymentComplete) return "[--card-tone:var(--color-emerald-500)]";
  if (isOverdue(row, today)) return "[--card-tone:var(--color-red-500)]";
  if (isDueSoon(row, today)) return "[--card-tone:var(--color-amber-500)]";
  return "[--card-tone:var(--color-sky-500)]";
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
  const [activeId, setActiveId] = useState(initialId ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(initialId));
  const [listMonth, setListMonth] = useState("");
  const [filter, setFilter] = useState<WorkFilter>(initialId ? "all" : "unpaid");
  const [query, setQuery] = useState("");
  const [saving, startSaving] = useTransition();
  const statusSave = useFeedbackForm(company, saveReceivedInvoiceStatus, "状態を保存しました");
  const [saveResult, setSaveResult] = useState<{ id: string; message: string; error?: boolean }>();

  const matchingInvoices = useMemo(() => filterReceivedInvoices(invoices, filter, query, today), [filter, invoices, query, today]);
  const filteredInvoices = useMemo(() => listMonth ? matchingInvoices.filter((invoice) => monthKey(invoice) === listMonth) : matchingInvoices, [listMonth, matchingInvoices]);
  const months = useMemo(() => invoices.map((invoice) => monthKey(invoice)), [invoices]);
  const monthCounts = useMemo(() => countByMonth(matchingInvoices.map((invoice) => monthKey(invoice))), [matchingInvoices]);

  const activeInvoice = filteredInvoices.find((invoice) => invoice.id === activeId) ?? null;

  const monthGroups = useMemo(() => {
    const grouped = new Map<string, ReceivedInvoiceWorkspaceItem[]>();
    for (const invoice of filteredInvoices) {
      const key = monthKey(invoice);
      grouped.set(key, [...(grouped.get(key) ?? []), invoice]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredInvoices]);

  const totals = useMemo(() => receivedListTotals(filteredInvoices), [filteredInvoices]);

  const listedInvoices = monthGroups.flatMap(([, list]) => list);
  const openInvoice = (id: string) => { setActiveId(id); setDetailOpen(true); };
  const stepFrom = (step: number) => {
    const next = activeInvoice ? listedInvoices[listedInvoices.findIndex((invoice) => invoice.id === activeInvoice.id) + step] : undefined;
    return next ? () => setActiveId(next.id) : undefined;
  };

  const counts = useMemo(() => Object.fromEntries((Object.keys(filterLabels) as WorkFilter[])
    .map((item) => [item, filterReceivedInvoices(invoices, item, "", today).length])) as Record<WorkFilter, number>, [invoices, today]);

  return (
    <Card variant="section">
      <CardHeader className="min-w-0 gap-4 lg:items-start">
        <div>
          <CardTitle>受領請求書一覧</CardTitle>
        </div>
        {showTotals ? <section aria-label="受領請求書の集計" className="w-full min-w-0 space-y-2 text-xs text-muted-foreground lg:max-w-2xl">
          <div className="flex flex-wrap gap-x-3 gap-y-1 break-all" role="status">
            {receivedSummaryBasis(filter, query, listMonth ? monthLabel(listMonth) : undefined).map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
              <div>合計</div>
              <div className="break-all font-mono text-sm font-semibold text-foreground">{yen.format(totals.total)}</div>
              <div className="mt-1 hidden sm:block">表示中{totals.count}件の差引支払額</div>
            </div>
            <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
              <div>支払済</div>
              <div className="break-all font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-300">{yen.format(totals.paid)}</div>
              <div className="mt-1 hidden sm:block">表示中の支払記録（一部支払を含む）</div>
            </div>
            <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
              <div>未払い</div>
              <div className="break-all font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">{yen.format(totals.unpaid)}</div>
              <div className="mt-1 hidden sm:block">支払対象{totals.unpaidCount}件の残額</div>
            </div>
          </div>
          <p>未払いはアーカイブ・却下・債務グループの支払対象外を除外{totals.excludedCount ? "（表示中" + totals.excludedCount + "件）" : ""}。合計・支払済は表示中の書類と支払記録を集計します。</p>
        </section> : null}
      </CardHeader>
      <CardContent>
        <section aria-label="絞り込み" className="workspace-filter-panel mb-3 flex flex-wrap items-center gap-2 p-3">
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
            className="h-11 min-w-0 basis-56 flex-1 md:max-w-80 lg:h-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </section>

        <p className="mb-3 text-xs text-muted-foreground">絞り込みボタンの件数は月と検索で絞る前の件数です。</p>
        <div className="mb-3"><MonthTabs label="請求月" value={listMonth} months={months} counts={monthCounts} undatedLabel="日付なし" onChange={setListMonth} /></div>
        {filteredInvoices.length ? (
          <div className="mt-3">
            <div className="min-w-0">
              <table className="record-cards record-cards-stack workspace-record-table w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
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
                    const monthTotal = monthInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
                    const monthUnpaid = monthInvoices.reduce((sum, invoice) => sum + invoice.unpaidAmount, 0);
                    return (
                      <tbody key={month}>
                        <tr className="record-section-row">
                          <td colSpan={8} className="px-3 py-2">
                            <div className="flex w-full items-center justify-between gap-3">
                              <span className="min-w-0 text-sm font-medium">{monthLabel(month)}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {monthInvoices.length}件{showTotals ? ` / ${yen.format(monthTotal)} / 未払い ${yen.format(Math.max(0, monthUnpaid))}` : ""}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {monthInvoices.map((invoice) => {
                          const active = activeId === invoice.id;
                          return (
                            <tr
                              key={invoice.id}
                              {...cardPressProps(() => openInvoice(invoice.id))}
                              data-active={active ? "" : undefined}
                              className={paymentTone(invoice, today)}
                            >
                              <td className="record-card-title max-w-[220px] truncate px-3 py-2 font-medium"><button type="button" data-selection-open className="record-card-open" title="開く">{invoice.vendorName}</button></td>
                              <td data-card-line="" className="max-w-[220px] truncate px-3 py-2">
                                <Link href={`/projects/${invoice.projectId}?company=${company}`} prefetch={false} className="hover:underline underline-offset-4 hover:text-primary" onClick={(event) => event.stopPropagation()}>
                                  {invoice.projectName}
                                </Link>
                              </td>
                              <td data-card-hide="" className="whitespace-nowrap px-3 py-2">{formatDate(invoice.issueDate)}</td>
                              <td data-label="支払期限" className="whitespace-nowrap px-3 py-2">
                                <span className={isOverdue(invoice, today) ? "font-medium text-red-700" : isDueSoon(invoice, today) ? "font-medium text-amber-700" : ""}>
                                  {formatDate(invoice.dueDate)}
                                </span>
                              </td>
                              <td data-label="差引" data-card-sub="" data-card-hide={invoice.total === invoice.unpaidAmount ? "" : undefined} className="whitespace-nowrap px-3 py-2 text-right font-mono">{yen.format(invoice.total)}</td>
                              <td data-label="未払い" data-card-end="" className="whitespace-nowrap px-3 py-2 text-right font-mono">{invoice.unpaidExclusion ? <span className="font-sans text-xs text-muted-foreground" title={invoice.unpaidExclusion}>対象外</span> : yen.format(invoice.unpaidAmount)}</td>
                              <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                {canApprove ? (
                                  <form id={`received-status-${invoice.id}`} action={updateReceivedInvoiceStatus} onSubmit={statusSave.onSubmit}>
                                    <input type="hidden" name="receivedInvoiceId" value={invoice.id} />
                                    <select
                                      name="status"
                                      disabled={company === "JAPAN" && (statusSave.pending || saving)}
                                      defaultValue={invoice.status}
                                      className={`h-7 max-w-[140px] rounded-full border px-2 text-xs ${statusToneClass(invoice.status)} outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
                                      onChange={(event) => {
                                        // A status change never creates a payment; paid is reached through payment records or bank reconciliation.
                                        if (event.currentTarget.value === "PAID" && invoice.paymentOutstandingAmount > 0) { event.currentTarget.value = invoice.status; openInvoice(invoice.id); setSaveResult({ id: invoice.id, message: paidGuardMessage, error: true }); if (company === "JAPAN") toast(operationFailureToast(paidGuardMessage)); return; }
                                        event.currentTarget.form?.requestSubmit();
                                      }}
                                    >
                                      {statusOptions.map((option) => (
                                        <option key={option.value} value={option.value} disabled={option.value === "PAID" && invoice.paymentOutstandingAmount > 0 && invoice.status !== "PAID"}>{option.label}</option>
                                      ))}
                                    </select>
                                    {company === "JAPAN" && statusSave.pendingFormId === `received-status-${invoice.id}` ? <span role="status" className="flex items-center gap-1 text-xs"><OperationPending pending>保存</OperationPending></span> : null}
                                    <OperationError message={statusSave.feedback?.formId === `received-status-${invoice.id}` && statusSave.feedback.error ? statusSave.feedback.message : undefined} />
                                  </form>
                                ) : (
                                  <StatusBadge kind="received" status={invoice.status} />
                                )}
                              </td>
                              <td data-card-hide="" className="px-3 py-2">
                                {invoice.fileUrl ? (
                                  <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><a href={invoice.fileUrl} target="_blank" onClick={(event) => event.stopPropagation()}>
                                    表示
                                  <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></a></Button>
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

            <RecordDetail wide={false} open={detailOpen && Boolean(activeInvoice)} title={activeInvoice?.vendorName} label="開いている受領請求書" resetKey={activeInvoice?.id} onClose={() => setDetailOpen(false)} onPrevious={stepFrom(-1)} onNext={stepFrom(1)}>
              {activeInvoice ? (
                <div className="space-y-6">
                  <div className="workspace-detail-group"><h2 className="mb-3 text-sm font-semibold">基本情報</h2>
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
                      <Badge className="h-auto max-w-full whitespace-normal break-words" variant={activeInvoice.unpaidAmount > 0 ? "secondary" : "outline"}>
                        {activeInvoice.unpaidExclusion ? "未払い集計対象外（" + activeInvoice.unpaidExclusion + "）" : "未払い " + yen.format(activeInvoice.unpaidAmount)}
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

                  <section className="workspace-detail-group"><h2 className="mb-3 text-sm font-semibold">金額・支払</h2>
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

                  <PaymentRecordsPanel key={`${activeInvoice.id}:${activeInvoice.updatedAt}:${activeInvoice.payments.map((row) => `${row.id}:${row.updatedAt}`).join()}`} company={company} invoice={{ ...activeInvoice, unpaidAmount: activeInvoice.debt.payable ? activeInvoice.paymentOutstandingAmount : 0 }} records={activeInvoice.payments} canRecord={canRecordPayments} />
                  </section>
                  <section className="workspace-detail-group"><h2 className="mb-3 text-sm font-semibold">連携</h2>
                  <DebtGroupPanel key={`debt:${activeInvoice.id}:${activeInvoice.updatedAt}:${activeInvoice.debt.members.map((row) => `${row.id}:${row.updatedAt}`).join()}`} company={company} invoice={activeInvoice} canManage={canApprove} />
                  </section>

                  <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {activeInvoice.mimeType?.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      プレビュー
                    </div>
                    <OriginalDocumentPreview company={company} sourceMissing={activeInvoice.sourceMissing} key={`${activeInvoice.id}:${activeInvoice.fileUrl}`} fileUrl={activeInvoice.fileUrl} mimeType={activeInvoice.mimeType} fileName={activeInvoice.originalFileName ?? activeInvoice.vendorName} />
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
                      if (company === "JAPAN" && (saving || statusSave.pending)) return;
                      const form = new FormData(event.currentTarget);
                      if (form.get("status") === "PAID" && Number(form.get("total")) > activeInvoice.paidAmount) { setSaveResult({ id: activeInvoice.id, message: paidGuardMessage, error: true }); if (company === "JAPAN") toast(operationFailureToast(paidGuardMessage)); return; }
                      startSaving(async () => {
                        try {
                          const result = await saveReceivedInvoice(form);
                          setSaveResult({ id: activeInvoice.id, message: result.ok ? "保存しました。" : result.error, error: !result.ok });
                          if (company === "JAPAN") toast(result.ok ? { title: "保存しました。", variant: "success" } : operationFailureToast(result.error));
                        } catch {
                          setSaveResult({ id: activeInvoice.id, message: "通信に失敗しました。入力内容を保持しています。再試行してください。", error: true });
                          if (company === "JAPAN") toast(operationFailureToast("通信に失敗しました。入力内容を保持しています。再試行してください。"));
                        }
                      });
                    }} className="workspace-detail-group space-y-4">
                      <input type="hidden" name="company" value={company} />
                      <input type="hidden" name="receivedInvoiceId" value={activeInvoice.id} />
                      <input type="hidden" name="expectedUpdatedAt" value={activeInvoice.updatedAt} />
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold">詳細編集</h2>
                        <Button type="submit" size="sm" className="gap-1" disabled={saving}>
                          <OperationPending pending={company === "JAPAN" && saving}><Save className="h-4 w-4" />{saving ? "保存中…" : "保存"}</OperationPending>
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
                          <SelectField name="status" defaultValue={activeInvoice.status} options={statusOptions} disabledValues={activeInvoice.paymentOutstandingAmount > 0 ? ["PAID"] : []} />
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
              ) : null}
            </RecordDetail>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border py-12 text-sm text-muted-foreground">
            <p>条件に合う受領請求書はありません。</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setFilter("all"); setQuery(""); setListMonth(""); }}>
              条件をリセット
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
