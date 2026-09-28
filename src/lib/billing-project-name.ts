const installment = "(?:初回|最終回|第?\\s*[0-9一二三四五六七八九十百]+\\s*回(?:目(?:回)?)?)";
const billingSuffix = new RegExp(`(?:設計\\s*)?${installment}\\s*(?:ご?請求(?:書|分)?|分請求書?)$`, "u");
const installmentOnly = new RegExp(`^(?:設計\\s*)?${installment}(?:\\s*(?:ご?請求(?:書|分)?|分))?$`, "u");

export const entityNameKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");

// Only explicit invoice suffixes are split; numbered buildings and company names stay intact.
export function splitBillingProjectName(name: string) {
  const normalized = name.normalize("NFKC").trim();
  if (installmentOnly.test(normalized.split("/")[0].trim())) return { projectName: "", billingLabel: normalized };
  const match = normalized.match(billingSuffix);
  if (!match) return { projectName: normalized, billingLabel: "" };
  const projectName = normalized.slice(0, match.index).replace(/[\s/・:：_-]+$/, "").trim();
  // Slash-separated subjects can name multiple jobs; do not infer their identity.
  if (projectName.includes("/")) return { projectName: normalized, billingLabel: "" };
  return { projectName, billingLabel: match[0].trim() };
}

export function isBillingDescription(name: string) {
  const normalized = name.normalize("NFKC").trim();
  return installmentOnly.test(normalized.split("/")[0].trim()) || Boolean(normalized.match(billingSuffix));
}

export function recipientName(name: string) {
  const clean = name.normalize("NFKC").replace(/[\u0000-\u001f]/g, " ").replace(/\s*(御中|様)$/, "").trim().slice(0, 160);
  return isBillingDescription(clean) ? "" : clean;
}
