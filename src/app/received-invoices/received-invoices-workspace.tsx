"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Image as ImageIcon, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { updateReceivedInvoiceInline, updateReceivedInvoiceStatus } from "@/app/actions";
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

export type ReceivedInvoiceWorkspaceItem = {
  createdAt: string;
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
  projectId: string;
  projectName: string;
  status: ReceivedInvoiceStatus;
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
  return row.unpaidAmount > 0 && row.dueDate < today;
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

function InvoicePreview({ row }: { row: ReceivedInvoiceWorkspaceItem }) {
  if (!row.fileUrl) {
    return <div className="flex min-h-[360px] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">ファイルがありません。</div>;
  }

  if (row.mimeType?.startsWith("image/")) {
    return (
      <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.fileUrl} alt={row.originalFileName ?? row.vendorName} className="max-h-[58vh] w-full object-contain" />
      </div>
    );
  }

  if (row.mimeType === "application/pdf") {
    return (
      <div className="space-y-2">
        <iframe title={row.originalFileName ?? row.vendorName} src={row.fileUrl} className="hidden h-[58vh] min-h-[420px] w-full rounded-lg border bg-muted md:block" />
        <div className="flex items-center justify-center rounded-lg bg-muted py-12 md:hidden">
          <Button asChild variant="outline">
            <a href={row.fileUrl} target="_blank">PDFを別画面で開く</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-lg bg-muted">
      <Button asChild variant="outline">
        <a href={row.fileUrl} target="_blank">ファイルを開く</a>
      </Button>
    </div>
  );
}

function SelectField({
  defaultValue,
  disabled,
  name,
  options,
}: {
  defaultValue: string;
  disabled?: boolean;
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
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function ReceivedInvoicesWorkspace({
  canApprove,
  canEdit,
  company,
  invoices,
  projects,
  statusOptions,
  vendors,
}: {
  canApprove: boolean;
  canEdit: boolean;
  company: CompanyScope;
  invoices: ReceivedInvoiceWorkspaceItem[];
  projects: Option[];
  statusOptions: Option[];
  vendors: Option[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [activeId, setActiveId] = useState(invoices[0]?.id ?? "");
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<WorkFilter>("unpaid");
  const [query, setQuery] = useState("");

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

  const activeInvoice = filteredInvoices.find((invoice) => invoice.id === activeId) ?? filteredInvoices[0] ?? invoices[0] ?? null;

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
    <Card>
      <CardHeader className="gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>受領請求書一覧</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            月別に確認し、行を選ぶと右側でPDFと詳細を見ながら処理できます。
          </div>
        </div>
        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3 lg:min-w-[420px]">
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div>合計</div>
            <div className="font-mono text-sm font-semibold text-foreground">{yen.format(totals.total)}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div>支払済</div>
            <div className="font-mono text-sm font-semibold text-emerald-700">{yen.format(totals.paid)}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div>未払い</div>
            <div className="font-mono text-sm font-semibold text-amber-700">{yen.format(Math.max(0, totals.unpaid))}</div>
          </div>
        </div>
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

        {filteredInvoices.length ? (
          <div className="grid min-h-[720px] overflow-hidden rounded-lg border xl:grid-cols-[minmax(0,1fr)_440px]">
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">請求元</th>
                    <th className="px-3 py-2 text-left">案件</th>
                    <th className="px-3 py-2 text-left">請求日</th>
                    <th className="px-3 py-2 text-left">支払期限</th>
                    <th className="px-3 py-2 text-right">税込</th>
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
                          <td colSpan={8} className="px-3 py-2">
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
                                {monthInvoices.length}件 / {yen.format(monthTotal)} / 未払い {yen.format(Math.max(0, monthUnpaid))}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {collapsed ? null : monthInvoices.map((invoice) => {
                          const active = activeInvoice?.id === invoice.id;
                          return (
                            <tr
                              key={invoice.id}
                              className={`cursor-pointer border-t border-l-2 transition hover:bg-muted/40 ${paymentTone(invoice, today)} ${active ? "bg-primary/5" : ""}`}
                              onClick={() => setActiveId(invoice.id)}
                            >
                              <td className="max-w-[220px] truncate px-3 py-2 font-medium">{invoice.vendorName}</td>
                              <td className="max-w-[220px] truncate px-3 py-2">
                                <Link href={`/projects/${invoice.projectId}?company=${company}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
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
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{yen.format(Math.max(0, invoice.unpaidAmount))}</td>
                              <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                {canApprove ? (
                                  <form action={updateReceivedInvoiceStatus}>
                                    <input type="hidden" name="receivedInvoiceId" value={invoice.id} />
                                    <select
                                      name="status"
                                      defaultValue={invoice.status}
                                      className="h-7 max-w-[140px] rounded-full border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                      onChange={(event) => event.currentTarget.form?.requestSubmit()}
                                    >
                                      {statusOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </form>
                                ) : (
                                  <StatusBadge status={invoice.status} />
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

            <aside className="border-t bg-background p-4 xl:border-t-0 xl:border-l">
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
                      <Badge variant={activeInvoice.unpaidAmount > 0 ? "secondary" : "outline"}>
                        未払い {yen.format(Math.max(0, activeInvoice.unpaidAmount))}
                      </Badge>
                      <Badge variant="outline">請求月 {monthLabel(monthKey(activeInvoice))}</Badge>
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

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">請求日 / 支払期限</div>
                      <div className="mt-1 text-sm font-medium">{formatDate(activeInvoice.issueDate)} / {formatDate(activeInvoice.dueDate)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">税込 / 支払済</div>
                      <div className="mt-1 text-sm font-medium">{yen.format(activeInvoice.total)} / {yen.format(activeInvoice.paidAmount)}</div>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3 rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {activeInvoice.mimeType?.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      プレビュー
                    </div>
                    <InvoicePreview row={activeInvoice} />
                  </div>

                  {canEdit ? (
                    <form action={updateReceivedInvoiceInline} className="space-y-3 rounded-lg border p-3">
                      <input type="hidden" name="company" value={company} />
                      <input type="hidden" name="receivedInvoiceId" value={activeInvoice.id} />
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">詳細編集</div>
                        <Button type="submit" size="sm" className="gap-1">
                          <Save className="h-4 w-4" />
                          保存
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">支払先</span>
                          <SelectField name="vendorId" defaultValue={activeInvoice.vendorId} options={vendors} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">案件</span>
                          <SelectField name="projectId" defaultValue={activeInvoice.projectId} options={projects} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">状態</span>
                          <SelectField name="status" defaultValue={activeInvoice.status} options={statusOptions} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">請求日</span>
                          <Input name="issueDate" type="date" defaultValue={activeInvoice.issueDate} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">支払期限</span>
                          <Input name="dueDate" type="date" defaultValue={activeInvoice.dueDate} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">税込</span>
                          <Input name="total" type="number" defaultValue={activeInvoice.total} className="font-mono" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">税抜</span>
                          <Input name="subtotal" type="number" defaultValue={activeInvoice.subtotal} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">消費税</span>
                          <Input name="taxTotal" type="number" defaultValue={activeInvoice.taxTotal} />
                        </label>
                      </div>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">メモ</span>
                        <Textarea name="memo" defaultValue={activeInvoice.memo ?? ""} className="min-h-24" />
                      </label>
                    </form>
                  ) : null}

                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-sm font-medium">OCR本文</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                      {activeInvoice.ocrText || "OCR本文はありません。"}
                    </pre>
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
