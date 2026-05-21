"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signIn, signOut, requireUser } from "@/lib/auth";
import { assertCan, can } from "@/lib/rbac";
import { mutateData, newId, paidForIssued, paidForReceived, readData, writeData } from "@/lib/store";
import type {
  Client,
  IssuedInvoice,
  IssuedInvoiceItem,
  Payment,
  Project,
  ReceivedInvoice,
  Vendor,
} from "@/lib/types";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  const item = value(formData, key);
  return item || undefined;
}

function money(formData: FormData, key: string) {
  const item = Number(value(formData, key).replaceAll(",", ""));
  return Number.isFinite(item) ? item : 0;
}

const now = () => new Date().toISOString();

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function nextInvoiceNumber(data: ReturnType<typeof readData>, timestamp: string) {
  const setting = data.invoiceNumberSettings[0];
  if (!setting) return `TRI-${new Date().getFullYear()}-${String(data.issuedInvoices.length + 1).padStart(4, "0")}`;
  const invoiceNumber = `${setting.prefix}-${setting.fiscalYear}-${String(setting.nextNumber).padStart(4, "0")}`;
  setting.nextNumber += 1;
  setting.updatedAt = timestamp;
  return invoiceNumber;
}

export type LoginState = { error: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const user = await signIn(value(formData, "email"), value(formData, "password"));
  if (!user) return { error: "メールアドレスまたはパスワードが違います。" };
  redirect("/dashboard");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

export async function createClient(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:clients");
  const timestamp = now();
  const client: Client = {
    id: newId(),
    companyName: value(formData, "companyName"),
    contactName: optional(formData, "contactName"),
    email: optional(formData, "email"),
    phone: optional(formData, "phone"),
    address: optional(formData, "address"),
    invoiceRegistrationNumber: optional(formData, "invoiceRegistrationNumber"),
    memo: optional(formData, "memo"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  mutateData(user.id, "CREATE_CLIENT", "Client", client.id, (data) => {
    data.clients.unshift(client);
    return client;
  });
  revalidatePath("/partners");
}

export async function createVendor(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:vendors");
  const timestamp = now();
  const vendor: Vendor = {
    id: newId(),
    companyName: value(formData, "companyName"),
    contactName: optional(formData, "contactName"),
    email: optional(formData, "email"),
    phone: optional(formData, "phone"),
    address: optional(formData, "address"),
    invoiceRegistrationNumber: optional(formData, "invoiceRegistrationNumber"),
    bankName: optional(formData, "bankName"),
    branchName: optional(formData, "branchName"),
    accountType: optional(formData, "accountType"),
    accountNumber: optional(formData, "accountNumber"),
    accountHolder: optional(formData, "accountHolder"),
    memo: optional(formData, "memo"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  mutateData(user.id, "CREATE_VENDOR", "Vendor", vendor.id, (data) => {
    data.vendors.unshift(vendor);
    return vendor;
  });
  revalidatePath("/partners");
}

export async function createProject(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:projects");
  const timestamp = now();
  const members = formData.getAll("memberIds").map(String);
  const managerId = value(formData, "managerId") || user.id;
  const project: Project = {
    id: newId(),
    name: value(formData, "name"),
    clientId: value(formData, "clientId"),
    managerId,
    memberIds: Array.from(new Set([managerId, ...members].filter(Boolean))),
    status: value(formData, "status") as Project["status"],
    contractAmount: money(formData, "contractAmount"),
    billingCount: Math.max(1, Math.min(12, Number(value(formData, "billingCount")) || 1)),
    startDate: optional(formData, "startDate"),
    endDate: optional(formData, "endDate"),
    memo: optional(formData, "memo"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  mutateData(user.id, "CREATE_PROJECT", "Project", project.id, (data) => {
    data.projects.unshift(project);
    return project;
  });
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function updateProjectInline(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:projects");

  const id = value(formData, "projectId");
  const data = readData();
  const before = data.projects.find((item) => item.id === id);
  if (!before || before.deletedAt) throw new Error("案件が見つかりません");

  mutateData(user.id, "UPDATE_PROJECT_INLINE", "Project", id, (draft) => {
    const project = draft.projects.find((item) => item.id === id);
    if (!project) throw new Error("案件が見つかりません");

    project.name = value(formData, "name");
    project.company = value(formData, "company") as Project["company"];
    project.clientId = project.company === "CHINA" ? "cli-china" : "cli-japan";
    project.stage = value(formData, "stage");
    project.status =
      project.stage === "施工中" ? "IN_PROGRESS" : project.stage === "待拍摄" ? "WAITING" : "PLANNING";
    project.contractAmount = money(formData, "contractAmount");
    project.billingCount = Math.max(1, Math.min(12, Number(value(formData, "billingCount")) || 1));
    project.updatedAt = now();

    return project;
  }, before);

  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
}

export async function createInstallmentInvoice(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:issuedInvoices");

  const projectId = value(formData, "projectId");
  const round = Math.max(1, Number(value(formData, "round")) || 1);
  const timestamp = now();
  const today = timestamp.slice(0, 10);

  mutateData(user.id, "CREATE_INSTALLMENT_INVOICE", "IssuedInvoice", projectId, (data) => {
    const project = data.projects.find((item) => item.id === projectId && !item.deletedAt);
    if (!project) throw new Error("案件が見つかりません");

    const billingCount = Math.max(1, project.billingCount ?? 1);
    if (round > billingCount) throw new Error("請求回数の範囲外です");

    const alreadyCreated = data.issuedInvoices.some(
      (invoice) => !invoice.deletedAt && invoice.projectId === projectId && invoice.internalMemo === `INSTALLMENT:${round}`,
    );
    if (alreadyCreated) throw new Error(`${round}回目の請求書は既に作成済みです`);

    const totalBilling = Math.max(0, project.contractAmount ?? 0);
    const baseTotal = Math.floor(totalBilling / billingCount);
    const total = round === billingCount ? totalBilling - baseTotal * (billingCount - 1) : baseTotal;
    const subtotal = Math.round(total / 1.1);
    const taxTotal = total - subtotal;
    const invoiceId = newId();

    const invoice: IssuedInvoice = {
      id: invoiceId,
      invoiceNumber: nextInvoiceNumber(data, timestamp),
      projectId,
      clientId: project.clientId,
      issueDate: today,
      dueDate: addDays(today, 30),
      transactionDate: today,
      subtotal,
      taxTotal,
      total,
      status: "ISSUED",
      notes: `${project.name} ${round}/${billingCount}回目 請求`,
      internalMemo: `INSTALLMENT:${round}`,
      createdById: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const item: IssuedInvoiceItem = {
      id: newId(),
      invoiceId,
      description: `${project.name} ${round}/${billingCount}回目`,
      quantity: 1,
      unitPrice: subtotal,
      taxRate: 10,
      amount: subtotal,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    data.issuedInvoices.unshift(invoice);
    data.issuedInvoiceItems.push(item);
    return { invoice, item };
  });

  revalidatePath("/dashboard");
  revalidatePath("/issued-invoices");
  revalidatePath(`/projects/${projectId}`);
}

export async function createIssuedInvoice(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:issuedInvoices");

  const data = readData();
  const invoiceNumber = value(formData, "invoiceNumber");
  if (data.issuedInvoices.some((invoice) => invoice.invoiceNumber === invoiceNumber && !invoice.deletedAt)) {
    throw new Error("請求書番号が重複しています");
  }

  const descriptions = formData.getAll("itemDescription").map(String);
  const quantities = formData.getAll("itemQuantity").map(Number);
  const unitPrices = formData.getAll("itemUnitPrice").map(Number);
  const taxRates = formData.getAll("itemTaxRate").map(Number);

  const invoiceId = newId();
  const timestamp = now();
  const items: IssuedInvoiceItem[] = descriptions
    .map((description, index) => ({
      id: newId(),
      invoiceId,
      description: description.trim(),
      quantity: Number.isFinite(quantities[index]) ? quantities[index] : 0,
      unitPrice: Number.isFinite(unitPrices[index]) ? unitPrices[index] : 0,
      taxRate: taxRates[index] as IssuedInvoiceItem["taxRate"],
      amount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    .filter((item) => item.description && item.quantity > 0);

  for (const item of items) item.amount = Math.round(item.quantity * item.unitPrice);
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxTotal = items.reduce((sum, item) => {
    if (item.taxRate === 10 || item.taxRate === 8) return sum + Math.round(item.amount * (item.taxRate / 100));
    return sum;
  }, 0);

  const invoice: IssuedInvoice = {
    id: invoiceId,
    invoiceNumber,
    projectId: value(formData, "projectId"),
    clientId: value(formData, "clientId"),
    issueDate: value(formData, "issueDate"),
    dueDate: value(formData, "dueDate"),
    transactionDate: value(formData, "transactionDate") || value(formData, "issueDate"),
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    status: value(formData, "status") as IssuedInvoice["status"],
    notes: optional(formData, "notes"),
    internalMemo: optional(formData, "internalMemo"),
    createdById: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  mutateData(user.id, "CREATE_ISSUED_INVOICE", "IssuedInvoice", invoice.id, (draft) => {
    draft.issuedInvoices.unshift(invoice);
    draft.issuedInvoiceItems.push(...items);
    const setting = draft.invoiceNumberSettings[0];
    if (setting && invoice.invoiceNumber.endsWith(String(setting.nextNumber).padStart(4, "0"))) {
      setting.nextNumber += 1;
      setting.updatedAt = timestamp;
    }
    return { invoice, items };
  });
  revalidatePath("/issued-invoices");
  revalidatePath(`/projects/${invoice.projectId}`);
  redirect(`/issued-invoices?created=${invoice.id}`);
}

export async function recordIncomePayment(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:incomePayments");
  const invoiceId = value(formData, "issuedInvoiceId");
  const timestamp = now();
  const payment: Payment = {
    id: newId(),
    type: "INCOME",
    issuedInvoiceId: invoiceId,
    amount: money(formData, "amount"),
    paymentDate: value(formData, "paymentDate"),
    method: optional(formData, "method"),
    memo: optional(formData, "memo"),
    createdById: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  mutateData(user.id, "RECORD_INCOME_PAYMENT", "Payment", payment.id, (data) => {
    data.payments.unshift(payment);
    const invoice = data.issuedInvoices.find((item) => item.id === invoiceId);
    if (invoice) {
      const paid = paidForIssued(data, invoiceId);
      invoice.status = paid >= invoice.total ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "WAITING_PAYMENT";
      invoice.paidAt = paid >= invoice.total ? payment.paymentDate : undefined;
      invoice.updatedAt = timestamp;
    }
    return payment;
  });
  revalidatePath("/payments");
  revalidatePath("/issued-invoices");
  revalidatePath("/dashboard");
}

export async function updateReceivedInvoiceStatus(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "manage:receivedInvoices") && !can(user, "approve:receivedInvoices")) {
    throw new Error("権限がありません");
  }
  const id = value(formData, "receivedInvoiceId");
  const status = value(formData, "status") as ReceivedInvoice["status"];
  const data = readData();
  const before = data.receivedInvoices.find((item) => item.id === id);

  mutateData(user.id, "UPDATE_RECEIVED_INVOICE_STATUS", "ReceivedInvoice", id, (draft) => {
    const invoice = draft.receivedInvoices.find((item) => item.id === id);
    if (!invoice) throw new Error("受領請求書が見つかりません");
    invoice.status = status;
    invoice.approvedById = status === "SCHEDULED" || status === "PAID" ? user.id : invoice.approvedById;
    invoice.updatedAt = now();
    return invoice;
  }, before);
  revalidatePath("/received-invoices");
  revalidatePath("/dashboard");
}

export async function recordExpensePayment(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "manage:expensePayments");
  const invoiceId = value(formData, "receivedInvoiceId");
  const timestamp = now();
  const payment: Payment = {
    id: newId(),
    type: "EXPENSE",
    receivedInvoiceId: invoiceId,
    amount: money(formData, "amount"),
    paymentDate: value(formData, "paymentDate"),
    method: optional(formData, "method"),
    memo: optional(formData, "memo"),
    createdById: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  mutateData(user.id, "RECORD_EXPENSE_PAYMENT", "Payment", payment.id, (data) => {
    data.payments.unshift(payment);
    const invoice = data.receivedInvoices.find((item) => item.id === invoiceId);
    if (invoice) {
      const paid = paidForReceived(data, invoiceId);
      invoice.status = paid >= invoice.total ? "PAID" : "SCHEDULED";
      invoice.paidAt = paid >= invoice.total ? payment.paymentDate : undefined;
      invoice.paymentMethod = payment.method;
      invoice.updatedAt = timestamp;
    }
    return payment;
  });
  revalidatePath("/payments");
  revalidatePath("/received-invoices");
  revalidatePath("/dashboard");
}

export async function softDelete(formData: FormData) {
  const user = await requireUser();
  assertCan(user, "view:all");
  const collection = value(formData, "collection") as
    | "clients"
    | "vendors"
    | "projects"
    | "issuedInvoices"
    | "receivedInvoices";
  const id = value(formData, "id");
  const data = readData();
  const before = (data[collection] as Array<{ id: string }>).find((item) => item.id === id);

  mutateData(user.id, `SOFT_DELETE_${collection.toUpperCase()}`, collection, id, (draft) => {
    const row = (draft[collection] as Array<{ id: string; deletedAt?: string; updatedAt?: string }>).find(
      (item) => item.id === id,
    );
    if (row) {
      row.deletedAt = now();
      row.updatedAt = now();
    }
    return row;
  }, before);
  revalidatePath("/");
}

export async function saveReceivedInvoiceMetadata(invoice: ReceivedInvoice) {
  const data = readData();
  data.receivedInvoices.unshift(invoice);
  data.auditLogs.unshift({
    id: newId(),
    userId: invoice.uploadedById,
    action: "UPLOAD_RECEIVED_INVOICE",
    targetType: "ReceivedInvoice",
    targetId: invoice.id,
    afterJson: invoice,
    createdAt: now(),
  });
  writeData(data);
}
