import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import type {
  AppData,
  AuditLog,
  Client,
  Project,
  ProjectMoney,
  User,
  Vendor,
} from "@/lib/types";

const DATA_VERSION = 3;
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const RUNTIME_DATA_FILE =
  process.env.VERCEL === "1" ? path.join(os.tmpdir(), "triangle-invoice-os", "app-data.json") : DATA_FILE;

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

function active<T extends { deletedAt?: string | null }>(rows: T[]) {
  return rows.filter((row) => !row.deletedAt);
}

function project(
  id: string,
  name: string,
  company: "CHINA" | "JAPAN",
  stage: string,
  status: Project["status"],
  index: number,
  billingTotal = 0,
  billingCount = 1,
): Project {
  const timestamp = now();
  return {
    id,
    name,
    clientId: company === "CHINA" ? "cli-china" : "cli-japan",
    company,
    managerId: "usr-admin",
    memberIds: ["usr-admin"],
    status,
    stage,
    contractAmount: billingTotal,
    billingCount,
    startDate: "2026-05-01",
    memo: `${company === "CHINA" ? "中国" : "日本"} / ${stage}`,
    sortOrder: index,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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
      name: "Project Manager",
      email: "pm@triangle.local",
      passwordHash,
      role: "PROJECT_MANAGER",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "usr-designer",
      name: "Designer",
      email: "designer@triangle.local",
      passwordHash,
      role: "DESIGNER",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "usr-guest",
      name: "Guest Invoice",
      email: "guest@triangle.local",
      passwordHash,
      role: "GUEST",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const clients: Client[] = [
    {
      id: "cli-china",
      companyName: "TRIANGLE China",
      contactName: "中国チーム",
      memo: "中国案件用の会社",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "cli-japan",
      companyName: "TRIANGLE Japan",
      contactName: "日本チーム",
      memo: "日本案件用の会社",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const vendors: Vendor[] = [
    {
      id: "ven-production",
      companyName: "制作協力会社",
      memo: "制作・施工・撮影費の仮支払先",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const chinaNames = [
    "CN087_萱子_7.0标准店",
    "JP063_LUMINE",
    "CN086_55°N_杂货店(多店)",
    "CN088_志邦_南京展厅",
    "CN0089_绿园_建筑室内",
    "CN090_WEGO",
    "CN091_森里空间6号楼",
    "CN093_哥哥的深夜食堂",
    "CN092_水云间_南宁万象城",
    "CN070_BOLONI 展厅",
    "CN081_UNDEFEATED 武汉/杭州",
  ];

  const japanNames = [
    "JP057_自由が丘RESTRANT",
    "JP060_真ホテル 高田馬場",
    "JP061_真ホテル 浅草",
    "JP059_POF Rebranding",
    "JP062_POF渋谷ヒカリエ",
  ];

  const projects: Project[] = [
    ...chinaNames.map((name, index) =>
      project(
        `prj-cn-${String(index + 1).padStart(3, "0")}`,
        name,
        "CHINA",
        index < 9 ? "制作资料" : "施工中",
        index < 9 ? "PLANNING" : "IN_PROGRESS",
        index + 1,
        0,
        1,
      ),
    ),
    ...japanNames.map((name, index) =>
      project(
        `prj-jp-${String(index + 1).padStart(3, "0")}`,
        name,
        "JAPAN",
        index < 3 ? "制作资料" : index === 3 ? "施工中" : "待拍摄",
        index < 3 ? "PLANNING" : index === 3 ? "IN_PROGRESS" : "WAITING",
        index + 1,
        0,
        1,
      ),
    ),
  ];

  return {
    seedVersion: DATA_VERSION,
    users,
    clients,
    vendors,
    projects,
    issuedInvoices: [],
    issuedInvoiceItems: [],
    receivedInvoices: [],
    payments: [],
    attachments: [],
    auditLogs: [],
    invoiceNumberSettings: [
      {
        id: "num-2026",
        prefix: "TRI",
        nextNumber: 1,
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
    writeFileSync(RUNTIME_DATA_FILE, JSON.stringify(seedData(), null, 2));
  }

  const data = JSON.parse(readFileSync(RUNTIME_DATA_FILE, "utf8")) as AppData;
  if (data.seedVersion !== DATA_VERSION) {
    const nextData = seedData();
    writeFileSync(RUNTIME_DATA_FILE, JSON.stringify(nextData, null, 2));
    return nextData;
  }
  if (!data.users.some((user) => user.id === "usr-guest" || user.email === "guest@triangle.local")) {
    const timestamp = now();
    data.users.push({
      id: "usr-guest",
      name: "Guest Invoice",
      email: "guest@triangle.local",
      passwordHash: hashSync("password123", 10),
      role: "GUEST",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    writeData(data);
  }
  return data;
}

export function writeData(data: AppData) {
  const runtimeDir = path.dirname(RUNTIME_DATA_FILE);
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(RUNTIME_DATA_FILE, JSON.stringify({ ...data, seedVersion: DATA_VERSION }, null, 2));
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
  const projectItem = data.projects.find((item) => item.id === projectId);
  const issued = active(data.issuedInvoices).filter((item) => item.projectId === projectId);
  const received = active(data.receivedInvoices).filter((item) => item.projectId === projectId);
  const contractAmount = projectItem?.contractAmount ?? 0;
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
  if (user.role === "GUEST") return [];
  return active(data.projects).filter(
    (projectItem) => projectItem.managerId === user.id || projectItem.memberIds.includes(user.id),
  );
}

export function taxLabel(rate: number) {
  if (rate === 10) return "10%";
  if (rate === 8) return "8%";
  if (rate === 0) return "非課税";
  return "対象外";
}
