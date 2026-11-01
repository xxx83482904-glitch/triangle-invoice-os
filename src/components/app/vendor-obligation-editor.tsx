"use client";
import { useState } from "react";
import { saveVendorObligationKindAction } from "@/app/banking/obligations/actions";
import { Button } from "@/components/ui/button";
import { obligationKindLabels } from "@/lib/obligation-classification";
import type { VendorObligationInput } from "@/lib/obligation-edits";
import type { CompanyScope } from "@/lib/company";
import type { Vendor } from "@/lib/types";

export function VendorObligationEditor({ company, vendor }: { company: CompanyScope; vendor: Pick<Vendor, "id" | "companyName" | "obligationKind" | "updatedAt"> }) {
  const [kind, setKind] = useState<VendorObligationInput["obligationKind"]>(vendor.obligationKind || "UNSET");
  const [version, setVersion] = useState(vendor.updatedAt);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  return <form className="min-w-0 space-y-1" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    try {
      const result = await saveVendorObligationKindAction(company, { id: vendor.id, updatedAt: version, obligationKind: kind });
      if (result.success) { setVersion(result.updatedAt); setMessage("区分を保存しました"); }
      else setError(result.error);
    } catch { setError("保存できませんでした。入力を保持しています。再度お試しください"); }
    finally { setPending(false); }
  }}>
    <div className="flex flex-wrap items-center gap-2"><select aria-label={`${vendor.companyName}の税金・社会保険区分`} className="min-h-11 max-w-full rounded-md border bg-background px-2 text-sm" value={kind} disabled={pending} onChange={(event) => { setKind(event.target.value as typeof kind); setMessage(""); }}>
      {Object.entries(obligationKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select><Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "保存中…" : "保存"}</Button></div>
    {message ? <p role="status" className="text-xs">{message}</p> : null}{error ? <p role="alert" className="max-w-64 whitespace-normal text-xs text-destructive">{error}</p> : null}
  </form>;
}
