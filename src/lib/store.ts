import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import type {
  AppData,
  AuditLog,
  Client,
  IssuedInvoice,
  IssuedInvoiceItem,
  Payment,
  Project,
  ProjectMoney,
  ReceivedInvoice,
  User,
  Vendor,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const RUNTIME_DATA_FILE =
  process.env.VERCEL === "1" ? path.join(os.tmpdir(), "triangle-invoice-os", "app-data.json") : DATA_FILE;

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

function active<T extends { deletedAt?: string | null }>(rows: T[]) {
  return rows.filter((row) => !row.deletedAt);
}

function seedData(): AppData {
  const createdAt = now();
  const passwordHash = hashSync("password123", 10);

  const users: User[] = [
    {
      id: "usr-admin",
      name: "Triangle Admin",
      email: "admin@triangle.local",
      passwordHash,
      role: "ADMIN",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "usr-accounting",
      name: "経理チーム",
      email: "accounting@triangle.local",
      passwordHash,
      role: "ACCOUNTING",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "usr-pm",
      name: "佐藤 PM",
      email: "pm@triangle.local",
      passwordHash,
      role: "PROJECT_MANAGER",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "usr-designer",
      name: "山田 Designer",
      email: "designer@triangle.local",
      passwordHash,
      role: "DESIGNER",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const clients: Client[] = [
    {
      id: "cli-aurora",
      companyName: "株式会社オーロラ食品",
      contactName: "田中 美咲",
      email: "tanaka@example.jp",
      phone: "03-0000-1111",
      address: "東京都渋谷区神宮前1-1-1",
      invoiceRegistrationNumber: "T1010000000001",
      memo: "ブランド刷新プロジェクトの主要クライアント",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "cli-north",
      companyName: "North Shore Hotels",
      contactName: "Robert Aoki",
      email: "aoki@example.jp",
      phone: "03-0000-2222",
      address: "東京都港区南青山2-2-2",
      invoiceRegistrationNumber: "T2010000000002",
      memo: "ホテルサイン計画",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const vendors: Vendor[] = [
    {
      id: "ven-print",
      companyName: "青山プリント株式会社",
      contactName: "中村 翔",
      email: "nakamura@print.example.jp",
      phone: "03-0000-3333",
      address: "東京都港区北青山3-3-3",
      invoiceRegistrationNumber: "T3010000000003",
      bankName: "三角銀行",
      branchName: "青山支店",
      accountType: "普通",
      accountNumber: "1234567",
      accountHolder: "アオヤマプリント（カ",
      memo: "印刷・色校正",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "ven-build",
      companyName: "代々木施工社",
      contactName: "鈴木 一郎",
      email: "suzuki@build.example.jp",
      phone: "03-0000-4444",
      address: "東京都渋谷区代々木4-4-4",
      invoiceRegistrationNumber: "T4010000000004",
      bankName: "都市信用金庫",
      branchName: "代々木支店",
      accountType: "普通",
      accountNumber: "7654321",
      accountHolder: "ヨヨギセコウシャ",
      memo: "内装施工・現場調整",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const projects: Project[] = [
    {
      id: "prj-brand",
      name: "Aurora Foods ブランドリニューアル",
      clientId: "cli-aurora",
      managerId: "usr-pm",
      memberIds: ["usr-pm", "usr-designer"],
      status: "IN_PROGRESS",
      contractAmount: 3600000,
      startDate: "2026-04-01",
      endDate: "2026-07-31",
      memo: "ロゴ、パッケージ、撮影ディレクション",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "prj-hotel",
      name: "North Shore Hotel サイン計画",
      clientId: "cli-north",
      managerId: "usr-pm",
      memberIds: ["usr-pm"],
      status: "WAITING",
      contractAmount: 2400000,
      startDate: "2026-03-15",
      endDate: "2026-06-15",
      memo: "現地採寸後に第2期見積",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const issuedInvoices: IssuedInvoice[] = [
    {
      id: "inv-001",
      invoiceNumber: "TRI-2026-0001",
      projectId: "prj-brand",
      clientId: "cli-aurora",
      issueDate: "2026-05-01",
      dueDate: "2026-05-31",
      transactionDate: "2026-05-01",
      subtotal: 1200000,
      taxTotal: 120000,
      total: 1320000,
      status: "PARTIALLY_PAID",
      notes: "ブランド設計 第1フェーズ",
      internalMemo: "5月末入金予定",
      createdById: "usr-accounting",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "inv-002",
      invoiceNumber: "TRI-2026-0002",
      projectId: "prj-hotel",
      clientId: "cli-north",
      issueDate: "2026-04-01",
      dueDate: "2026-04-30",
      transactionDate: "2026-04-01",
      subtotal: 800000,
      taxTotal: 80000,
      total: 880000,
      status: "OVERDUE",
      notes: "サイン基本設計費",
      internalMemo: "先方確認中",
      createdById: "usr-accounting",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const issuedInvoiceItems: IssuedInvoiceItem[] = [
    {
      id: "item-001",
      invoiceId: "inv-001",
      description: "ブランド戦略・VI設計",
      quantity: 1,
      unitPrice: 700000,
      taxRate: 10,
      amount: 700000,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "item-002",
      invoiceId: "inv-001",
      description: "パッケージデザイン初期案",
      quantity: 1,
      unitPrice: 500000,
      taxRate: 10,
      amount: 500000,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "item-003",
      invoiceId: "inv-002",
      description: "サイン基本設計",
      quantity: 1,
      unitPrice: 800000,
      taxRate: 10,
      amount: 800000,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const receivedInvoices: ReceivedInvoice[] = [
    {
      id: "rinv-001",
      vendorId: "ven-print",
      projectId: "prj-brand",
      receivedDate: "2026-05-08",
      issueDate: "2026-05-05",
      dueDate: "2026-05-25",
      subtotal: 260000,
      taxTotal: 26000,
      total: 286000,
      status: "APPROVAL_PENDING",
      fileUrl: "",
      originalFileName: "print-proof.pdf",
      mimeType: "application/pdf",
      ocrText: "",
      memo: "色校正・試作印刷",
      uploadedById: "usr-designer",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "rinv-002",
      vendorId: "ven-build",
      projectId: "prj-hotel",
      receivedDate: "2026-04-20",
      issueDate: "2026-04-18",
      dueDate: "2026-05-20",
      subtotal: 420000,
      taxTotal: 42000,
      total: 462000,
      status: "SCHEDULED",
      fileUrl: "",
      originalFileName: "site-survey.pdf",
      mimeType: "application/pdf",
      ocrText: "",
      memo: "現地調査・採寸",
      uploadedById: "usr-pm",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const payments: Payment[] = [
    {
      id: "pay-001",
      type: "INCOME",
      issuedInvoiceId: "inv-001",
      amount: 660000,
      paymentDate: "2026-05-10",
      method: "銀行振込",
      memo: "半金入金",
      createdById: "usr-accounting",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "pay-002",
      type: "EXPENSE",
      receivedInvoiceId: "rinv-002",
      amount: 462000,
      paymentDate: "2026-05-12",
      method: "銀行振込",
      memo: "支払い済み",
      createdById: "usr-accounting",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  return {
    users,
    clients,
    vendors,
    projects,
    issuedInvoices,
    issuedInvoiceItems,
    receivedInvoices,
    payments,
    attachments: [],
    auditLogs: [],
    invoiceNumberSettings: [
      {
        id: "num-2026",
        prefix: "TRI",
        nextNumber: 3,
        fiscalYear: 2026,
        createdAt,
        updatedAt: createdAt,
      },
    ],
  };
}

export function readData(): AppData {
  const runtimeDir = path.dirname(RUNTIME_DATA_FILE);
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
  if (!existsSync(RUNTIME_DATA_FILE)) {
    const initialData = existsSync(DATA_FILE) ? readFileSync(DATA_FILE, "utf8") : JSON.stringify(seedData(), null, 2);
    writeFileSync(RUNTIME_DATA_FILE, initialData);
  }
  return JSON.parse(readFileSync(RUNTIME_DATA_FILE, "utf8")) as AppData;
}

export function writeData(data: AppData) {
  const runtimeDir = path.dirname(RUNTIME_DATA_FILE);
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(RUNTIME_DATA_FILE, JSON.stringify(data, null, 2));
}

export function mutateData<T>(
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  mutator: (data: AppData) => T,
  beforeJson?: unknown,
) {
  const data = readData();
  const result = mutator(data);
  const audit: AuditLog = {
    id: newId(),
    userId,
    action,
    targetType,
    targetId,
    beforeJson,
    afterJson: result,
    createdAt: now(),
  };
  data.auditLogs.unshift(audit);
  writeData(data);
  return result;
}

export function getActiveData() {
  const data = readData();
  return {
    ...data,
    users: active(data.users),
    clients: active(data.clients),
    vendors: active(data.vendors),
    projects: active(data.projects),
    issuedInvoices: active(data.issuedInvoices),
    receivedInvoices: active(data.receivedInvoices),
    payments: active(data.payments),
    attachments: active(data.attachments),
  };
}

export function paidForIssued(data: AppData, issuedInvoiceId: string) {
  return active(data.payments)
    .filter((payment) => payment.type === "INCOME" && payment.issuedInvoiceId === issuedInvoiceId)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function paidForReceived(data: AppData, receivedInvoiceId: string) {
  return active(data.payments)
    .filter((payment) => payment.type === "EXPENSE" && payment.receivedInvoiceId === receivedInvoiceId)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function projectMoney(data: AppData, projectId: string): ProjectMoney {
  const project = data.projects.find((item) => item.id === projectId);
  const issued = active(data.issuedInvoices).filter((item) => item.projectId === projectId);
  const received = active(data.receivedInvoices).filter((item) => item.projectId === projectId);
  const contractAmount = project?.contractAmount ?? 0;
  const invoicedAmount = issued.reduce((sum, invoice) => sum + invoice.total, 0);
  const paidIncomeAmount = issued.reduce((sum, invoice) => sum + paidForIssued(data, invoice.id), 0);
  const receivedInvoiceTotal = received.reduce((sum, invoice) => sum + invoice.total, 0);
  const paidExpenseAmount = received.reduce((sum, invoice) => sum + paidForReceived(data, invoice.id), 0);
  const grossProfit = paidIncomeAmount - receivedInvoiceTotal;
  const base = paidIncomeAmount || invoicedAmount || contractAmount;

  return {
    contractAmount,
    invoicedAmount,
    paidIncomeAmount,
    unpaidIncomeAmount: Math.max(invoicedAmount - paidIncomeAmount, 0),
    receivedInvoiceTotal,
    paidExpenseAmount,
    unpaidExpenseAmount: Math.max(receivedInvoiceTotal - paidExpenseAmount, 0),
    grossProfit,
    grossProfitRate: base > 0 ? grossProfit / base : 0,
  };
}

export function scopedProjectsForUser(data: AppData, user: Pick<User, "id" | "role">) {
  if (user.role === "ADMIN" || user.role === "ACCOUNTING") return active(data.projects);
  return active(data.projects).filter(
    (project) => project.managerId === user.id || project.memberIds.includes(user.id),
  );
}

export function taxLabel(rate: number) {
  if (rate === 10) return "10%";
  if (rate === 8) return "8%";
  if (rate === 0) return "非課税";
  return "対象外";
}
