import "server-only";

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { Pool } from "pg";
import { runtimeDataDir } from "@/lib/runtime-paths";
import { defaultSelectOptions } from "@/lib/select-options";
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
const DB_STATE_KEY = "app-data";
const DATA_DIR = runtimeDataDir();
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const LEGACY_DATA_FILE = path.join(process.cwd(), "data", "app-data.json");

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
      company: "CHINA",
      companyName: "TRIANGLE China",
      contactName: "中国チーム",
      memo: "中国案件用の会社",
      sortOrder: 1,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "cli-japan",
      company: "JAPAN",
      companyName: "TRIANGLE Japan",
      contactName: "日本チーム",
      memo: "日本案件用の会社",
      sortOrder: 1,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const vendors: Vendor[] = [
    {
      id: "ven-production",
      company: "CHINA",
      companyName: "制作協力会社",
      memo: "制作・施工・撮影費の仮支払先",
      sortOrder: 1,
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
    selectOptions: defaultSelectOptions(createdAt),
    projects,
    issuedInvoices: [],
    issuedInvoiceItems: [],
    receivedInvoices: [],
    mailFolders: [],
    mailDocuments: [],
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

type AppDataRow = { value: AppData };

let databasePool: Pool | null = null;

function isLocalDatabaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("@db:");
}

function shouldUseDatabaseStore() {
  const url = process.env.DATABASE_URL;
  return Boolean(url && !isLocalDatabaseUrl(url));
}

function databasePoolConfig() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required for durable production storage.");
  }

  const url = new URL(rawUrl);
  const sslMode = url.searchParams.get("sslmode");
  const needsSsl = sslMode === "require" || sslMode === "prefer" || sslMode === "verify-full";
  if (needsSsl) {
    url.searchParams.delete("sslmode");
  }

  return {
    connectionString: url.toString(),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  };
}

async function ensureDatabaseStore() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for durable production storage.");
  }

  if (!databasePool) {
    databasePool = new Pool(databasePoolConfig());
  }

  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "AppDataState" (
      "key" TEXT NOT NULL,
      "value" JSONB NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AppDataState_pkey" PRIMARY KEY ("key")
    )
  `);
  return databasePool;
}

async function readRawData() {
  if (shouldUseDatabaseStore()) {
    const pool = await ensureDatabaseStore();
    const { rows } = await pool.query<AppDataRow>(
      `SELECT "value" FROM "AppDataState" WHERE "key" = $1 LIMIT 1`,
      [DB_STATE_KEY],
    );
    if (rows[0]?.value) return rows[0].value;
    const initial = seedData();
    await writeRawData(initial);
    return initial;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Persistent database storage is not configured. Set DATABASE_URL before using production.");
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  migrateLegacyDataFile();
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify(seedData(), null, 2));
  }
  return JSON.parse(readFileSync(DATA_FILE, "utf8")) as AppData;
}

function migrateLegacyDataFile() {
  if (path.resolve(DATA_FILE) === path.resolve(LEGACY_DATA_FILE) || !existsSync(LEGACY_DATA_FILE)) return;
  if (!existsSync(DATA_FILE) || statSync(LEGACY_DATA_FILE).mtimeMs > statSync(DATA_FILE).mtimeMs) {
    copyFileSync(LEGACY_DATA_FILE, DATA_FILE);
  }
}

async function writeRawData(data: AppData) {
  const nextData = { ...data, seedVersion: DATA_VERSION };
  if (shouldUseDatabaseStore()) {
    const pool = await ensureDatabaseStore();
    await pool.query(
      `INSERT INTO "AppDataState" ("key", "value", "updatedAt")
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT ("key")
       DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`,
      [DB_STATE_KEY, JSON.stringify(nextData)],
    );
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Persistent database storage is not configured. Set DATABASE_URL before using production.");
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(nextData, null, 2));
}

async function normalizeData(data: AppData) {
  let changed = data.seedVersion !== DATA_VERSION;
  data.seedVersion = DATA_VERSION;
  if (!Array.isArray(data.users)) { data.users = seedData().users; changed = true; }
  if (!Array.isArray(data.clients)) { data.clients = seedData().clients; changed = true; }
  if (!Array.isArray(data.vendors)) { data.vendors = seedData().vendors; changed = true; }
  if (!Array.isArray(data.projects)) { data.projects = seedData().projects; changed = true; }
  if (!Array.isArray(data.issuedInvoices)) { data.issuedInvoices = []; changed = true; }
  if (!Array.isArray(data.issuedInvoiceItems)) { data.issuedInvoiceItems = []; changed = true; }
  if (!Array.isArray(data.receivedInvoices)) { data.receivedInvoices = []; changed = true; }
  if (!Array.isArray(data.mailFolders)) { data.mailFolders = []; changed = true; }
  if (!Array.isArray(data.mailDocuments)) { data.mailDocuments = []; changed = true; }
  if (!Array.isArray(data.payments)) { data.payments = []; changed = true; }
  if (!Array.isArray(data.attachments)) { data.attachments = []; changed = true; }
  if (!Array.isArray(data.auditLogs)) { data.auditLogs = []; changed = true; }
  if (!Array.isArray(data.invoiceNumberSettings)) { data.invoiceNumberSettings = seedData().invoiceNumberSettings; changed = true; }
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
    changed = true;
  }
  if (!Array.isArray(data.selectOptions)) {
    data.selectOptions = defaultSelectOptions(now());
    changed = true;
  }
  const optionIds = new Set<string>();
  for (const [index, option] of data.selectOptions.entries()) {
    if (!option.id || optionIds.has(option.id)) {
      option.id = `opt-${option.group.toLowerCase()}-${index + 1}`;
      changed = true;
    }
    optionIds.add(option.id);
  }
  for (const client of data.clients) {
    if (!client.company && client.id === "cli-japan") {
      client.company = "JAPAN";
      changed = true;
    } else if (!client.company) {
      client.company = "CHINA";
      changed = true;
    }
    if (!client.sortOrder) {
      client.sortOrder = data.clients.filter((item) => item.company === client.company).indexOf(client) + 1;
      changed = true;
    }
  }
  for (const vendor of data.vendors) {
    if (!vendor.company) {
      vendor.company = "CHINA";
      changed = true;
    }
    if (!vendor.sortOrder) {
      vendor.sortOrder = data.vendors.filter((item) => item.company === vendor.company).indexOf(vendor) + 1;
      changed = true;
    }
  }
  if (changed) await writeData(data);
  return data;
}

export async function readData(): Promise<AppData> {
  const data = await readRawData();
  return normalizeData(data);
}

export async function writeData(data: AppData) {
  await writeRawData(data);
}

export async function mutateData<T>(
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  mutator: (data: AppData) => T,
  beforeJson?: unknown,
) {
  const data = await readData();
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
  await writeData(data);
  return result;
}

export async function getActiveData() {
  const data = await readData();
  return {
    ...data,
    users: active(data.users),
    clients: active(data.clients),
    vendors: active(data.vendors),
    projects: active(data.projects),
    issuedInvoices: active(data.issuedInvoices),
    receivedInvoices: active(data.receivedInvoices),
    mailFolders: active(data.mailFolders),
    mailDocuments: active(data.mailDocuments),
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
