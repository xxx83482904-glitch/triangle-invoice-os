"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { yen } from "@/lib/format";
import type { ReceivedInvoiceAmounts } from "@/lib/received-invoice-review";

export function ReceivedAmountFields({ amounts }: { amounts?: ReceivedInvoiceAmounts }) {
  const [values, setValues] = useState(() => ({
    subtotal: String(amounts?.subtotal ?? 0), taxTotal: String(amounts?.taxTotal ?? 0),
    grossAmount: String(amounts?.grossAmount ?? (amounts ? amounts.total + (amounts.withholdingAmount ?? 0) : 0)),
    withholdingAmount: String(amounts?.withholdingAmount ?? 0), total: String(amounts?.total ?? 0),
  }));
  const expectedGross = Number(values.subtotal) + Number(values.taxTotal);
  const expectedNet = Number(values.grossAmount) - Number(values.withholdingAmount);
  const mismatch = expectedGross !== Number(values.grossAmount) || expectedNet !== Number(values.total);
  const fields = [["subtotal", "税抜報酬・本体額"], ["taxTotal", "消費税額"], ["grossAmount", "税込総額（控除前）"], ["withholdingAmount", "源泉徴収税額（控除）"], ["total", "差引支払額（銀行照合額）"]] as const;
  return <fieldset className="space-y-2">
    <legend className="mb-2 text-sm font-medium">請求・支払内訳</legend>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([name, label]) => <label key={name} className="min-w-0 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input name={name} type="number" min="0" step="1" required={name !== "grossAmount" && name !== "withholdingAmount"} value={values[name]} className="font-mono" onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} />
    </label>)}</div>
    <p role="status" className={`text-xs ${mismatch ? "text-amber-700" : "text-muted-foreground"}`}>
      税抜＋消費税 {yen.format(expectedGross)} / 税込総額−源泉徴収 {yen.format(expectedNet)}{mismatch ? "（内訳と支払額が不一致）" : "（一致）"}
    </p>
  </fieldset>;
}
