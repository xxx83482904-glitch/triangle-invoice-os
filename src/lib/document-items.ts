import { z } from "zod";
import type { TaxRate } from "@/lib/types";

export const maxDocumentItems = 100;
export const documentItemSchema = z.object({
  description: z.string().trim().min(1, "項目名を入力してください").max(2000),
  details: z.string().max(6000).optional(),
  quantity: z.number().positive().max(1000000),
  unitPrice: z.number().nonnegative().max(1000000000),
  taxRate: z.union([z.literal(10), z.literal(8), z.literal(0), z.literal(-1)]),
});
export const documentItemsSchema = z.array(documentItemSchema).min(1, "項目を1行以上入力してください").max(maxDocumentItems);
export type DocumentItemInput = z.input<typeof documentItemSchema>;

export function documentItemsFromFormData(formData: FormData): DocumentItemInput[] {
  const descriptions = formData.getAll("itemDescription");
  const details = formData.getAll("itemDetails");
  const quantities = formData.getAll("itemQuantity");
  const prices = formData.getAll("itemUnitPrice");
  const rates = formData.getAll("itemTaxRate");
  if (descriptions.length > maxDocumentItems || [quantities, prices, rates].some((values) => values.length !== descriptions.length) || (details.length && details.length !== descriptions.length)) {
    throw new Error("項目の行数を確認してください");
  }
  const items = descriptions.map((description, i) => ({ description, details: details[i] ?? "",
    quantity: Number(quantities[i]), unitPrice: Number(prices[i]), taxRate: rates[i] === "" ? NaN : Number(rates[i]) }));
  // Older forms submit unused blank rows; never discard a row containing details or amounts.
  return documentItemsSchema.parse(items.filter((item) => !(typeof item.description === "string" && !item.description.trim() &&
    typeof item.details === "string" && !item.details.trim() && [0, 1].includes(item.quantity) && item.unitPrice === 0)));
}

export function documentItemTotals(items: { quantity: number; unitPrice: number; taxRate: TaxRate }[]) {
  const amounts = items.map((item) => Math.round(item.quantity * item.unitPrice));
  const subtotal = amounts.reduce((sum, value) => sum + value, 0);
  const taxTotal = items.reduce((sum, item, i) => sum + (item.taxRate > 0 ? Math.round(amounts[i] * item.taxRate / 100) : 0), 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}
