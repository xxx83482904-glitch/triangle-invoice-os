import { createHash } from "node:crypto";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import type { AppData, MailDocument, MailDocumentCategory } from "@/lib/types";

export type MailDuplicateInfo = {
  duplicateOfMailDocumentId?: string;
  duplicateOfReceivedInvoiceId?: string;
  duplicateReason: string;
  duplicateScore: number;
  duplicateTitle?: string;
};

type DuplicateCandidate = {
  category: MailDocumentCategory;
  fileHash?: string;
  ocrText?: string;
  senderName?: string;
};

export function mailFileHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeDuplicateText(value?: string) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase()
    .slice(0, 4000);
}

function normalizeName(value?: string) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function ngrams(value: string, size = 3) {
  if (value.length < size) return new Set(value ? [value] : []);
  const result = new Set<string>();
  for (let index = 0; index <= value.length - size; index += 1) {
    result.add(value.slice(index, index + size));
  }
  return result;
}

export function duplicateTextScore(left?: string, right?: string) {
  const normalizedLeft = normalizeDuplicateText(left);
  const normalizedRight = normalizeDuplicateText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight && normalizedLeft.length >= 12) return 96;
  if (normalizedLeft.length < 40 || normalizedRight.length < 40) return 0;

  const leftSet = ngrams(normalizedLeft);
  const rightSet = ngrams(normalizedRight);
  if (!leftSet.size || !rightSet.size) return 0;

  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return Math.round((intersection / union) * 100);
}

function createdBefore(document: MailDocument, beforeCreatedAt?: string) {
  if (!beforeCreatedAt) return true;
  if (document.createdAt < beforeCreatedAt) return true;
  return false;
}

function betterDuplicate(current: MailDuplicateInfo | null, next: MailDuplicateInfo) {
  if (!current || next.duplicateScore > current.duplicateScore) return next;
  return current;
}

export function findMailDocumentDuplicate({
  beforeCreatedAt,
  candidate,
  company,
  data,
  excludeMailDocumentId,
}: {
  beforeCreatedAt?: string;
  candidate: DuplicateCandidate;
  company: CompanyScope;
  data: AppData;
  excludeMailDocumentId?: string;
}) {
  const sender = normalizeName(candidate.senderName);
  let best: MailDuplicateInfo | null = null;

  for (const document of data.mailDocuments) {
    if (document.deletedAt) continue;
    if (document.id === excludeMailDocumentId) continue;
    if (companyFromParam(document.company) !== company) continue;
    if (!createdBefore(document, beforeCreatedAt)) continue;

    const title = document.originalFileName || document.title;
    if (candidate.fileHash && document.fileHash && candidate.fileHash === document.fileHash) {
      best = betterDuplicate(best, {
        duplicateOfMailDocumentId: document.id,
        duplicateReason: "同じファイル内容",
        duplicateScore: 100,
        duplicateTitle: title,
      });
      continue;
    }

    const textScore = duplicateTextScore(candidate.ocrText, document.ocrText);
    if (textScore >= 96) {
      best = betterDuplicate(best, {
        duplicateOfMailDocumentId: document.id,
        duplicateReason: "OCR本文が同一",
        duplicateScore: textScore,
        duplicateTitle: title,
      });
      continue;
    }

    const sameCategory = candidate.category === document.category;
    const sameSender = sender && sender === normalizeName(document.senderName);
    if (sameCategory && textScore >= 88) {
      best = betterDuplicate(best, {
        duplicateOfMailDocumentId: document.id,
        duplicateReason: sameSender ? "発送元・分類・OCR本文がほぼ同じ" : "分類・OCR本文がほぼ同じ",
        duplicateScore: textScore,
        duplicateTitle: title,
      });
    }
  }

  return best;
}

export function combineDuplicateInfo(...items: Array<MailDuplicateInfo | null | undefined>) {
  return items.reduce<MailDuplicateInfo | null>((current, item) => {
    if (!item) return current;
    return betterDuplicate(current, item);
  }, null);
}
