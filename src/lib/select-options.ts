import { companyFromParam, type CompanyScope } from "@/lib/company";
import type { AppData, SelectOption, SelectOptionGroup } from "@/lib/types";

export const optionGroupLabels: Record<SelectOptionGroup, string> = {
  PROJECT_STAGE: "案件段階",
  PROJECT_STATUS: "案件ステータス",
  ISSUED_INVOICE_STATUS: "発行請求書ステータス",
  RECEIVED_INVOICE_STATUS: "受領請求書ステータス",
  TAX_RATE: "税率",
};

export const managedOptionGroups: SelectOptionGroup[] = [
  "PROJECT_STAGE",
  "PROJECT_STATUS",
  "ISSUED_INVOICE_STATUS",
  "RECEIVED_INVOICE_STATUS",
  "TAX_RATE",
];

const defaults: Array<{ group: SelectOptionGroup; value: string; label: string }> = [
  { group: "PROJECT_STAGE", value: "制作资料", label: "制作资料" },
  { group: "PROJECT_STAGE", value: "施工中", label: "施工中" },
  { group: "PROJECT_STAGE", value: "待拍摄", label: "待拍摄" },
  { group: "PROJECT_STATUS", value: "PLANNING", label: "計画中" },
  { group: "PROJECT_STATUS", value: "IN_PROGRESS", label: "進行中" },
  { group: "PROJECT_STATUS", value: "WAITING", label: "保留/待機" },
  { group: "PROJECT_STATUS", value: "COMPLETED", label: "完了" },
  { group: "ISSUED_INVOICE_STATUS", value: "DRAFT", label: "下書き" },
  { group: "ISSUED_INVOICE_STATUS", value: "ISSUED", label: "発行済み" },
  { group: "ISSUED_INVOICE_STATUS", value: "SENT", label: "送付済み" },
  { group: "ISSUED_INVOICE_STATUS", value: "WAITING_PAYMENT", label: "入金待ち" },
  { group: "ISSUED_INVOICE_STATUS", value: "PARTIALLY_PAID", label: "一部入金" },
  { group: "ISSUED_INVOICE_STATUS", value: "PAID", label: "入金済み" },
  { group: "ISSUED_INVOICE_STATUS", value: "OVERDUE", label: "期限超過" },
  { group: "ISSUED_INVOICE_STATUS", value: "CANCELED", label: "キャンセル" },
  { group: "ISSUED_INVOICE_STATUS", value: "REISSUED", label: "再発行済み" },
  { group: "RECEIVED_INVOICE_STATUS", value: "RECEIVED", label: "受領済み" },
  { group: "RECEIVED_INVOICE_STATUS", value: "OCR_PENDING", label: "読み取り待ち" },
  { group: "RECEIVED_INVOICE_STATUS", value: "REVIEWING", label: "確認中" },
  { group: "RECEIVED_INVOICE_STATUS", value: "APPROVAL_PENDING", label: "承認待ち" },
  { group: "RECEIVED_INVOICE_STATUS", value: "SCHEDULED", label: "支払予定" },
  { group: "RECEIVED_INVOICE_STATUS", value: "PAID", label: "支払済み" },
  { group: "RECEIVED_INVOICE_STATUS", value: "ON_HOLD", label: "保留" },
  { group: "RECEIVED_INVOICE_STATUS", value: "REJECTED", label: "差し戻し" },
  { group: "RECEIVED_INVOICE_STATUS", value: "ARCHIVED", label: "アーカイブ" },
  { group: "TAX_RATE", value: "10", label: "10%" },
  { group: "TAX_RATE", value: "8", label: "8%" },
  { group: "TAX_RATE", value: "0", label: "非課税" },
  { group: "TAX_RATE", value: "-1", label: "対象外" },
];

export function defaultSelectOptions(timestamp: string): SelectOption[] {
  const counts = new Map<SelectOptionGroup, number>();
  return defaults.map((item, index) => {
    const next = (counts.get(item.group) ?? 0) + 1;
    counts.set(item.group, next);
    return {
      id: `opt-${item.group.toLowerCase()}-${index + 1}`,
      group: item.group,
      value: item.value,
      label: item.label,
      sortOrder: next,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

export function selectOptionsFor(data: AppData, group: SelectOptionGroup, company?: CompanyScope) {
  const scope = company ? companyFromParam(company) : undefined;
  return data.selectOptions
    .filter((option) => {
      if (option.deletedAt || option.group !== group) return false;
      if (!scope) return true;
      return !option.company || companyFromParam(option.company) === scope;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "ja"));
}

export function optionLabel(data: AppData, group: SelectOptionGroup, value: string) {
  return selectOptionsFor(data, group).find((option) => option.value === value)?.label ?? value;
}
