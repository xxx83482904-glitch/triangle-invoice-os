import { receivedInvoiceEvidence } from "@/lib/received-invoice-review";
import type { MailDocument } from "@/lib/types";

type Option = { value: string; label: string };
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const usable = (text?: string) => text && !/確認待ち|未設定|unknown-sender/i.test(text) ? text.trim() : "";
const uniqueMatch = (text: string, options: Option[]) => {
  const found = options.filter((option) => normalize(option.label) === normalize(text));
  return text && found.length === 1 ? found[0].value : "";
};
const filenameMatch = (name: string, options: Option[]) => {
  const parts = name.replace(/\.[^.]+$/, "").split(/[_\s]+/).map(normalize);
  const found = options.filter((option) => parts.includes(normalize(option.label)));
  return found.length === 1 ? found[0].value : "";
};
const labelled = (text: string, label: string) => text.normalize("NFKC").match(new RegExp(`^(?:${label})\\s*[:：]\\s*(.+)$`, "im"))?.[1]?.trim() || "";
function evidence(text: string) {
  // Reuse the existing OCR evidence parser, accepting the saved mail summary's amount label too.
  return receivedInvoiceEvidence(text.normalize("NFKC").replace(/税込総額/g, "税込合計").replace(/^(?:金額:\s*)?合計(?:金額)?\s*[:：]?\s*/gm, "請求金額: "));
}
function totalFrom(source: ReturnType<typeof evidence>) {
  const amounts = source.amounts;
  if (amounts.total !== undefined) return String(amounts.total);
  const gross = amounts.grossAmount ?? (amounts.subtotal !== undefined ? amounts.subtotal + (amounts.taxTotal ?? 0) : undefined);
  const net = gross === undefined ? undefined : gross - (amounts.withholdingAmount ?? 0);
  return net !== undefined && Number.isSafeInteger(net) && net >= 0 ? String(net) : "";
}

// Local saved evidence only; never use another invoice, the first option, upload date, or a new AI call.
export function mailInvoiceDefaults(mail: Pick<MailDocument, "originalFileName" | "ocrText" | "senderName" | "memo">, vendors: Option[], projects: Option[]) {
  const ocr = mail.ocrText || "", memo = mail.memo || "", file = mail.originalFileName.replace(/_/g, "\n");
  const sources = [evidence(ocr), evidence(memo), evidence(file)];
  const sender = usable(sources[0].issuer) || usable(labelled(ocr, "発送元|差出人|sender")) || usable(mail.senderName) || usable(sources[1].issuer) || usable(labelled(memo, "発送元|差出人"));
  const project = labelled(ocr, "案件名|案件|project") || labelled(memo, "案件名|案件|project");
  return {
    vendorId: sender ? uniqueMatch(sender, vendors) : filenameMatch(mail.originalFileName, vendors),
    projectId: project ? uniqueMatch(project, projects) : filenameMatch(mail.originalFileName, projects),
    issueDate: sources.find((source) => source.issueDate)?.issueDate || "",
    dueDate: sources.find((source) => source.dueDate)?.dueDate || "",
    total: sources.map(totalFrom).find((amount) => amount !== "") ?? "",
    status: "REVIEWING" as const,
  };
}
export type MailInvoiceDefaults = ReturnType<typeof mailInvoiceDefaults>;
