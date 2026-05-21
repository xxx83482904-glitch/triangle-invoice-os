export type UserRole =
  | "ADMIN"
  | "ACCOUNTING"
  | "CHIEF_DESIGNER"
  | "PROJECT_MANAGER"
  | "DESIGNER";

export type ProjectStatus =
  | "PLANNING"
  | "IN_PROGRESS"
  | "WAITING"
  | "COMPLETED"
  | "ARCHIVED";

export type IssuedInvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "SENT"
  | "WAITING_PAYMENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELED"
  | "REISSUED";

export type ReceivedInvoiceStatus =
  | "RECEIVED"
  | "OCR_PENDING"
  | "REVIEWING"
  | "APPROVAL_PENDING"
  | "SCHEDULED"
  | "PAID"
  | "ON_HOLD"
  | "REJECTED"
  | "ARCHIVED";

export type PaymentType = "INCOME" | "EXPENSE";

export type TaxRate = 10 | 8 | 0 | -1;

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Client = {
  id: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  invoiceRegistrationNumber?: string;
  memo?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Vendor = {
  id: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  invoiceRegistrationNumber?: string;
  bankName?: string;
  branchName?: string;
  accountType?: string;
  accountNumber?: string;
  accountHolder?: string;
  memo?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Project = {
  id: string;
  name: string;
  clientId: string;
  company?: "CHINA" | "JAPAN";
  managerId: string;
  memberIds: string[];
  status: ProjectStatus;
  stage?: string;
  contractAmount: number;
  startDate?: string;
  endDate?: string;
  memo?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type IssuedInvoiceItem = {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: TaxRate;
  amount: number;
  createdAt: string;
  updatedAt: string;
};

export type IssuedInvoice = {
  id: string;
  invoiceNumber: string;
  projectId: string;
  clientId: string;
  issueDate: string;
  dueDate: string;
  transactionDate: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  status: IssuedInvoiceStatus;
  pdfUrl?: string;
  notes?: string;
  internalMemo?: string;
  createdById: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type ReceivedInvoice = {
  id: string;
  vendorId: string;
  projectId: string;
  receivedDate: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  status: ReceivedInvoiceStatus;
  fileUrl?: string;
  originalFileName?: string;
  mimeType?: string;
  ocrText?: string;
  approvedById?: string;
  paidAt?: string;
  paymentMethod?: string;
  memo?: string;
  uploadedById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Payment = {
  id: string;
  type: PaymentType;
  issuedInvoiceId?: string;
  receivedInvoiceId?: string;
  amount: number;
  paymentDate: string;
  method?: string;
  memo?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Attachment = {
  id: string;
  relatedType: string;
  relatedId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  uploadedById: string;
  createdAt: string;
  deletedAt?: string | null;
};

export type AuditLog = {
  id: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  createdAt: string;
};

export type InvoiceNumberSetting = {
  id: string;
  prefix: string;
  nextNumber: number;
  fiscalYear: number;
  createdAt: string;
  updatedAt: string;
};

export type AppData = {
  seedVersion?: number;
  users: User[];
  clients: Client[];
  vendors: Vendor[];
  projects: Project[];
  issuedInvoices: IssuedInvoice[];
  issuedInvoiceItems: IssuedInvoiceItem[];
  receivedInvoices: ReceivedInvoice[];
  payments: Payment[];
  attachments: Attachment[];
  auditLogs: AuditLog[];
  invoiceNumberSettings: InvoiceNumberSetting[];
};

export type ProjectMoney = {
  contractAmount: number;
  invoicedAmount: number;
  paidIncomeAmount: number;
  unpaidIncomeAmount: number;
  receivedInvoiceTotal: number;
  paidExpenseAmount: number;
  unpaidExpenseAmount: number;
  grossProfit: number;
  grossProfitRate: number;
};
