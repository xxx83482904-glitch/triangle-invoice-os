"use client";

import { BarChart3, Building2, ChartNoAxesCombined, FileText, Files, Landmark, LayoutGrid, Link2, ListChecks, Mail, Receipt, ReceiptText, ShieldCheck, Ship, Users, UserCheck, WalletCards } from "lucide-react";
import { navigationIconName } from "@/lib/navigation-icons";

const iconComponents: Record<string, typeof Files> = {
  BarChart3, Building2, ChartNoAxesCombined, FileText, Files, Landmark, LayoutGrid, Link2, ListChecks,
  Mail, Receipt, ReceiptText, ShieldCheck, Ship, Users, UserCheck, WalletCards,
};

// A missing icon must not take down the shell, including the phone menu.
export function navigationIcon(nameOrHref: string) {
  return iconComponents[navigationIconName(nameOrHref) ?? nameOrHref] ?? LayoutGrid;
}
